/**
 * Scrub provider tool-call markup out of an answer before it is shown.
 *
 * What this fixes
 * ---------------
 * A patient asked「结合 fshd 知识库分析我的报告」and the app showed them
 * this, as the answer, in the chat bubble:
 *
 *     <minimax:tool_call>
 *     <invoke name="search_medical_kb">
 *     <parameter name="query">面肩肱型肌营养不良 基因检测 诊断 标准</parameter>
 *     <parameter name="limit">5</parameter>
 *     </invoke>
 *     </minimax:tool_call>
 *
 * The provider currently configured (MiniMax) does not always return a
 * tool call through the API's structured `tool_calls` field — under some
 * conditions it writes the call into the assistant's *content* as XML.
 * The orchestrator's round 2 advertises no tools, so there is nothing to
 * parse it back into, and `content` goes straight to the client as the
 * answer.
 *
 * Why strip rather than parse
 * ---------------------------
 * Executing it is not an option. Round 2 exists precisely because this
 * system does exactly two rounds; honouring a tool call there would turn
 * an unbounded loop back on, and the text arrives from a model that has
 * already been fed retrieved documents — treating markup found in that
 * position as an instruction is the shape of a prompt-injection sink.
 *
 * So the markup is removed, the fact is recorded, and whatever prose the
 * model wrote around it survives. When nothing survives, the caller
 * substitutes an honest message rather than showing an empty bubble.
 */

/**
 * Wrappers seen or plausible from OpenAI-compatible providers. Matched
 * case-insensitively, non-greedily, across newlines.
 *
 * `[\s\S]*?` rather than `.*?` because the payload is multi-line, and
 * non-greedy so two separate blocks in one message are removed as two
 * blocks instead of everything between the first open and the last
 * close.
 */
const TOOL_CALL_BLOCKS: readonly RegExp[] = [
  // <minimax:tool_call> … </minimax:tool_call>, and any other namespace.
  /<([a-z0-9_-]+:)?tool_call>[\s\S]*?<\/([a-z0-9_-]+:)?tool_call>/gi,
  /<([a-z0-9_-]+:)?function_calls>[\s\S]*?<\/([a-z0-9_-]+:)?function_calls>/gi,
  /<invoke\b[\s\S]*?<\/invoke>/gi,
  /<tool_use\b[\s\S]*?<\/tool_use>/gi,
];

/**
 * An *unterminated* opener. A stream cut short mid-call leaves the
 * opening tag and its parameters with no closing tag, and the blocks
 * above will not match it — so the user would still see
 * `<minimax:tool_call>` followed by half a query.
 */
const TOOL_CALL_TAIL = /<([a-z0-9_-]+:)?(tool_call|function_calls|invoke|tool_use)\b[\s\S]*$/i;

export interface ScrubbedAnswer {
  text: string;
  /** True when markup was found. The caller logs this: a provider
   *  emitting tool calls as prose is an integration fact worth seeing
   *  in metrics, not something to silently absorb forever. */
  hadToolCallMarkup: boolean;
}

/**
 * Text that only introduces something. 「让我再用其他关键词搜索一下：」
 * is the observed one; the rest are the same move in other words.
 *
 * Only consulted when the model *also* tried to call a tool in round 2
 * — see `isPreambleOnly` for why that pairing is what makes this safe.
 *
 * Deliberately only the patterns that *announce an action*. An earlier
 * draft also treated "ends with a colon" and "ends with 一下/看看" as
 * lead-ins, and both ate legitimate answers: 「…你可以照着跟医生确认：」
 * is a real answer, and the system prompt actively encourages warm
 * closings like 「咱们一起看看」. The announce-an-action patterns cover
 * the observed failure on their own.
 */
const LEAD_IN_MARKERS: readonly RegExp[] = [
  // Announces a *future* lookup. Unanchored, because the model
  // routinely opens with an acknowledgement first: 「我看到你的报告了，
  // 让我再查一下FSHD病情发展相关的医学信息，这样能给你更准确的解读。」
  // reached a patient in full — 43 characters, no answer in any of
  // them — because the earlier `^`-anchored version only looked at the
  // first clause.
  //
  // The verb must carry an announcing prefix (让我/我来/我去/我再/再) or
  // the prospective 「…一下」. That is what separates it from a report of
  // something already done —「这份报告我查了，各项都正常」,「检索到的资料
  // 显示…」— which are answers and must survive.
  /(让我|我来|我去|我再|再)\s*(重新)?\s*(搜索|检索|查询|查一下|查查|找一下|找找)/,
  /(搜索|检索|查询|查阅)一下/,
  /^(稍等|请稍候|马上|这就)/,
];

/** Prose longer than this stands on its own even if a stray tool call
 *  followed it, so it is never discarded. Deliberately generous: losing
 *  a real answer is worse than showing a slightly odd trailing line. */
const STANDS_ALONE_MIN_CHARS = 80;

/**
 * Is this "answer" merely the sentence that would have introduced a
 * search?
 *
 * Round 2 is the last round, so nothing it announces can happen. A
 * patient asked「有什么需要注意的」and the bubble said, in full,
 *「让我再用其他关键词搜索一下：」— a promise rather than an answer,
 * recorded as a success.
 *
 * Detection is by wording, and deliberately so after trying the
 * alternative. "Round 2 reached for a tool" looks like a sturdier
 * signal — it cannot be dodged by rephrasing — but it does not
 * discriminate at the lengths that matter: the observed preamble is 43
 * characters and a real answer 「需要留意的主要是三点：呼吸功能每年查一
 * 次、体重别掉太快…」 is 47, so treating a stray tool call as proof
 * threw away the second to catch the first. The tests keep that
 * regression pinned.
 *
 * An earlier version instead made the tool call a *gate* on the
 * wording, which was worse still: a bare announcement with no call
 * attached sailed straight through to the user.
 *
 * So: wording, unanchored, under a length cap. The cap is what keeps
 * it safe — prose long enough to stand on its own is never discarded,
 * however it begins.
 */
