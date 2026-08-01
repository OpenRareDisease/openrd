/**
 * Turn an LLM answer into blocks this app can actually draw.
 *
 * Why this exists
 * ---------------
 * Every surface that shows an AI answer renders it into text. The
 * model, meanwhile, writes Markdown, because that is what models do.
 * So patients were reading this, verbatim, on screen:
 *
 *     ### 1️⃣ 基因检测报告（这个最重要）
 *     ---
 *     - **D4Z4重复数**：3次
 *     | 项目 | 你的结果 | 正常情况 |
 *     |------|----------|----------|
 *
 * The hashes, the pipes and the dashes are not decoration the reader
 * can look past: a three-column table collapses into ragged pipe soup
 * on a 375pt screen, and it lands on the exact sentence carrying the
 * patient's own numbers.
 *
 * The orchestrator's system prompt takes the opposite tack — it tells
 * the model Markdown *is* rendered and to use it — which makes this
 * parser load-bearing rather than defensive. Either way the reasoning
 * is the same: instruction-following is not a guarantee, and the
 * failure mode is ugly rather than loud. Nothing errors; the patient
 * just gets a worse answer. So the client parses what arrives instead
 * of trusting what was asked for.
 *
 * Scope
 * -----
 * The constructs a model writing Chinese clinical prose actually
 * emits: headings, paragraphs, ordered and unordered lists (one level
 * of nesting), blockquotes, fenced and inline code, tables, thematic
 * breaks, and inline bold / italic / strikethrough / links. Anything
 * else falls through as a paragraph, which is what it looks like today
 * anyway.
 *
 * Two deliberate departures from CommonMark, both because the target
 * is a 375pt phone rather than a document:
 *
 *  - **Tables flatten to label/value pairs.** See `flattenTable`.
 *  - **`_` never italicises intra-word.** This app puts OCR field keys
 *    on screen — `stool_occult_blood`, `trust_ab` — and CommonMark's
 *    own intraword rule is the only thing standing between those and
 *    「stool occult blood」 with a randomly slanted middle word.
 */

export type AnswerBlock =
  | { kind: 'heading'; level: number; spans: TextSpan[] }
  | { kind: 'paragraph'; spans: TextSpan[] }
  /** `marker` is '·' for a bullet or the literal '1.' for an ordered
   *  item — the ordinal is data when the list is a set of steps. */
  | { kind: 'listItem'; marker: string; depth: number; spans: TextSpan[] }
  | { kind: 'quote'; spans: TextSpan[] }
  | { kind: 'code'; text: string }
  | { kind: 'rule' }
  /** A table row, flattened to label + value. See `flattenTable`. */
  | { kind: 'pair'; label: string; spans: TextSpan[] };

export interface TextSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  /** Present on a link; `text` is the label. */
  href?: string;
}

/* ------------------------------------------------------------------ */
/* Inline                                                              */
/* ------------------------------------------------------------------ */

/**
 * One pass over a line, longest-marker-first so `***x***` is not eaten
 * by the `**` rule and `~~` is not eaten by `~`.
 *
 * Ordering inside the alternation is the whole algorithm; changing it
 * changes what wins. Escapes come first so `\*` never opens emphasis,
 * and code spans come before emphasis so `` `a * b` `` stays literal.
 */
const INLINE_SOURCE = [
  // Escapes first, so `\*` can never open emphasis.
  /\\(?<esc>[\\`*_~[\]()#|-])/,
  // Code before emphasis, so `` `a ** b` `` stays literal. The closing
  // run is matched with a *named* backreference: a numeric `\1` silently
  // retargets group 1 of the *combined* pattern — which is the escape
  // group — and inline code stopped working the moment these
  // alternatives were concatenated.
  /(?<tick>`+)(?<code>[\s\S]*?)\k<tick>/,
  /\[(?<link>[^\]\n]*)\]\((?<href>[^)\s]+)\)/,
  /\*\*\*(?<bi>[^\n]+?)\*\*\*/,
  // `**很重要的 *提醒***` — italic closing at the very end of a bold
  // run. Both delimiters collide into `***`, and the plain `**` rule
  // below consumes two of the three, leaving a bare `*` on screen.
  // Split explicitly: the head stays bold, the tail is bold+italic.
  /\*\*(?<bHead>[^*\n]*)\*(?<biTail>[^*\n]+?)\*\*\*/,
  /\*\*(?<b>[^\n]+?)\*\*/,
  /~~(?<s>[^\n]+?)~~/,
  /\*(?<i1>[^*\n]+?)\*/,
  // Never intra-word: this app renders OCR field keys, and
  // `stool_occult_blood` must not become 「stool occult blood」.
  /(?<![0-9A-Za-z_])_(?<i2>[^_\n]+?)_(?![0-9A-Za-z_])/,
]
  .map((r) => r.source)
  .join('|');

