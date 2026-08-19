import { parseAnswer, parseSpans, plainAnswerText } from '../answer-format';

describe('parseSpans — inline', () => {
  it('splits bold runs out of a line', () => {
    expect(parseSpans('**D4Z4重复数**：3次')).toEqual([
      { text: 'D4Z4重复数', bold: true },
      { text: '：3次' },
    ]);
  });

  it('leaves an unmatched marker alone rather than eating the rest', () => {
    expect(parseSpans('结果是 **阴性')).toEqual([{ text: '结果是 **阴性' }]);
  });

  it('handles italic, strikethrough and bold-italic', () => {
    expect(parseSpans('*轻度*')).toEqual([{ text: '轻度', italic: true }]);
    expect(parseSpans('~~已停用~~')).toEqual([{ text: '已停用', strike: true }]);
    expect(parseSpans('***非常重要***')).toEqual([{ text: '非常重要', bold: true, italic: true }]);
  });

  it('nests emphasis', () => {
    expect(parseSpans('**很重要的 *提醒***')).toEqual([
      { text: '很重要的 ', bold: true },
      { text: '提醒', bold: true, italic: true },
    ]);
  });

  // This app puts OCR field keys on screen. CommonMark's intraword rule
  // is the only thing keeping `stool_occult_blood` from rendering as
  // 「stool occult blood」 with a slanted middle.
  it('never italicises an underscore inside a word', () => {
    expect(parseSpans('stool_occult_blood 阴性')).toEqual([{ text: 'stool_occult_blood 阴性' }]);
    expect(parseSpans('trust_ab 与 tppa')).toEqual([{ text: 'trust_ab 与 tppa' }]);
  });

  it('italicises a standalone underscore pair', () => {
    expect(parseSpans('_注意_ 复查')).toEqual([{ text: '注意', italic: true }, { text: ' 复查' }]);
  });

  it('keeps inline code literal', () => {
    expect(parseSpans('字段是 `**not bold**` 哦')).toEqual([
      { text: '字段是 ' },
      { text: '**not bold**', code: true },
      { text: ' 哦' },
    ]);
  });

  it('reads a link as label plus href', () => {
    expect(parseSpans('见 [FSHD 协会](https://example.org/a)')).toEqual([
      { text: '见 ' },
      { text: 'FSHD 协会', href: 'https://example.org/a' },
    ]);
  });

  it('falls back to the url when the label is empty', () => {
    expect(parseSpans('[](https://example.org)')).toEqual([
      { text: 'https://example.org', href: 'https://example.org' },
    ]);
  });

  it('honours a backslash escape', () => {
    expect(parseSpans('乘号 \\* 不是强调 \\*')).toEqual([
      { text: '乘号 ' },
      { text: '*' },
      { text: ' 不是强调 ' },
      { text: '*' },
    ]);
  });
});