export const isPreambleOnly = (text: string): boolean => {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.length >= STANDS_ALONE_MIN_CHARS) return false;
  return LEAD_IN_MARKERS.some((pattern) => pattern.test(trimmed));
};

export const scrubToolCallMarkup = (raw: string): ScrubbedAnswer => {
  let text = raw ?? '';
  const before = text;

  for (const pattern of TOOL_CALL_BLOCKS) {
    text = text.replace(pattern, '');
  }
  text = text.replace(TOOL_CALL_TAIL, '');

  // Whether markup was found has to be decided BEFORE the cosmetic
  // collapse below, or ordinary Markdown with a run of blank lines
  // reports markup that was never there — and the caller logs that as
  // an integration fact about the provider.
  const hadToolCallMarkup = text !== before;

  // Collapse the blank lines the removal left behind so the surviving
  // prose does not arrive with a hole in the middle of it.
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return { text, hadToolCallMarkup };
};

/** Openers we hold back on, by name. Kept next to TOOL_CALL_BLOCKS so
 *  the streaming guard and the final scrub cannot drift apart. */
const OPENER_NAMES = ['tool_call', 'function_calls', 'invoke', 'tool_use'] as const;

/** Could `tail` still grow into one of the openers above? Matches a
 *  complete opener as well as any prefix of one, since a chunk boundary
 *  can fall anywhere — `<min`, `<minimax:tool_c`, `<invoke name="…`. */
const couldBecomeOpener = (tail: string): boolean => {
  if (!tail.startsWith('<')) return false;
  const rest = tail.slice(1).toLowerCase();
  // A tag name cannot start with whitespace, and「CK 值 < 5 mg/L」is
  // ordinary in a lab answer. Without this the scrubber held everything
  // after that `<` until the stream ended, so the answer stopped
  // mid-sentence on screen and then arrived all at once.
  if (rest.length > 0 && /^\s/.test(rest)) return false;
  const afterNamespace = rest.includes(':') ? rest.slice(rest.indexOf(':') + 1) : rest;
  // A namespace prefix still being typed: `<min`, `<minimax`.
  if (!rest.includes(':') && /^[a-z0-9_-]*$/.test(rest)) {
    if (OPENER_NAMES.some((n) => n.startsWith(rest))) return true;
    // Ambiguous while it is still only letters — it may be a namespace.
    if (rest.length <= 12) return true;
  }
  return OPENER_NAMES.some((name) => name.startsWith(afterNamespace.split(/[\s>]/)[0] ?? ''));
};

/**
 * The same scrub, applied to a token stream.
 *
 * `scrubToolCallMarkup` runs on the completed content, which is what
 * the client finally renders — but the streaming route emits every
 * `answer_delta` the instant it arrives, unfiltered. So when the
 * provider wrote its tool call as prose, the patient watched
 * `<minimax:tool_call>` type itself out character by character before
 * the `done` frame swapped it for the cleaned text. The defect
 * answer-text.ts exists to prevent was still fully visible; it just
 * didn't survive to the end of the animation.
 *
 * Strategy: emit everything up to a `<` that could still become an
 * opener, and hold the rest. If the held text resolves into something
 * harmless, it flushes on the next chunk; if it turns into a real
 * opener, it stays held until the matching close (dropped) or until
 * `flush()` at end of stream, which runs the full scrub over whatever
 * is left. Nothing is emitted that the final scrub would have removed.
 */
export class StreamingAnswerScrubber {
  private held = '';
  /** Name of the opener currently being suppressed, or null. */
  private suppressing: string | null = null;

  /** Feed one delta; returns the text that is safe to emit now. */
  push(chunk: string): string {
    this.held += chunk;

    if (this.suppressing) {
      // Its OWN closing tag, not merely the next one. A `<tool_call>`
      // wraps an `<invoke>`, so matching any close ended suppression at
      // the inner `</invoke>` and let `</tool_call>` through — which is
      // exactly the markup this class exists to withhold.
      const closed = this.held.match(new RegExp(`</([a-z0-9_-]+:)?${this.suppressing}>`, 'i'));
      if (!closed) return '';
      this.held = this.held.slice((closed.index ?? 0) + closed[0].length);
      this.suppressing = null;
    }

    const open = this.held.match(/<([a-z0-9_-]+:)?(tool_call|function_calls|invoke|tool_use)\b/i);
    if (open) {
      const safe = this.held.slice(0, open.index);
      this.held = this.held.slice(open.index);
      this.suppressing = open[2].toLowerCase();
      // Re-enter to consume a close that arrived in the same chunk.
      return safe + this.push('');
    }

    // No confirmed opener. Hold back a trailing `<…` that might be the
    // start of one; release everything before it.
    const lastOpen = this.held.lastIndexOf('<');
    if (lastOpen >= 0 && couldBecomeOpener(this.held.slice(lastOpen))) {
      const safe = this.held.slice(0, lastOpen);
      this.held = this.held.slice(lastOpen);
      return safe;
    }

    const safe = this.held;
    this.held = '';
    return safe;
  }

  /** End of stream: scrub and return whatever was still held. */
  flush(): string {
    const remaining = this.held;
    this.held = '';
    this.suppressing = null;
    return scrubToolCallMarkup(remaining).text;
  }
}