/**
 * A fresh matcher per call.
 *
 * `parseSpans` recurses into the content of every emphasis run, and a
 * module-level /g/ regex carries `lastIndex` as mutable state — so the
 * inner call reset the position the outer loop was walking, the outer
 * loop restarted from the top, and the whole thing ran until the heap
 * died. Building the regex here gives each nesting level its own
 * cursor.
 */
const inlineMatcher = (): RegExp => new RegExp(INLINE_SOURCE, 'g');

const push = (spans: TextSpan[], span: TextSpan) => {
  if (!span.text) return;
  spans.push(span);
};

/** Apply the enclosing style to spans produced by a nested parse. */
const inherit = (spans: TextSpan[], style: Partial<TextSpan>): TextSpan[] =>
  spans.map((span) => ({ ...style, ...span }));

export const parseSpans = (line: string): TextSpan[] => {
  const spans: TextSpan[] = [];
  const matcher = inlineMatcher();
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(line)) !== null) {
    // A zero-width match would spin forever. Cannot happen with the
    // patterns above (every branch consumes at least two characters),
    // but the guard costs nothing and an infinite loop in a render
    // path costs everything.
    if (match[0].length === 0) {
      matcher.lastIndex += 1;
      continue;
    }
    if (match.index > last) push(spans, { text: line.slice(last, match.index) });

    const g = match.groups ?? {};

    if (g.esc !== undefined) {
      push(spans, { text: g.esc });
    } else if (g.code !== undefined) {
      // Literal by definition — no nested parse, or `` `**` `` bolds.
      push(spans, { text: g.code, code: true });
    } else if (g.link !== undefined) {
      // The label carries the meaning; the URL is kept so a renderer
      // can make it tappable, and stands in as the label when a model
      // writes `[](https://…)`.
      spans.push(...inherit(parseSpans(g.link || g.href), { href: g.href }));
    } else if (g.bi !== undefined) {
      spans.push(...inherit(parseSpans(g.bi), { bold: true, italic: true }));
    } else if (g.biTail !== undefined) {
      if (g.bHead) spans.push(...inherit(parseSpans(g.bHead), { bold: true }));
      spans.push(...inherit(parseSpans(g.biTail), { bold: true, italic: true }));
    } else if (g.b !== undefined) {
      spans.push(...inherit(parseSpans(g.b), { bold: true }));
    } else if (g.s !== undefined) {
      spans.push(...inherit(parseSpans(g.s), { strike: true }));
    } else if (g.i1 !== undefined) {
      spans.push(...inherit(parseSpans(g.i1), { italic: true }));
    } else if (g.i2 !== undefined) {
      spans.push(...inherit(parseSpans(g.i2), { italic: true }));
    }

    last = match.index + match[0].length;
  }

  if (last < line.length) push(spans, { text: line.slice(last) });
  return spans.length > 0 ? spans : [{ text: line }];
};

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

/** A line belongs to a pipe block if it carries an unescaped `|`.
 *
 *  Outer pipes are optional: `项目 | 结果` is a table in GFM and is what
 *  a model writes about half the time. Requiring them meant those
 *  tables fell through to paragraphs and landed on screen as the exact
 *  pipe soup this module exists to remove. */
const isPipeLine = (line: string): boolean => /(?<!\\)\|/.test(line);

/** `|---|:--:|` — the alignment row. Requires at least one dash so a
 *  data row of literal dashes is not mistaken for it. */
const isTableDivider = (line: string): boolean =>
  /-/.test(line) && /^\|?[\s|:-]+\|?$/.test(line.trim());

/** Split on unescaped pipes, then unescape. Splitting on every `|`
 *  turned a cell containing `a \| b` into two cells and shifted every
 *  column after it one to the left. */
const splitRow = (line: string): string[] => {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
};