describe('parseAnswer — blocks', () => {
  // Verbatim from an answer a patient was shown: hashes, a rule and a
  // three-column table, all rendered as literal characters.
  it('handles the shape these answers actually arrive in', () => {
    const blocks = parseAnswer(
      [
        '### 1️⃣ 基因检测报告（这个最重要）',
        '',
        '---',
        '',
        '- **D4Z4重复数**：3次',
        '',
        '| 项目 | 你的结果 | 正常情况 |',
        '|------|----------|----------|',
        '| 颜色 | 黄色 | 黄色、棕色 |',
      ].join('\n'),
    );

    expect(blocks).toEqual([
      { kind: 'heading', level: 3, spans: [{ text: '1️⃣ 基因检测报告（这个最重要）' }] },
      { kind: 'rule' },
      {
        kind: 'listItem',
        marker: '·',
        depth: 0,
        spans: [{ text: 'D4Z4重复数', bold: true }, { text: '：3次' }],
      },
      { kind: 'pair', label: '颜色', spans: [{ text: '黄色（正常情况 黄色、棕色）' }] },
    ]);
  });

  // The ordinal is data when the list is a set of steps —「第 3 步」has
  // to survive. An earlier cut rendered every list marker as '·'.
  it('keeps the number on an ordered list', () => {
    expect(parseAnswer(['1. 先量血压', '2. 再记录', '10) 最后复查'].join('\n'))).toEqual([
      { kind: 'listItem', marker: '1.', depth: 0, spans: [{ text: '先量血压' }] },
      { kind: 'listItem', marker: '2.', depth: 0, spans: [{ text: '再记录' }] },
      { kind: 'listItem', marker: '10.', depth: 0, spans: [{ text: '最后复查' }] },
    ]);
  });

  it('records one level of nesting', () => {
    const blocks = parseAnswer(['- 上肢', '  - 三角肌', '      - 更深的也只算一层'].join('\n'));
    expect(blocks.map((b) => (b.kind === 'listItem' ? b.depth : null))).toEqual([0, 1, 1]);
  });

  // `#` opens a heading only before a space. Without that,「#1 号染色体」
  // becomes a heading, and so does a hashtag.
  it('does not treat a bare # as a heading', () => {
    expect(parseAnswer('#1 号染色体上没有')).toEqual([
      { kind: 'paragraph', spans: [{ text: '#1 号染色体上没有' }] },
    ]);
  });

  it('does not mistake a list item for a thematic break', () => {
    expect(parseAnswer('- 一条记录')).toEqual([
      { kind: 'listItem', marker: '·', depth: 0, spans: [{ text: '一条记录' }] },
    ]);
  });

  it('keeps a fenced code block verbatim', () => {
    const blocks = parseAnswer(['```json', '{ "d4z4": 3 }', '# not a heading', '```'].join('\n'));
    expect(blocks).toEqual([{ kind: 'code', text: '{ "d4z4": 3 }\n# not a heading' }]);
  });

  // A truncated stream ends mid-fence. Dropping the buffer would hide
  // the tail of the answer.
  it('still renders an unterminated fence', () => {
    expect(parseAnswer(['```', '被截断了'].join('\n'))).toEqual([
      { kind: 'code', text: '被截断了' },
    ]);
  });

  it('renders a blockquote', () => {
    expect(parseAnswer('> 医生说要复查')).toEqual([
      { kind: 'quote', spans: [{ text: '医生说要复查' }] },
    ]);
  });

  it('keeps ordinary prose as paragraphs', () => {
    expect(parseAnswer('这是一份大便常规检查报告。\n\n各项指标都是正常的。')).toEqual([
      { kind: 'paragraph', spans: [{ text: '这是一份大便常规检查报告。' }] },
      { kind: 'paragraph', spans: [{ text: '各项指标都是正常的。' }] },
    ]);
  });

  // A table is the one construct where dropping a line loses data, so
  // a table that ends the message must still flush.
  it('flushes a table that runs to the end of the answer', () => {
    const blocks = parseAnswer(['| 项目 | 结果 |', '|---|---|', '| TPPA | 阴性 |'].join('\n'));
    expect(blocks).toEqual([{ kind: 'pair', label: 'TPPA', spans: [{ text: '阴性' }] }]);
  });

  it('drops a table that is only a header', () => {
    expect(parseAnswer(['| 项目 | 结果 |', '|---|---|'].join('\n'))).toEqual([]);
  });

  it('survives an empty answer', () => {
    expect(parseAnswer('')).toEqual([]);
  });
});

