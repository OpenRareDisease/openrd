import { describe, expect, it } from 'vitest';

import { StreamingAnswerScrubber, isPreambleOnly, scrubToolCallMarkup } from './answer-text.js';

describe('scrubToolCallMarkup', () => {
  // Shown to a patient, as the answer, in the chat bubble.
  it('removes the block a provider wrote into content', () => {
    const raw = [
      '<minimax:tool_call>',
      '<invoke name="search_medical_kb">',
      '<parameter name="query">面肩肱型肌营养不良 基因检测 诊断 标准</parameter>',
      '<parameter name="limit">5</parameter>',
      '</invoke>',
      '</minimax:tool_call>',
    ].join('\n');

    const { text, hadToolCallMarkup } = scrubToolCallMarkup(raw);
    expect(text).toBe('');
    expect(hadToolCallMarkup).toBe(true);
  });

  it('keeps the prose written around the markup', () => {
    const { text } = scrubToolCallMarkup(
      '我先查一下知识库。\n\n<minimax:tool_call>\n<invoke name="x"></invoke>\n</minimax:tool_call>\n\n稍等。',
    );
    expect(text).toBe('我先查一下知识库。\n\n稍等。');
  });

  // A stream cut short leaves the opening tag with no closer, so the
  // block patterns never match it.
  it('removes an unterminated opener and everything after it', () => {
    const { text, hadToolCallMarkup } = scrubToolCallMarkup(
      '这是结论。\n<minimax:tool_call>\n<invoke name="search_medical_kb">\n<parameter name="q">被截断',
    );
    expect(text).toBe('这是结论。');
    expect(hadToolCallMarkup).toBe(true);
  });

  it('removes two separate blocks as two blocks', () => {
    const { text } = scrubToolCallMarkup(
      'A<tool_call><invoke name="a"></invoke></tool_call>B<tool_call><invoke name="b"></invoke></tool_call>C',
    );
    expect(text).toBe('ABC');
  });

  it('leaves an ordinary answer untouched', () => {
    const answer = '这是一份大便常规报告，各项都正常。\n\n- 颜色：黄色\n- 红细胞：阴性';
    const { text, hadToolCallMarkup } = scrubToolCallMarkup(answer);
    expect(text).toBe(answer);
    expect(hadToolCallMarkup).toBe(false);
  });

  // The scrubber must not eat prose that merely mentions a tool name,
  // which the assistant does legitimately —「我调用了 get_my_reports」.
  it('does not touch a tool name mentioned in prose', () => {
    const answer = '我调用了 get_my_reports 来读你的报告。';
    expect(scrubToolCallMarkup(answer).text).toBe(answer);
  });

  it('survives empty input', () => {
    expect(scrubToolCallMarkup('')).toEqual({ text: '', hadToolCallMarkup: false });
  });
});