/**
 * Flatten a pipe block into label/value pairs.
 *
 * A table is a layout for a wide screen; this app has 375pt and a
 * column of Chinese labels. Rather than drop the table (losing the
 * data) or draw it (losing the legibility), each row becomes
 *「颜色：黄色（正常 黄色、棕色）」— the first column labels, the
 * second answers, and any further columns become a parenthetical,
 * which is what a reference range is anyway.
 *
 * A block with no divider row is treated as all-data rather than
 * discarded. Two separate bugs came from assuming row 0 is always a
 * header: a lone `| TPPA | 阴性 |` vanished, and so did the first row
 * after a blank line inside a table, because the block restarted and
 * ate that row as a header nobody asked for.
 */
const flattenTable = (rows: string[][], headerRow: string[] | null): AnswerBlock[] =>
  rows.map((cells) => {
    const [label = '', value = '', ...rest] = cells;
    const extras = rest
      .map((cell, i) => {
        const name = headerRow?.[i + 2];
        return cell ? (name ? `${name} ${cell}` : cell) : '';
      })
      .filter(Boolean);
    const tail = extras.length > 0 ? `（${extras.join('，')}）` : '';
    return { kind: 'pair' as const, label, spans: parseSpans(`${value}${tail}`) };
  });

/** Decide what a run of pipe lines actually is, then flatten it. */
const parsePipeBlock = (lines: string[]): AnswerBlock[] => {
  const dividerAt = lines.findIndex(isTableDivider);

  // No divider: this is either a table the model wrote without one, or
  // a single line of prose that happens to contain a pipe. Outer pipes
  // decide — prose rarely starts and ends with one.
  if (dividerAt === -1) {
    const looksTabular = lines.every((l) => l.trim().startsWith('|') && l.trim().endsWith('|'));
    if (!looksTabular) {
      return lines.map((l) => ({ kind: 'paragraph' as const, spans: parseSpans(l.trim()) }));
    }
    return flattenTable(lines.map(splitRow), null);
  }

  const header = dividerAt > 0 ? splitRow(lines[dividerAt - 1]) : null;
  const body = lines.filter((_, i) => i !== dividerAt && i !== dividerAt - 1).map(splitRow);
  return flattenTable(body, header);
};

/* ------------------------------------------------------------------ */
/* Blocks                                                              */
/* ------------------------------------------------------------------ */

/** `#` opens a heading only when a space follows it — otherwise
 *  「#1 号染色体」and a hashtag both become headings. A run longer than
 *  six is not a heading in CommonMark either. */
const HEADING = /^(#{1,6})\s+(.*?)\s*#*$/;
const BULLET = /^([-*+•])\s+(.+)$/;
const ORDERED = /^(\d{1,3})[.)]\s+(.+)$/;
/** `- [ ] 复查` / `- [x] 已完成`. Stripped off the item text so the
 *  brackets do not show; the box becomes the marker. */