// Every case below was a silent data loss or a leaked marker found by
// running real model output through the parser.
describe('parseAnswer — pipe blocks', () => {
  it('keeps a lone row that never got a divider', () => {
    expect(parseAnswer('| TPPA | 阴性 |')).toEqual([
      { kind: 'pair', label: 'TPPA', spans: [{ text: '阴性' }] },
    ]);
  });

  it('keeps the first row after a blank line inside a table', () => {
    const blocks = parseAnswer('| a | b |\n|---|---|\n| c | d |\n\n| e | f |');
    expect(blocks).toEqual([
      { kind: 'pair', label: 'c', spans: [{ text: 'd' }] },
      { kind: 'pair', label: 'e', spans: [{ text: 'f' }] },
    ]);
  });

  it('reads a table written without outer pipes', () => {
    expect(parseAnswer('项目 | 结果\n--- | ---\n颜色 | 黄色')).toEqual([
      { kind: 'pair', label: '颜色', spans: [{ text: '黄色' }] },
    ]);
  });

  // 【排版】 asks the model for bold AND asks it to put the 指标 in the
  // first column, so a bold label is what that paragraph produces —
  // and `label` was the one field on this type that never saw the
  // inline pass. 「**D4Z4 重复数**」 reached a live chat bubble with the
  // asterisks showing.
  //
  // The emphasis is dropped rather than carried; see `flattenTable`.
  // What is pinned here is that the MARKERS do not reach the reader,
  // whichever way a later change decides to carry the weight.
  it('parses the label column instead of printing its markers', () => {
    expect(parseAnswer('| 指标 | 数值 |\n|---|---|\n| **D4Z4 重复数** | 3 次 |')).toEqual([
      { kind: 'pair', label: 'D4Z4 重复数', spans: [{ text: '3 次' }] },
    ]);
    // Every inline construct, not just bold: the label is read with the
    // same grammar as the value beside it, so a code span keeps its
    // contents and a link keeps its label rather than its brackets.
    expect(parseAnswer('| 字段 | 值 |\n|---|---|\n| `d4z4_repeats` | 3 |')).toEqual([
      { kind: 'pair', label: 'd4z4_repeats', spans: [{ text: '3' }] },
    ]);
    expect(parseAnswer('| 来源 | 值 |\n|---|---|\n| [指南](https://x.org) | 3 |')).toEqual([
      { kind: 'pair', label: '指南', spans: [{ text: '3' }] },
    ]);
    // And an escaped marker survives as the character it escapes,
    // rather than being deleted by a strip-the-syntax pass.
    expect(parseAnswer('| 指标 | 值 |\n|---|---|\n| 5\\* 分 | 好 |')).toEqual([
      { kind: 'pair', label: '5* 分', spans: [{ text: '好' }] },
    ]);
  });

  it('does not split a cell on an escaped pipe', () => {
    expect(parseAnswer('| 项目 | 结果 |\n|---|---|\n| a \\| b | 阴性 |')).toEqual([
      { kind: 'pair', label: 'a | b', spans: [{ text: '阴性' }] },
    ]);
  });

  // Prose containing a pipe is not a table. Without the outer-pipe
  // test it became a two-column row and lost its punctuation.
  it('leaves a sentence containing a pipe as prose', () => {
    expect(parseAnswer('分型是 FSHD1 | FSHD2 二选一')).toEqual([
      { kind: 'paragraph', spans: [{ text: '分型是 FSHD1 | FSHD2 二选一' }] },
    ]);
  });
});