describe('isPreambleOnly', () => {
  // The reported bug: a patient asked「有什么需要注意的」and the whole
  // answer was the sentence that introduced a search which, this being
  // the last round, never ran.
  it('catches the observed 让我再用其他关键词搜索一下 case', () => {
    expect(isPreambleOnly('让我再用其他关键词搜索一下：')).toBe(true);
  });

  it.each(['我再查一下：', '让我搜索一下', '稍等，我看看', '我再找找看：'])(
    'catches lead-in %j',
    (text) => {
      expect(isPreambleOnly(text)).toBe(true);
    },
  );

  // Reported a second time, in a shape the first fix missed: the model
  // opens with an acknowledgement and only announces the search in the
  // *second* clause, so an `^`-anchored marker never saw it. The whole
  // message reached the patient, 43 characters with no answer in any of
  // them.
  it('catches a lead-in that follows an acknowledgement', () => {
    expect(
      isPreambleOnly(
        '我看到你的报告了，让我再查一下FSHD病情发展相关的医学信息，这样能给你更准确的解读。',
      ),
    ).toBe(true);
  });

  // Unanchoring must not start eating reports of work already done —
  // those are answers.
  it.each([
    ['这份报告我查了，各项都正常。'],
    ['我查过你的记录，最近三次都在正常范围。'],
    ['检索到的资料显示，低强度有氧运动是安全的。'],
    ['建议每年复查一次肺功能，具体安排跟你的主治医生确认。'],
    ['你的报告里没有查出异常。'],
  ])('keeps the past-tense answer %j', (text) => {
    expect(isPreambleOnly(text)).toBe(false);
  });

  // The lead-in is the identical broken output whether or not a tool
  // call came with it — the model sometimes writes one and no call at
  // all, and that used to reach the user untouched.
  it('fires on a bare lead-in with no tool call attached', () => {
    expect(isPreambleOnly('让我再用其他关键词搜索一下：')).toBe(true);
  });

  it('keeps a real answer that happens to end in a colon', () => {
    const answer = '这份报告里有三个数值需要留意，我按重要程度排一下，你可以照着跟医生确认：';
    expect(isPreambleOnly(answer)).toBe(false);
  });

  it('keeps a substantial answer even if a stray tool call followed it', () => {
    const answer = '你的膈肌超声结果在正常范围内，呼吸功能这块暂时不用担心。'.repeat(2);
    expect(isPreambleOnly(answer)).toBe(false);
  });

  it('ignores empty text', () => {
    expect(isPreambleOnly('')).toBe(false);
  });
});

describe('StreamingAnswerScrubber', () => {
  const run = (chunks: string[]) => {
    const s = new StreamingAnswerScrubber();
    return chunks.map((c) => s.push(c)).join('') + s.flush();
  };

  it('passes ordinary prose straight through', () => {
    expect(run(['你的报告', '看起来', '都正常。'])).toBe('你的报告看起来都正常。');
  });

  // The defect: deltas went out raw, so the patient watched the XML
  // type itself out before `done` replaced it.
  it('never emits a tool-call block, even split across chunks', () => {
    const out = run([
      '让我查一下：',
      '<minimax:tool_',
      'call>\n<invoke name="search_medical_kb">',
      '\n<parameter name="query">FSHD</parameter>\n</invoke>\n',
      '</minimax:tool_call>',
      '结果如下。',
    ]);
    expect(out).not.toContain('<');
    expect(out).toBe('让我查一下：结果如下。');
  });

  it('drops an unterminated call left by a cut stream', () => {
    const out = run(['分析中。', '<tool_call><invoke name="x">', '<parameter name="q">FS']);
    expect(out).toBe('分析中。');
  });

  it('releases a < that turns out to be ordinary text', () => {
    expect(run(['数值 <', ' 5 mg/L 属于正常。'])).toBe('数值 < 5 mg/L 属于正常。');
  });

  // The joined-output assertions above cannot see WHEN text came out,
  // and that turned out to matter:「CK 值 < 5 mg/L」is ordinary in a lab
  // answer, and the scrubber held everything after that `<` until the
  // stream ended — so the answer stopped mid-sentence on screen and
  // then arrived all at once. Assert per-chunk release, not the total.
  it('does not stall the stream on a lab comparison', () => {
    const scrubber = new StreamingAnswerScrubber();
    const emitted = ['CK 值 ', '< ', '5 mg/L 属于正常，', '不用担心。'].map((c) =>
      scrubber.push(c),
    );
    // Nothing withheld: every chunk leaves as it arrives.
    expect(emitted.filter((e) => e === '')).toHaveLength(0);
    expect(scrubber.flush()).toBe('');
  });

  it('still withholds a < that really is starting a tool call', () => {
    const scrubber = new StreamingAnswerScrubber();
    expect(scrubber.push('分析：')).toBe('分析：');
    // Held — this one could still become an opener.
    expect(scrubber.push('<minimax:tool_')).toBe('');
    expect(scrubber.push('call><invoke name="x"></invoke></minimax:tool_call>')).toBe('');
    expect(scrubber.push('结果。')).toBe('结果。');
  });

  it('handles a whole block arriving in one chunk', () => {
    expect(run(['A<tool_call><invoke name="a"></invoke></tool_call>B'])).toBe('AB');
  });
});