const TASK = /^\[([ xX])\]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const FENCE = /^(```|~~~)(.*)$/;
/** `---`, `***`, `___` on their own. Checked *after* the list rules so
 *  a `- ` item is never mistaken for one. */
const RULE = /^([-*_])\s*(?:\1\s*){2,}$/;
/** The underline of a setext heading: `===` (h1) or `---` (h2). */
const SETEXT = /^(=+|-+)$/;

/** Two spaces of indent per level, tab counts as four. Capped at one
 *  nested level — deeper nesting on a phone is a horizontal budget
 *  nobody has. */
const indentColumns = (line: string): number =>
  (line.match(/^[ \t]*/)?.[0] ?? '').replace(/\t/g, '    ').length;

export const parseAnswer = (raw: string): AnswerBlock[] => {
  const blocks: AnswerBlock[] = [];
  const lines = (raw ?? '').split('\n');

  let pipeBlock: string[] = [];
  let fence: string | null = null;
  let code: string[] = [];
  /** Indent of the list item currently open, so a continuation line
   *  can be told from a new paragraph. -1 when no list is open. */
  let openListIndent = -1;
  /** Whether the previous source line was blank. A setext underline
   *  has to touch the paragraph it underlines; a `---` with a blank
   *  line above it is a thematic break. */
  let previousLineBlank = true;

  const flushPipes = () => {
    if (pipeBlock.length > 0) {
      blocks.push(...parsePipeBlock(pipeBlock));
      pipeBlock = [];
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];

    // Inside a fence everything is literal, including blank lines and
    // anything that looks like another construct.
    if (fence !== null) {
      if (rawLine.trim().startsWith(fence)) {
        blocks.push({ kind: 'code', text: code.join('\n') });
        fence = null;
        code = [];
      } else {
        code.push(rawLine);
      }
      continue;
    }

    const columns = indentColumns(rawLine);
    const depth = Math.min(1, Math.floor(columns / 2));
    const line = rawLine.trim();

    const fenceOpen = line.match(FENCE);
    if (fenceOpen) {
      flushPipes();
      fence = fenceOpen[1];
      openListIndent = -1;
      continue;
    }

    if (isPipeLine(line)) {
      pipeBlock.push(line);
      continue;
    }
    flushPipes();

    if (!line) {
      // A blank line closes an open list item, so the next paragraph
      // is a paragraph rather than a continuation of it.
      openListIndent = -1;
      previousLineBlank = true;
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, spans: parseSpans(heading[2]) });
      openListIndent = -1;
      previousLineBlank = false;
      continue;
    }

    // A setext underline turns the paragraph above it into a heading,
    // rather than printing `===` on its own line. Two conditions, and
    // the second one is not optional:
    //
    //  - only a paragraph can be promoted (an underline after a list
    //    item is not setext), and
    //  - the underline must *touch* that paragraph.
    //
    // Without the adjacency test, every `---` a model writes as a
    // section divider promoted whatever paragraph came before it. It
    // was observed on screen: a three-line paragraph of advice about
    // 呼吸功能 rendered at heading size and weight because a `---`
    // appeared two lines below it.
    const setext = line.match(SETEXT);
    const previous = blocks[blocks.length - 1];
    if (setext && !previousLineBlank && previous?.kind === 'paragraph') {
      blocks[blocks.length - 1] = {
        kind: 'heading',
        level: setext[1].startsWith('=') ? 1 : 2,
        spans: previous.spans,
      };
      previousLineBlank = false;
      continue;
    }

    const ordered = line.match(ORDERED);
    const bullet = line.match(BULLET);
    if (ordered || bullet) {
      const text = (ordered ? ordered[2] : bullet![2]).trim();
      const task = text.match(TASK);
      blocks.push({
        kind: 'listItem',
        marker: task
          ? task[1].toLowerCase() === 'x'
            ? '☑'
            : '☐'
          : ordered
            ? `${ordered[1]}.`
            : '·',
        depth,
        spans: parseSpans(task ? task[2] : text),
      });
      openListIndent = columns;
      previousLineBlank = false;
      continue;
    }

    // Checked after the list rules, so `- item` wins over `---`.
    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' });
      openListIndent = -1;
      previousLineBlank = false;
      continue;
    }

    const quote = line.match(QUOTE);
    if (quote) {
      blocks.push({ kind: 'quote', spans: parseSpans(quote[1]) });
      openListIndent = -1;
      previousLineBlank = false;
      continue;
    }

    // An indented line under an open list item is that item's second
    // sentence, not a new block. Emitting it flush-left broke the
    // numbering visually — 「1. 先做基因检测 / 这一步需要空腹。/ 2. …」
    // read as a step, an unrelated remark, and another step.
    const last = blocks[blocks.length - 1];
    if (openListIndent >= 0 && columns > openListIndent && last?.kind === 'listItem') {
      last.spans = [...last.spans, { text: ' ' }, ...parseSpans(line)];
      previousLineBlank = false;
      continue;
    }

    blocks.push({ kind: 'paragraph', spans: parseSpans(line) });
    openListIndent = -1;
    previousLineBlank = false;
  }

  // An unterminated fence still has to render — the model got cut off
  // mid-block, and dropping the text would hide the answer's tail.
  if (fence !== null && code.length > 0) {
    blocks.push({ kind: 'code', text: code.join('\n') });
  }
  flushPipes();

  return blocks;
};

/**
 * The same answer as one line of plain text.
 *
 * For the places that show a *preview* of model prose — a report card
 * clamped to three lines, a timeline row clamped to one. Those cannot
 * use `<AnswerText>`, because it renders a `<View>` stack and
 * `numberOfLines` does not cross a View boundary; dropping it in would
 * silently remove the clamp and let one card push the next one off the
 * screen. So the preview keeps its `<Text>` and loses the syntax
 * instead of the clamp.
 */
export const plainAnswerText = (raw: string): string =>
  parseAnswer(raw)
    .map((block) => {
      switch (block.kind) {
        case 'rule':
          return '';
        case 'code':
          return block.text;
        case 'pair':
          return `${block.label}：${block.spans.map((s) => s.text).join('')}`;
        default:
          return block.spans.map((s) => s.text).join('');
      }
    })
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