describe('parseAnswer — more block shapes', () => {
  it('promotes a setext-underlined line to a heading', () => {
    expect(parseAnswer('基因检测结果\n===\n正文')).toEqual([
      { kind: 'heading', level: 1, spans: [{ text: '基因检测结果' }] },
      { kind: 'paragraph', spans: [{ text: '正文' }] },
    ]);
  });

  // A setext underline must touch its paragraph. Models write `---` as
  // a section divider with a blank line above it — and without this
  // test, every such divider silently promoted the paragraph before it.
  // Caught on screen: three lines of advice about 呼吸功能 rendered at
  // heading size because a `---` sat two lines below.
  it('treats a detached --- as a thematic break, not a setext underline', () => {
    expect(
      parseAnswer('虽然目前肺功能正常，但要每年复查。\n\n---\n\n还有什么想了解的吗？'),
    ).toEqual([
      { kind: 'paragraph', spans: [{ text: '虽然目前肺功能正常，但要每年复查。' }] },
      { kind: 'rule' },
      { kind: 'paragraph', spans: [{ text: '还有什么想了解的吗？' }] },
    ]);
  });

  it('still underlines a paragraph the dashes touch', () => {
    expect(parseAnswer('检查结果\n---\n正文')).toEqual([
      { kind: 'heading', level: 2, spans: [{ text: '检查结果' }] },
      { kind: 'paragraph', spans: [{ text: '正文' }] },
    ]);
  });

  it('renders a task list as checkboxes, not brackets', () => {
    expect(parseAnswer('- [ ] 复查\n- [x] 已完成')).toEqual([
      { kind: 'listItem', marker: '☐', depth: 0, spans: [{ text: '复查' }] },
      { kind: 'listItem', marker: '☑', depth: 0, spans: [{ text: '已完成' }] },
    ]);
  });

  // A step's second sentence belongs to the step. Emitting it
  // flush-left read as「步骤、无关的话、步骤」.
  //
  // The continuation is joined with the NEWLINE the model wrote, not
  // with a space, and it arrives as one span rather than three. Both
  // changed when soft line breaks started being handled in one place
  // (see `flushPending`): a soft break is rejoined the same way in a
  // paragraph, a quote and a list item, because a rule that depends on
  // which block you are in is a rule that will disagree with itself.
  // The space was also wrong on its own terms — it fell between two
  // Chinese sentences, which take no space.
  it('joins a continuation line onto its list item', () => {
    expect(parseAnswer('1. 先做基因检测\n   这一步需要空腹。\n2. 再做肌电图')).toEqual([
      {
        kind: 'listItem',
        marker: '1.',
        depth: 0,
        spans: [{ text: '先做基因检测\n这一步需要空腹。' }],
      },
      { kind: 'listItem', marker: '2.', depth: 0, spans: [{ text: '再做肌电图' }] },
    ]);
  });

  // The defect this whole soft-break pass exists for: the system prompt
  // promises the model that bold renders, and a bolded run that WRAPPED
  // put literal asterisks in front of the patient, because each source
  // line was parsed on its own and neither half held a matching pair.
  it('carries emphasis across a soft line break', () => {
    expect(parseAnswer('这里有一个**很重要的\n提醒**，请注意。')).toEqual([
      {
        kind: 'paragraph',
        spans: [
          { text: '这里有一个' },
          { text: '很重要的\n提醒', bold: true },
          { text: '，请注意。' },
        ],
      },
    ]);
  });

  // ...and it must still STOP at a blank line, or emphasis opened in
  // one paragraph would bold everything up to the next stray asterisk.
  it('does not carry emphasis across a blank line', () => {
    expect(parseAnswer('第一段有个**记号\n\n第二段也有个**记号')).toEqual([
      { kind: 'paragraph', spans: [{ text: '第一段有个**记号' }] },
      { kind: 'paragraph', spans: [{ text: '第二段也有个**记号' }] },
    ]);
  });

  // A wrapped citation is one quotation, not a quote followed by an
  // unquoted paragraph carrying the rest of it.
  it('keeps a wrapped quote inside the quote', () => {
    expect(parseAnswer('> 指南建议**每年\n复查一次**肺功能。')).toEqual([
      {
        kind: 'quote',
        spans: [{ text: '指南建议' }, { text: '每年\n复查一次', bold: true }, { text: '肺功能。' }],
      },
    ]);
  });

  it('trims closing hashes off a heading', () => {
    expect(parseAnswer('## 检查结果 ##')).toEqual([
      { kind: 'heading', level: 2, spans: [{ text: '检查结果' }] },
    ]);
  });
});

describe('plainAnswerText', () => {
  // Clamped previews keep a plain <Text> (numberOfLines cannot cross a
  // View), so they strip the syntax instead of losing the clamp.
  it('flattens an answer to one line without markers', () => {
    expect(plainAnswerText('### 心脏超声\n\n- **左室射血分数**：62%\n- 结论：未见异常')).toBe(
      '心脏超声 左室射血分数：62% 结论：未见异常',
    );
  });

  it('flattens a table row to label：value', () => {
    expect(plainAnswerText('| 项目 | 结果 |\n|---|---|\n| TPPA | 阴性 |')).toBe('TPPA：阴性');
  });

  it('returns an empty string for empty input', () => {
    expect(plainAnswerText('')).toBe('');
  });
});
