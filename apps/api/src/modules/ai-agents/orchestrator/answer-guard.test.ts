/**
 * Every sentence pinned here was WRITTEN BY THE MODEL, driven against
 * the running stack (real LLM, real KB service on :5010, real redactor
 * and renderer) with a SYNTHETIC patient carrying d4z4Repeats: '3',
 * haplotype: '4qA', methylationValue: '95%'. None of them is invented
 * for the test.
 *
 * The evidence each check is asked of is built by running the REAL
 * redactor and the REAL renderer over that same synthetic payload, so a
 * change in what the projection publishes shows up here as a failure
 * rather than as a guard that quietly stops firing.
 */
import { describe, expect, it } from 'vitest';

import {
  buildExcisionNotice,
  buildGuardEvidence,
  buildRegenerationDirective,
  exciseUntilClean,
  redactViolations,
  inspectAnswer,
  intervalsIn,
  localiseWireTokens,
  normaliseForMatch,
  restoreUnits,
  WIRE_TOKEN_ZH,
  type GuardEvidence,
} from './answer-guard.js';
import type { RedactionMode } from '../security/allowlist.js';
import { GENETIC_READING_REFUSALS, redactFields } from '../security/pii-redactor.js';
import { readRenderedRows, renderChunkForPrompt } from '../security/render.js';

// ------------------------------------------------------------- the fixture
//
// The shape `patient-reports.ts` hands the renderer, invented here. The
// genetics cells are the ones security/pii-redactor.test.ts already
// pins, so the readings this produces are the repo's own.
const REPORT_PAYLOAD: Record<string, unknown> = {
  classifiedType: 'genetic_report',
  documentType: 'genetic_report',
  title: '基因检测报告',
  reportDate: '2026-04-01',
  status: 'processed',
  fields: {
    classifiedType: 'genetic_report',
    documentType: 'genetic_report',
    diagnosisType: 'FSHD1',
    d4z4Repeats: '3',
    haplotype: '4qA',
    methylationValue: '95%',
    reportIssueDate: '2026-04-01',
  },
};

const PROFILE_PAYLOAD: Record<string, unknown> = {
  gender: '女',
  diagnosisStage: '确诊',
  diagnosisYear: 2019,
  diagnosisType: 'FSHD1',
  onsetRegion: '面部',
  familyHistory: '有',
  d4z4: '3',
  haplotype: '4qA',
  methylation: '95%',
};

/** Run the real redactor + renderer, then read the rows back the way
 *  run.ts's `readEmission` does, so the guard is fed the projection this
 *  turn would actually have produced. */
const evidenceFor = (
  mode: RedactionMode,
  payloads: readonly Record<string, unknown>[] = [REPORT_PAYLOAD, PROFILE_PAYLOAD],
  corpusTexts: readonly string[] = [],
  conversationTexts: readonly string[] = [],
): GuardEvidence => {
  const fields = new Set<string>();
  const ocrKeys = new Set<string>();
  const renderedTexts: string[] = [];
  for (const [index, payload] of payloads.entries()) {
    const source = index === 0 ? 'patient_reports' : 'patient_profile';
    const rendered = renderChunkForPrompt(
      {
        id: `chunk-${index}`,
        source,
        content: '',
        metadata: { fields: payload },
        distance: null,
      },
      { mode },
    );
    const rows = readRenderedRows(rendered.content);
    // The renderer prints top-level rows under their Chinese label, and
    // `readEmission` maps them back through SCOPE_LABELS. The guard only
    // ever asks about genetics keys, which live in the OCR block and in
    // `fieldsUsed`, so the allowlist key list is the honest stand-in.
    for (const key of rendered.fieldsUsed) fields.add(key);
    for (const key of rows.ocrKeys) ocrKeys.add(key);
    // The rendered block IS the prompt this turn carried, so it is what
    // 「the record printed a reference interval」 and 「a source states
    // this」 are answered against. Passed through rather than
    // reconstructed for the same reason `emitted` is.
    renderedTexts.push(rendered.content);
  }
  return buildGuardEvidence({
    patientPayloads: [...payloads],
    emitted: { fields, ocrKeys },
    corpusTexts,
    renderedTexts,
    conversationTexts,
  });
};

describe('the evidence the guard is asked of', () => {
  it('reads this patient own numbers off the raw payload and skips the calendar', () => {
    const evidence = evidenceFor('precise');
    const values = evidence.numbers.map((number) => number.value);
    expect(values).toContain(3);
    expect(values).toContain(95);
    // 2019 is `diagnosisYear`. It is the number an honest sentence about
    // when they were diagnosed carries, and pairing it with 「进展」 is
    // not a claim about a measurement.
    expect(values).not.toContain(2019);
    // 「4qA」 is an identifier that contains a digit, not a measurement.
    // Admitting it would make every bare 4 in the answer this patient's
    // haplotype.
    expect(values).not.toContain(4);
  });

  it('calls methylation ungraded because the projection carries no reading for it', () => {
    const evidence = evidenceFor('precise');
    expect(evidence.ungradedCells).toContain('methylation');
    // ...and does NOT call the two cells this platform does read
    // ungraded, which is what keeps the guard off a correct answer.
    expect(evidence.ungradedCells).not.toContain('d4z4');
    expect(evidence.ungradedCells).not.toContain('haplotype');
  });

  it('calls the methylation value withheld under strict and not under precise', () => {
    expect(evidenceFor('strict').withheldCells).toContain('methylation');
    expect(evidenceFor('precise').withheldCells).not.toContain('methylation');
  });
});

describe('a severity claim landing on this patient own number', () => {
  const evidence = evidenceFor('precise');

  // The table cell, verbatim, from a run against the stack. It has no
  // 「你」 in it — the word was in the column header — so a rule that
  // looked for a possessive would never have seen it.
  it('catches it inside a markdown table row', () => {
    const answer = [
      '| 指标 | 数值 | 对你个人的意义 |',
      '|---|---|---|',
      '| D4Z4 重复数 | 3 | 1–3 个重复单元属于病情较严重的遗传基础 |',
    ].join('\n');
    const violations = inspectAnswer(answer, evidence);
    expect(violations.map((violation) => violation.kind)).toEqual(['severity_from_patient_number']);
  });

  it('catches it through a band containing the number rather than the number', () => {
    const violations = inspectAnswer('你的重复数落在 1–3 这一档，属于进展较快的那一类。', evidence);
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('severity_from_patient_number');
  });

  it('is not rescued by a hedge, which is what the prompt already says', () => {
    const violations = inspectAnswer('3 个重复单元通常意味着病情往往更严重一些。', evidence);
    expect(violations).toHaveLength(1);
  });

  // A COHORT STATEMENT THAT DOES NOT STAND THE READER IN THE BAND. This
  // is what the prompt permits and what an honest answer to
  // 「重复数少是不是更重」 is made of; it carries no digit, so the check
  // never had anything to match and never touches it.
  it('leaves a cohort statement that names no band alone', () => {
    expect(
      inspectAnswer(
        '在人群研究里，重复数越短总体上发病越早、表型越重，但这是趋势，不是对某一个人的预测 [2]。',
        evidence,
      ),
    ).toHaveLength(0);
  });

  // ...and this is the sentence the population escape used to wave
  // through. Driven against the running stack, the model wrote
  // 「在群体研究层面，D4Z4 重复数 1–3 确实与更早发病、更严重的病情相关」
  // to a patient whose count is 3 and the guard recorded nothing.
  it('catches a cohort-framed sentence that names the band this reader is standing in', () => {
    const violations = inspectAnswer(
      '在人群研究里，1–3 个重复单元与更早的发病年龄、更重的表型相关 [2]。',
      evidence,
    );
    expect(violations.map((violation) => violation.kind)).toEqual(['severity_from_patient_number']);
    // The reason quoted back to the model says why the framing did not
    // save it, because that is the half the system prompt could not
    // contain.
    expect(violations[0].because).toContain('在人群里');
  });

  it('catches it in a list item under a cohort lead-in, which is the same sentence over two lines', () => {
    const answer = [
      '在群体研究中，1–3 个重复单元是较短的 D4Z4 阵列。研究显示：',
      '- 1–3 个重复单元的患者更有可能属于「早发型」FSHD，病情可能相对更严重，进展可能相对较快 [2]',
    ].join('\n');
    const kinds = inspectAnswer(answer, evidence).map((violation) => violation.kind);
    expect(kinds).toContain('severity_from_patient_number');
    // The lead-in itself says nothing about severity and survives.
    expect(kinds).toHaveLength(1);
  });

  it('catches a plain severity claim in a list item too', () => {
    const answer = [
      '你的报告是这样的：',
      '- 你的 3 个重复单元属于病情较严重的那一档，进展也更快',
    ].join('\n');
    expect(inspectAnswer(answer, evidence).map((v) => v.kind)).toContain(
      'severity_from_patient_number',
    );
  });

  // Removed from a live answer: the severity word was in the heading
  // clause and the sentence itself was this platform's own reading.
  it('does not read a 「关于…，」 topic clause as the claim', () => {
    expect(
      inspectAnswer(
        '关于病情严重程度，你的 D4Z4 重复数是 3 个，这个重复数落在 FSHD1 的范围里。',
        evidence,
      ),
    ).toHaveLength(0);
  });

  it('still catches a claim that follows the same topic clause', () => {
    expect(
      inspectAnswer('关于你的重复数，3 个属于病情较严重的一档。', evidence).map((v) => v.kind),
    ).toContain('severity_from_patient_number');
  });

  it('leaves this platform own reading of the same number alone', () => {
    expect(
      inspectAnswer('你的 D4Z4 重复数是 3，这个重复数落在 FSHD1 的范围里 [1]。', evidence),
    ).toHaveLength(0);
  });

  // Both excised in a live run. The sentence removed was this platform's
  // own position, correctly stated, in the model's voice.
  it('leaves the model refusing to make the prediction alone', () => {
    expect(
      inspectAnswer(
        '我不能把你的 3 个重复单元、95% 甲基化值拿来判断「你病情严重不严重」「将来会不会需要轮椅」。',
        evidence,
      ),
    ).toHaveLength(0);
  });

  it('leaves 「我没法帮你下结论」 alone, which is 「不能」 spelled another way', () => {
    expect(
      inspectAnswer('所以我没法帮你下结论说这个 95% 代表病情轻重或属于哪一档。', evidence),
    ).toHaveLength(0);
  });

  it('leaves a referral to the treating physician alone', () => {
    expect(
      inspectAnswer(
        '至于 95% 这个数值对你的病情具体意味着什么，建议跟你的主治医生讨论，他会结合你的疾病进展来判断。',
        evidence,
      ),
    ).toHaveLength(0);
  });

  // Removed from a live answer: the 3 was in 「Stage 1/2/3」, in a
  // sentence saying this platform has no severity ladder at all.
  it('does not read a 3 inside an enumeration as the patient number', () => {
    expect(
      inspectAnswer(
        'FSHD 的「严重程度」不是一个固定的分档系统——没有统一的 Stage 1/2/3 之类的分期。',
        evidence,
      ),
    ).toHaveLength(0);
  });

  it('does not read the 1 in FSHD1 or the 4 in D4Z4 as a measurement', () => {
    expect(
      inspectAnswer('FSHD1 是由 D4Z4 区域收缩引起的，病情轻重差别很大。', evidence),
    ).toHaveLength(0);
  });
});

describe('a grade on a cell this platform declines to grade', () => {
  const evidence = evidenceFor('precise');

  it('catches a verdict landing on the methylation number', () => {
    const violations = inspectAnswer(
      '所以 95% 这个数值高出常规预期，我没有办法从知识库里找到解释。',
      evidence,
    );
    expect(violations.map((violation) => violation.kind)).toContain('ungraded_cell_graded');
  });

  it('catches 「95% 属于高甲基化」, which the prompt names as drawing a line', () => {
    const violations = inspectAnswer('你的甲基化值 95% 属于高甲基化。', evidence);
    expect(violations.map((violation) => violation.kind)).toContain('ungraded_cell_graded');
  });

  // The refusal and the grade contain the same words in the same
  // sentence; only the order separates them, which is why the negation
  // has to reach forward rather than merely be present.
  it('catches a bare 「很高」, which is the same line drawn without the word 分级', () => {
    expect(
      inspectAnswer('坦诚地说，你的 95% 是一个很高的甲基化值。', evidence).map((v) => v.kind),
    ).toContain('ungraded_cell_graded');
  });

  // Removed from a live answer: 「是否异常」 is the question being handed
  // to a clinician, not a verdict.
  it('leaves a grading word that is being asked rather than asserted alone', () => {
    expect(
      inspectAnswer(
        '95% 这个数值具体代表什么、是否异常、是否提示更重或更轻的表型，建议你拿着报告去问你的主治医生。',
        evidence,
      ),
    ).toHaveLength(0);
  });

  // The 「哪一档」 is the question the sentence hands to a clinician, and
  // 「意味着什么」 stands in front of it. Removed from a live answer.
  it('leaves an enumerated question about the value alone', () => {
    expect(
      inspectAnswer(
        '具体到这个 95% 意味着什么、你的病情属于哪一档——建议你和你的主治医生讨论。',
        evidence,
      ),
    ).toHaveLength(0);
  });

  it('leaves a refusal to grade alone', () => {
    expect(
      inspectAnswer(
        '我没办法把你的甲基化值解读成「高」或者「低」，本平台不给这一格分级。',
        evidence,
      ),
    ).toHaveLength(0);
  });

  // Removed from a live answer: the 你的 belongs to 临床表型, seventeen
  // characters from 甲基化, and the grading word belongs to a general
  // statement about FSHD1.
  it('does not read a distant 你的 as attaching the grade to their cell', () => {
    expect(
      inspectAnswer(
        'FSHD1 通常表现为 D4Z4 区域的低甲基化，但具体的数值解读需要结合你的临床表型一起看。',
        evidence,
      ).map((violation) => violation.kind),
    ).not.toContain('ungraded_cell_graded');
  });

  it('leaves the general mechanism statement alone when it is not about their cell', () => {
    expect(
      inspectAnswer('与 FSHD 相关的是 D4Z4 区域的低甲基化和 DUX4 去抑制 [3]。', evidence),
    ).toHaveLength(0);
  });
});

describe('a mechanism no retrieved source states', () => {
  const corpus = [
    'FSHD 的发病机制是 4 号染色体 D4Z4 重复序列收缩，导致染色质结构松弛，DUX4 基因在骨骼肌中异常表达。',
    'D4Z4 区域的低甲基化与 DUX4 去抑制相关，FSHD1 和 FSHD2 都表现为该区域甲基化水平下降。',
  ];
  const evidence = evidenceFor('precise', [REPORT_PAYLOAD, PROFILE_PAYLOAD], corpus);

  it('catches the invented one', () => {
    const violations = inspectAnswer(
      '你剩余的重复单元因为太短，会代偿性地维持在一种高度甲基化的状态。',
      evidence,
    );
    expect(violations.map((violation) => violation.kind)).toContain('unsourced_mechanism');
  });

  // Excised in a live run for restating this platform's own
  // `permissive_haplotype` reading in plain Chinese. A cell has a handful
  // of shingles and no room for the corpus's phrasing.
  it('does not judge a table cell by lexical overlap', () => {
    expect(
      inspectAnswer(
        '| **单倍型** | 4qA | 这是「允许型」单倍型——意味着你的 D4Z4 收缩是能导致 FSHD 的类型 |',
        evidence,
      ).map((violation) => violation.kind),
    ).not.toContain('unsourced_mechanism');
  });

  it('leaves a causal sentence the corpus actually states alone', () => {
    expect(
      inspectAnswer(
        'FSHD 的发病机制是 D4Z4 重复序列收缩，导致染色质结构松弛，DUX4 基因异常表达。',
        evidence,
      ).map((violation) => violation.kind),
    ).not.toContain('unsourced_mechanism');
  });

  // The word, not the claim. Observed against the stack: a search
  // preamble mentioning 「相关机制的解释」 was excised as an invented
  // mechanism.
  it('does not read a sentence that merely says the word 机制 as a claim', () => {
    expect(
      inspectAnswer(
        '我再帮你查一下知识库，看看有没有关于甲基化检测方法或者相关机制的解释。',
        evidence,
      ).map((violation) => violation.kind),
    ).not.toContain('unsourced_mechanism');
  });

  // Both excised from live answers before the marker was narrowed and
  // the shingle measured. See the notes on SHINGLE and CAUSAL_MARKER.
  it('leaves a textbook paraphrase of the mechanism alone', () => {
    expect(
      inspectAnswer(
        '当 D4Z4 区域变得松散时，DUX4 基因更容易被激活表达，这被认为是导致肌肉病变的关键机制。',
        evidence,
      ).map((violation) => violation.kind),
    ).not.toContain('unsourced_mechanism');
  });

  it('does not read a variability caveat as a mechanism claim', () => {
    expect(
      inspectAnswer('因为即使是相同的重复数，不同的人病情也可能很不一样。', evidence).map(
        (violation) => violation.kind,
      ),
    ).not.toContain('unsourced_mechanism');
  });

  it('leaves a cited causal sentence alone', () => {
    expect(
      inspectAnswer('这是因为某种目前还在研究中的调控机制 [4]。', evidence).map((v) => v.kind),
    ).not.toContain('unsourced_mechanism');
  });

  // With nothing retrieved, every sentence is unsupported and the guard
  // would gut the answer. That case already has a control —
  // CORPUS_UNAVAILABLE_NOTICE — so this one stands down.
  it('stands down when nothing was retrieved', () => {
    const noCorpus = evidenceFor('precise', [REPORT_PAYLOAD, PROFILE_PAYLOAD], []);
    expect(
      inspectAnswer('你的重复单元因为太短，会代偿性地高度甲基化。', noCorpus).map((v) => v.kind),
    ).not.toContain('unsourced_mechanism');
  });
});

describe('an absence produced by consent', () => {
  const strict = evidenceFor('strict');

  // Verbatim from a run at basic consent over the report above, whose
  // methylation value strict swept into `numericValuesWithheld: 1`.
  it('catches 「这里面没有甲基化的结果」', () => {
    const violations = inspectAnswer('但是，这里面没有甲基化的结果。', strict);
    expect(violations.map((violation) => violation.kind)).toContain('retest_of_a_value_on_file');
  });

  it('catches the recommendation to go and get the test they already had', () => {
    const violations = inspectAnswer('建议你再去做一个甲基化检测。', strict);
    expect(violations.map((violation) => violation.kind)).toContain('retest_of_a_value_on_file');
  });

  // The true sentence, and it contains 没有. Flagging it pushes the model
  // off the one wording that is correct here.
  it('leaves a sentence that names consent as the reason alone', () => {
    expect(
      inspectAnswer('你的甲基化那一项是有结果的，只是按当前授权没有把具体数值发给我。', strict),
    ).toHaveLength(0);
  });

  // Removed from a live answer: the 没有 belongs to 「标准答案」, thirty
  // characters from the cell, and the sentence denies nothing about the
  // report.
  it('does not read an unrelated 没有 in the same sentence as a denial', () => {
    expect(
      inspectAnswer(
        '至于「是否需要再做甲基化检测」，这个问题没有标准答案，得看你的具体情况。',
        strict,
      ).map((violation) => violation.kind),
    ).not.toContain('retest_of_a_value_on_file');
  });

  it('leaves a referral about whether to test alone', () => {
    expect(
      inspectAnswer('你可以跟主治医生聊一聊，听听他对你的具体情况是否建议做甲基化检测。', strict),
    ).toHaveLength(0);
  });

  it('does not read 「有没有」 as a denial', () => {
    expect(
      inspectAnswer(
        '如果你想了解目前有没有甲基化筛查的项目正在进行，也可以告诉我，我帮你查一下。',
        strict,
      ),
    ).toHaveLength(0);
  });

  it('says nothing once precise consent lets the value through', () => {
    expect(
      inspectAnswer('但是，这里面没有甲基化的结果。', evidenceFor('precise')).map((v) => v.kind),
    ).not.toContain('retest_of_a_value_on_file');
  });
});

describe('localising this platform wire vocabulary', () => {
  it('rewrites the tokens observed reaching a patient', () => {
    const { text, tokens } = localiseWireTokens(
      '单倍型是 4qA，属于 permissive（permissive_haplotype）；' +
        '有些字段标注了 not_read_off_a_laboratory_report；上传的是 genetic_report。',
    );
    expect(text).not.toMatch(
      /permissive_haplotype|not_read_off_a_laboratory_report|genetic_report/,
    );
    expect(text).toContain('允许型单倍型');
    expect(tokens).toContain('permissive_haplotype');
    expect(tokens).toContain('permissive');
  });

  it('does not half-consume the grey-zone label with the plain one', () => {
    const { text } = localiseWireTokens('within_fshd1_repeat_range_grey_zone_8_to_10');
    expect(text).toBe('这个重复数落在 8–10 这段说不准的区间里');
  });

  it('leaves an answer with no wire tokens byte-identical', () => {
    const answer = '你的重复数是 3，落在 FSHD1 的范围里 [1]。';
    expect(localiseWireTokens(answer).text).toBe(answer);
  });

  // THE FENCE FOR THE TABLE THIS FILE SHOULD NOT OWN. See the note at
  // the top of answer-guard.ts: the Chinese for a reading belongs beside
  // the token in security/, and while it lives here the only thing
  // standing between a new label and a patient reading snake_case is
  // this test.
  it('has an entry for every refusal the redactor can publish', () => {
    for (const refusal of GENETIC_READING_REFUSALS) {
      expect(WIRE_TOKEN_ZH[refusal], `no Chinese for ${refusal}`).toBeTruthy();
    }
  });

  it('has an entry for every reading the redactor emits over the genetics branches', () => {
    const cases: Array<Record<string, unknown>> = [
      { classifiedType: 'genetic_report', d4z4Repeats: '3', haplotype: '4qA' },
      { classifiedType: 'genetic_report', d4z4Repeats: '9', haplotype: '4qA' },
      { classifiedType: 'genetic_report', d4z4Repeats: '30', haplotype: '4qA' },
      { classifiedType: 'genetic_report', d4z4Repeats: '0', haplotype: '4qA' },
      { classifiedType: 'genetic_report', d4z4Repeats: '3', haplotype: '4qB' },
      { classifiedType: 'genetic_report', ecoRIFragment: '18kb', haplotype: '未提及' },
    ];
    for (const cells of cases) {
      const { fields } = redactFields(
        { classifiedType: 'genetic_report', documentType: 'genetic_report', fields: cells },
        { scope: 'reports', mode: 'strict' },
      );
      const blob = (fields.fields_clinical ?? {}) as Record<string, unknown>;
      for (const [key, value] of Object.entries(blob)) {
        if (!key.endsWith('_clinical') || typeof value !== 'string') continue;
        expect(WIRE_TOKEN_ZH[value], `no Chinese for ${key} = ${value}`).toBeTruthy();
      }
    }
  });
});

describe('what happens when it fires', () => {
  const evidence = evidenceFor('precise');

  it('quotes the model own sentence back rather than restating the rule', () => {
    const violations = inspectAnswer('你的重复数 3 属于病情较严重的那一档。', evidence);
    const directive = buildRegenerationDirective(violations);
    expect(directive).toContain('你的重复数 3 属于病情较严重的那一档。');
    // The fact about THIS turn is the half the system prompt could not
    // contain, so it has to travel with the quote.
    expect(directive).toContain('他本人档案/报告里的数值');
  });

  it('removes exactly the offending row and leaves the rest byte-identical', () => {
    const answer = [
      '你的基因报告显示：',
      '',
      '| 指标 | 数值 | 对你个人的意义 |',
      '|---|---|---|',
      '| D4Z4 重复数 | 3 | 1–3 个重复单元属于病情较严重的遗传基础 |',
      '| 单倍型 | 4qA | 这个重复数落在 FSHD1 的范围里 |',
      '',
      '在人群研究里，重复数越短总体上发病越早 [2]。',
    ].join('\n');
    const excised = redactViolations(answer, inspectAnswer(answer, evidence));
    expect(excised).not.toContain('病情较严重的遗传基础');
    // This platform's own reading still reaches the patient, and so does
    // the cohort sentence the prompt permits.
    expect(excised).toContain('| 单倍型 | 4qA | 这个重复数落在 FSHD1 的范围里 |');
    expect(excised).toContain('在人群研究里，重复数越短总体上发病越早 [2]。');
  });

  // Deletion was tried first and produced rubble — a live answer opened
  // on four orphaned bullets whose lead-in had been removed.
  it('marks a removed sentence in place so the paragraph keeps its shape', () => {
    const answer = [
      '是的，你的报告里确实没有甲基化的结果。',
      '至于要不要再做，要看这几点：',
      '',
      '- 你的发病年龄',
      '- 临床表现是否典型',
    ].join('\n');
    const redacted = redactViolations(answer, inspectAnswer(answer, evidenceFor('strict')));
    expect(redacted).not.toContain('你的报告里确实没有甲基化的结果');
    expect(redacted).toContain('把「按当前授权没发给我」说成了「你的报告里没有」');
    // The list still has something above it.
    expect(redacted).toContain('至于要不要再做，要看这几点：');
    expect(redacted).toContain('- 你的发病年龄');
  });

  it('tells the patient what was removed and why, per kind', () => {
    const notice = buildExcisionNotice([
      { kind: 'severity_from_patient_number', sentence: 'x', because: 'y' },
      { kind: 'retest_of_a_value_on_file', sentence: 'x', because: 'y' },
    ]);
    expect(notice).toContain('把你自己的数值读成了病情轻重');
    expect(notice).toContain('把「授权没发给我」说成了「你的报告里没有」');
    // Not 「your question was out of bounds」 — the rule is the
    // platform's, and the patient is pointed somewhere real.
    expect(notice).toContain('不是你的问题不该问');
    expect(notice).toContain('主治医生');
  });
});

describe('a clean answer', () => {
  it('passes through untouched', () => {
    const evidence = evidenceFor(
      'precise',
      [REPORT_PAYLOAD, PROFILE_PAYLOAD],
      ['FSHD 的发病机制是 D4Z4 重复序列收缩导致 DUX4 异常表达。'],
    );
    const answer = [
      '你的基因报告是这样的：',
      '',
      '- D4Z4 重复数：3，这个重复数落在 FSHD1 的范围里 [1]',
      '- 单倍型：4qA，属于允许型单倍型 [1]',
      '- 甲基化值：95%（本平台对这一格不下结论，没有分界线可以对照）',
      '',
      '在人群层面，重复数越短总体上发病越早、越重，但这是趋势，不是对你个人的预测 [2]。',
      '想知道这些数字对你意味着什么，最好带着报告问你的主治医生。',
    ].join('\n');
    expect(inspectAnswer(answer, evidence)).toEqual([]);
    expect(localiseWireTokens(answer).text).toBe(answer);
  });
});

// ---------------------------------------------------------------------
// THE SECOND ROUND AGAINST THE RUNNING STACK.
//
// Every answer quoted below is the model's, produced against the real
// LLM and the real KB service on :5010 with the synthetic patient above
// (d4z4Repeats 3 / 4qA / 95%) and no database. They are the answers the
// first version of this file passed.
// ---------------------------------------------------------------------

describe('markdown does not defeat the lexicons', () => {
  const evidence = evidenceFor('precise');

  it('takes emphasis off before matching and leaves the words alone', () => {
    expect(normaliseForMatch('**更严重**受累')).toBe('更严重受累');
    expect(normaliseForMatch('`95%`')).toBe('95%');
    // A wire token is snake_case and must survive intact — see the note
    // on EMPHASIS about single `_`.
    expect(normaliseForMatch('not_read_off_a_laboratory_report')).toBe(
      'not_read_off_a_laboratory_report',
    );
  });

  // The emphasis stops the topic clause from being recognised, and the
  // sentence that gets deleted is this platform's own reading read back
  // verbatim — the worst outcome this check has.
  it('still reads a bolded 「关于…：」 as a topic clause rather than a claim', () => {
    expect(
      inspectAnswer(
        '**关于病情严重程度**：你的 D4Z4 重复数是 3 个，这个重复数落在 FSHD1 的范围里。',
        evidence,
      ),
    ).toHaveLength(0);
  });

  it('finds the cell name even when emphasis is inside the word', () => {
    expect(
      inspectAnswer('你的甲基**化**数值属于很高的一档。', evidence).map((v) => v.kind),
    ).toContain('ungraded_cell_graded');
  });

  it('finds a severity claim whose band and severity word are both bolded', () => {
    expect(
      inspectAnswer('**1–3 个重复单元**的患者**进展更快**。', evidence).map((v) => v.kind),
    ).toContain('severity_from_patient_number');
  });
});

describe('a claim split across a nested list, which is how markdown writes a table of bands', () => {
  const evidence = evidenceFor('precise');

  // Verbatim shape from a run against the stack: the band on one line,
  // the claim on the next, neither line carrying both.
  it('judges a nested item carrying the band its parent label named', () => {
    const answer = [
      '- **1–3 个重复单元**',
      '  - 发病风险最高，属于「早发型」FSHD 的高危人群',
      '  - 病情通常较严重，肌肉无力进展较快',
    ].join('\n');
    const kinds = inspectAnswer(answer, evidence).map((violation) => violation.kind);
    expect(kinds.filter((kind) => kind === 'severity_from_patient_number')).toHaveLength(2);
  });

  it('does not let a sibling inherit from a sibling', () => {
    const answer = ['- D4Z4 重复数：3', '- 重复数更少的人群整体上进展更快'].join('\n');
    expect(inspectAnswer(answer, evidence)).toHaveLength(0);
  });

  // A parent that is a SENTENCE carries its own claim; only a label
  // carries the claim of everything under it. See LABEL_CONTENT_MAX.
  it('does not inherit from a parent that is a sentence rather than a label', () => {
    const answer = [
      '- 你的 D4Z4 重复数是 3 个，这个重复数落在 FSHD1 的范围里',
      '  - 具体的进展速度需要靠随访来看',
    ].join('\n');
    expect(inspectAnswer(answer, evidence)).toHaveLength(0);
  });

  it('does not inherit a severity word downward, only the number', () => {
    const answer = ['- 病情严重程度', '  - 你的 D4Z4 重复数是 3', '  - 单倍型是 4qA'].join('\n');
    expect(inspectAnswer(answer, evidence)).toHaveLength(0);
  });
});

describe('a band referred to by a pronoun in the sentence after it', () => {
  const evidence = evidenceFor('precise');

  // Verbatim from a run against the stack. The first sentence is
  // permitted and correct; the second carries the claim and holds no
  // digit at all.
  it('judges the claim carrying the band the sentence before it named', () => {
    const answer =
      '你的重复数是 3，落在 1–3 这个区间里。根据研究，这个区间的患者整体上更容易出现早发型、病情相对更重的情况。';
    const violations = inspectAnswer(answer, evidence);
    expect(violations.map((v) => v.kind)).toEqual(['severity_from_patient_number']);
    expect(violations[0].sentence).toContain('这个区间的患者');
    // ...and the sentence that merely states his value survives.
    expect(violations[0].sentence).not.toContain('落在 1–3 这个区间里');
  });

  it('reaches back exactly one sentence and no further', () => {
    const answer = [
      '重复数 1–3 是比较短的一档。',
      '甲基化这一格本平台不下结论。',
      '这个区间的患者进展更快。',
    ].join('\n');
    // The band is two sentences back; the referent of 这个区间 is the
    // sentence before, which names none.
    expect(inspectAnswer(answer, evidence).map((v) => v.kind)).not.toContain(
      'severity_from_patient_number',
    );
  });

  // Three sentences, one referent, and every link carries its own
  // anaphor. The middle one contains the digit in FSHD1 and no number
  // of its own, which is why the chain asks `namesANumber` rather than
  // 「is there a digit」.
  it('follows a chain of anaphora as long as every link points back explicitly', () => {
    const answer = '你落在 1–3 个重复单元这一档。这一档在 FSHD1 里最短。这一档的发病年龄相对更早。';
    const violations = inspectAnswer(answer, evidence);
    expect(violations.map((v) => v.kind)).toEqual(['severity_from_patient_number']);
    expect(violations[0].sentence).toContain('发病年龄相对更早');
  });

  it('breaks the chain at a sentence that changed the subject', () => {
    const answer = '重复数 1–3 是最短的一档。甲基化这一格本平台不下结论。这一档的预后更差。';
    expect(inspectAnswer(answer, evidence).map((v) => v.kind)).not.toContain(
      'severity_from_patient_number',
    );
  });

  it('does not borrow a number for a sentence that has one of its own', () => {
    const answer = '你的重复数是 3。8–10 这一档的预后说不清楚。';
    expect(inspectAnswer(answer, evidence)).toHaveLength(0);
  });
});

describe('a follow-up turn, where the number is in the conversation and not in the retrieval', () => {
  // Driven against the stack: 「那 3 个重复单元，是不是意味着我以后会更严重、
  // 进展更快？」 asked after a turn that had already read the report
  // retrieved nothing of the patient's — the question names no record —
  // and every check stood down for want of a number.
  const followUp = buildGuardEvidence({
    patientPayloads: [],
    emitted: { fields: new Set(), ocrKeys: new Set() },
    corpusTexts: [],
    conversationTexts: [
      '你的基因检测报告里，D4Z4 重复数是 3 个，单倍型是 4qA，甲基化值是 95%。',
      '那 3 个重复单元，是不是意味着我以后会更严重、进展更快？',
    ],
  });

  it('recovers the numbers the conversation is carrying', () => {
    expect(followUp.numbers.map((number) => number.value)).toContain(3);
    expect(followUp.numbers.map((number) => number.value)).toContain(95);
    expect(followUp.numbers.every((number) => number.origin === 'conversation')).toBe(true);
  });

  it('catches the severity claim that had no evidence to be checked against', () => {
    const violations = inspectAnswer('1 到 3 个单元的患者，往往属于进展更快的那一端。', followUp);
    expect(violations.map((violation) => violation.kind)).toContain('severity_from_patient_number');
    // The reason says where the turn learned the number is his, because
    // that is a different fact from 「it is on his report」.
    expect(violations[0].because).toContain('这轮对话');
  });

  it('does not read a year in the conversation as a measurement', () => {
    const withYear = buildGuardEvidence({
      patientPayloads: [],
      emitted: { fields: new Set(), ocrKeys: new Set() },
      corpusTexts: [],
      conversationTexts: ['我 2019 年做的甲基化检测，2 年前又复查过一次。'],
    });
    expect(withYear.numbers.map((number) => number.value)).not.toContain(2019);
    expect(withYear.numbers.map((number) => number.value)).not.toContain(2);
  });

  it('does not read a bare number from a sentence that names no cell', () => {
    const noCell = buildGuardEvidence({
      patientPayloads: [],
      emitted: { fields: new Set(), ocrKeys: new Set() },
      corpusTexts: [],
      conversationTexts: ['我一共上传了 7 份材料。'],
    });
    expect(noCell.numbers).toHaveLength(0);
  });

  // The fallback is confined to the turn that has nothing else. With
  // the record in hand the record is authoritative, and a cohort band
  // the conversation quoted must not enter the set as though it were
  // his.
  it('stands down entirely when this turn retrieved the record', () => {
    const withRecord = evidenceFor(
      'precise',
      [REPORT_PAYLOAD, PROFILE_PAYLOAD],
      [],
      ['文献里说 8–10 个重复单元是灰区。'],
    );
    expect(withRecord.numbers.map((number) => number.value)).not.toContain(8);
    expect(withRecord.numbers.every((number) => number.origin === 'record')).toBe(true);
  });
});

describe('a reference range the record never printed', () => {
  const evidence = evidenceFor('precise');

  // Verbatim from a run against the stack, asked for a table with a
  // 参考范围 column. 1-10 is not on this patient's report and is standing
  // in the column that promises it is.
  it('catches an interval invented in a 参考范围 column', () => {
    const answer = [
      '| 项目 | 我的数值 | 参考范围 | 意义 |',
      '|---|---|---|---|',
      '| D4Z4 重复数 | 3 | 1-10 | 落在 FSHD1 的范围里 |',
    ].join('\n');
    const violations = inspectAnswer(answer, evidence);
    expect(violations.map((violation) => violation.kind)).toContain('fabricated_reference_range');
    expect(violations[0].sentence).toContain('1-10');
  });

  it('catches it in prose too', () => {
    expect(
      inspectAnswer('甲基化的正常范围一般是 40%-60%，你的 95% 高于这个区间。', evidence).map(
        (v) => v.kind,
      ),
    ).toContain('fabricated_reference_range');
  });

  // Driven against the stack: a DATA row whose reference cell says
  // 正常范围 was read as a second header, so the column was
  // re-registered and the row itself was never checked.
  it('does not read a data row that spells 正常范围 as a second header', () => {
    const answer = [
      '| 项目 | 我的数值 | 参考范围 | 意义 |',
      '|------|----------|----------|------|',
      '| **D4Z4 重复数** | 3 | 1–10（FSHD 患者范围）<br>≥11（正常范围） | 落在 FSHD1 的范围里 |',
      '| **EcoRI 片段长度** | 14 kb | 10–38 kb（FSHD 患者范围） | 片段长度 |',
    ].join('\n');
    const kinds = inspectAnswer(answer, evidence).map((v) => v.kind);
    expect(kinds.filter((kind) => kind === 'fabricated_reference_range')).toHaveLength(2);
  });

  it('leaves a 参考范围 column that says there is no interval alone', () => {
    const answer = [
      '| 项目 | 我的数值 | 参考范围 |',
      '|---|---|---|',
      '| D4Z4 重复数 | 3 | 报告没有给参考区间 |',
    ].join('\n');
    expect(inspectAnswer(answer, evidence).map((v) => v.kind)).not.toContain(
      'fabricated_reference_range',
    );
  });

  // A range the record itself printed is the laboratory's, and the
  // patient is entitled to read it back.
  it('leaves an interval the record actually carried alone', () => {
    const withRange = buildGuardEvidence({
      patientPayloads: [{ fields: { ck: '320', ckReference: '40-200' } }],
      emitted: { fields: new Set(), ocrKeys: new Set() },
      corpusTexts: [],
      renderedTexts: ['CK: 320\n参考范围: 40-200'],
    });
    const answer = [
      '| 项目 | 我的数值 | 参考范围 |',
      '|---|---|---|',
      '| CK | 320 | 40-200 |',
    ].join('\n');
    expect(inspectAnswer(answer, withRange)).toHaveLength(0);
  });

  // Verbatim from a run against the stack, and it passed: the guard was
  // handed EVERY tool message as 「what the record printed」, so a range
  // the knowledge base stated counted as one the laboratory printed.
  it('catches the invented column even when the knowledge base states the same range', () => {
    const withCorpus = evidenceFor(
      'precise',
      [REPORT_PAYLOAD, PROFILE_PAYLOAD],
      ['FSHD1 的 D4Z4 重复单元数通常在 1-10 之间，10-11 是发病的近似阈值。'],
    );
    const answer = [
      '| 项目 | 我的数值 | 参考范围 | 意义 |',
      '|---|---|---|---|',
      '| D4Z4 重复数 | 3 个单位 | 正常 >10 个单位；FSHD1 致病范围 1–10 个单位 | 落在范围内 |',
    ].join('\n');
    expect(inspectAnswer(answer, withCorpus).map((v) => v.kind)).toContain(
      'fabricated_reference_range',
    );
  });

  // The corpus is deliberately NOT a source for this column: a
  // threshold a paper states is a fact about a cohort, and reprinting it
  // beside this patient's own value makes it a fact about their report.
  it('does not accept a corpus interval as this report reference range', () => {
    const withCorpus = evidenceFor(
      'precise',
      [REPORT_PAYLOAD, PROFILE_PAYLOAD],
      ['FSHD1 患者的 D4Z4 重复单元数通常在 1-10 之间。'],
    );
    const answer = [
      '| 项目 | 我的数值 | 参考范围 |',
      '|---|---|---|',
      '| D4Z4 重复数 | 3 | 1-10 |',
    ].join('\n');
    expect(inspectAnswer(answer, withCorpus).map((v) => v.kind)).toContain(
      'fabricated_reference_range',
    );
  });
});

describe('a mechanism claim inside a table', () => {
  const corpus = [
    'FSHD 的发病机制是 4 号染色体 D4Z4 重复序列收缩，导致染色质结构松弛，DUX4 基因在骨骼肌中异常表达。',
  ];
  const evidence = evidenceFor('precise', [REPORT_PAYLOAD, PROFILE_PAYLOAD], corpus);

  it('catches an invented mechanism written into a table cell', () => {
    expect(
      inspectAnswer(
        '| 甲基化 | 95% | 因为剩下的重复单元太短，会代偿性地维持在高度甲基化的状态 |',
        evidence,
      ).map((v) => v.kind),
    ).toContain('unsourced_mechanism');
  });

  // ...and the cell that restates this platform's own reading in plain
  // Chinese is still left alone: its source is the projection in this
  // turn's own prompt, which the support set now contains.
  it('leaves a cell restating this platform own reading alone', () => {
    expect(
      inspectAnswer(
        '| **单倍型** | 4qA | 这是「允许型」单倍型——意味着你的 D4Z4 收缩是能导致 FSHD 的类型 |',
        evidence,
      ).map((v) => v.kind),
    ).not.toContain('unsourced_mechanism');
  });
});

describe('whose absence the sentence asserts', () => {
  const strict = evidenceFor('strict');

  // Verbatim from a run against the stack. The cell is 这一项 and its
  // name is in another sentence; no window of any size reaches it.
  it('catches an absence claimed about a cell named by a pronoun', () => {
    const answer = ['你问的是甲基化那一项。', '目前获取到的报告中没有包含这一项数据。'].join('\n');
    const violations = inspectAnswer(answer, strict);
    expect(violations.map((v) => v.kind)).toContain('retest_of_a_value_on_file');
    expect(violations[0].sentence).toContain('这一项');
  });

  // The consent vocabulary had become a password: naming 授权 anywhere
  // in the sentence used to skip the whole check.
  it('catches 「报告里没有」 even when the sentence blames the privacy setting', () => {
    expect(
      inspectAnswer('根据你的隐私设置，报告里没有甲基化结果。', strict).map((v) => v.kind),
    ).toContain('retest_of_a_value_on_file');
  });

  // ...and the true sentence, which predicates the absence of THIS
  // ASSISTANT rather than of the report, still survives — it is the one
  // wording that is correct here.
  it('leaves 「按当前授权没有发给我」 alone', () => {
    expect(inspectAnswer('你的报告里的甲基化数值，按当前授权没有发给我。', strict)).toHaveLength(0);
  });

  it('leaves 「具体数值系统没有显示出来」 alone', () => {
    expect(
      inspectAnswer('甲基化的具体数值系统没有显示出来（按当前授权扣下的测量值个数: 1）。', strict),
    ).toHaveLength(0);
  });
});

describe('putting a measurement back on its unit', () => {
  const evidence = evidenceFor('precise');

  // Driven against the stack, asked for the number alone, the model
  // answered with two characters and nothing else.
  it('restores the unit when the answer is nothing but the number', () => {
    const { text, restored } = restoreUnits('95', evidence);
    expect(text).toBe('95%');
    expect(restored).toEqual(['95%']);
  });

  it('restores it in a sentence that names the cell', () => {
    expect(restoreUnits('你的甲基化值是 95。', evidence).text).toBe('你的甲基化值是 95%。');
  });

  it('does not double it up when the unit is already there', () => {
    const answer = '你的甲基化值是 **95%**。';
    expect(restoreUnits(answer, evidence).text).toBe(answer);
  });

  it('does not touch a number that is already carrying a different unit', () => {
    const answer = '这项甲基化研究纳入了 95 名患者。';
    expect(restoreUnits(answer, evidence).text).toBe(answer);
  });

  // The unit is copied off the record, never invented: a value the
  // record printed bare stays bare.
  it('leaves a value the record printed without a unit alone', () => {
    const answer = '你的 D4Z4 重复数是 3。';
    expect(restoreUnits(answer, evidence).text).toBe(answer);
  });
});

describe('a gloss is a translation, not a wire token reaching a patient', () => {
  // Driven against the stack, asked to gloss the Chinese with the
  // English original: the blind substitution turned this into
  // 「允许型（允许型）」.
  it('collapses 「允许型（permissive）」 to the Chinese', () => {
    const { text, tokens } = localiseWireTokens(
      '你的单倍型是 4qA，对应的是「允许型（permissive）」单倍型。',
    );
    expect(text).toBe('你的单倍型是 4qA，对应的是「允许型」单倍型。');
    expect(tokens).toContain('permissive');
  });

  it('collapses the gloss written the other way up', () => {
    expect(localiseWireTokens('属于 permissive（允许型）。').text).toBe('属于 允许型。');
  });

  it('does not read 「非允许型（non-permissive）」 as the shorter pair', () => {
    expect(localiseWireTokens('属于非允许型（non-permissive）。').text).toBe('属于非允许型。');
  });

  it('collapses a snake_case token glossed beside its own Chinese', () => {
    expect(localiseWireTokens('允许型单倍型（permissive_haplotype）').text).toBe('允许型单倍型');
  });

  it('still substitutes a bare wire word that is not a gloss', () => {
    expect(localiseWireTokens('单倍型是 permissive。').text).toBe('单倍型是 允许型。');
  });

  // Observed reaching a patient: a true and useful sentence with a
  // snake_case identifier in the middle of it, whose key the table
  // above does not carry because the table is a list of keys.
  it('rewrites a per-cell projection key the table has no entry for', () => {
    const { text, tokens } = localiseWireTokens(
      '判读栏里没有 methylation_clinical 这个字段，也没有 d4z4Repeats_origin。',
    );
    expect(text).not.toMatch(/methylation_clinical|d4z4Repeats_origin/);
    expect(text).toContain('本平台判读');
    expect(text).toContain('来源');
    expect(tokens).toContain('methylation_clinical');
  });

  it('leaves the exact table entry to the exact table', () => {
    expect(localiseWireTokens('fields_clinical').text).toBe('本平台对报告字段的判读');
  });
});

describe('the excision is re-inspected before the notice promises anything', () => {
  const evidence = evidenceFor('precise');

  // The notice says 「这条回答里有 N 处被我删掉了」. Before this, what
  // stood under it had never been looked at again, so the identical
  // claim could survive one line down and the patient read an assurance
  // that was false of the text below it.
  it('runs to a fixed point and counts everything that had to go', () => {
    const answer = [
      '你的 3 个重复单元属于病情较严重的一档。',
      '在群体研究中，1–3 个重复单元的人发病更早、进展更快。',
    ].join('\n');
    const found = inspectAnswer(answer, evidence);
    expect(found).toHaveLength(2);
    // Feed it only the first, as a pass that missed one would have.
    const result = exciseUntilClean(answer, [found[0]], evidence);
    expect(result.text).not.toContain('病情较严重的一档');
    expect(result.text).not.toContain('发病更早');
    expect(result.violations).toHaveLength(2);
    // ...and what is left no longer violates, which is the promise the
    // notice makes.
    expect(inspectAnswer(result.text, evidence)).toEqual([]);
  });

  // Driven against the running stack: the removed row left its newline
  // behind, the blank line ended the table, and the client rendered the
  // rows below it as literal pipes.
  it('does not leave a blank line where a table row was', () => {
    const answer = [
      '| 重复数区间 | 病情特点 |',
      '|---|---|',
      '| 1–3 个 | 发病更早、进展更快 |',
      '| 7–10 个 | 临床变异性更大 |',
    ].join('\n');
    const excised = redactViolations(answer, inspectAnswer(answer, evidence));
    expect(excised).not.toContain('发病更早');
    expect(excised.split('\n').every((line) => line.trim().startsWith('|'))).toBe(true);
    expect(excised).toContain('| 7–10 个 | 临床变异性更大 |');
  });

  it('does not re-inspect its own redaction marks as claims', () => {
    const answer = '你的 3 个重复单元属于病情较严重的一档。';
    const result = exciseUntilClean(answer, inspectAnswer(answer, evidence), evidence);
    expect(result.text).toContain('这里有一句被我删掉了');
    expect(result.violations).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------
// THE REGISTER A CHINESE CLINICAL ANSWER ACTUALLY USES.
//
// Every sentence below was written by the model, driven against the
// running stack with the same synthetic patient. The check that was
// supposed to stop them was reading for 更快 / 更重 / 更早 — the register
// of a translation — and a Chinese clinical answer states the same claim
// with 较 / 比较 / 偏 / 相对. The band-naming half was working the whole
// time.
describe('a severity claim written in the register a clinical answer uses', () => {
  const evidence = evidenceFor('precise');

  const caught = (answer: string): string[] =>
    inspectAnswer(answer, evidence).map((violation) => violation.kind);

  it('catches the 较 comparatives', () => {
    expect(caught('1–3 个重复单元的患者，发病较早、病情较重。')).toContain(
      'severity_from_patient_number',
    );
    expect(caught('3 个重复单元这一档，起病较早。')).toContain('severity_from_patient_number');
  });

  it('catches the 比较 comparatives', () => {
    expect(caught('落在 1–3 这一档的人，病情比较重。')).toContain('severity_from_patient_number');
  });

  it('catches the 偏 comparatives', () => {
    expect(caught('你的 3 个重复单元在整个疾病谱系里偏重。')).toContain(
      'severity_from_patient_number',
    );
    expect(caught('1–3 个单元的人起病偏早。')).toContain('severity_from_patient_number');
  });

  it('catches the 相对 comparatives', () => {
    expect(caught('1–3 个重复单元的表型相对较重。')).toContain('severity_from_patient_number');
  });

  it('catches the comparative written as a tail', () => {
    expect(caught('1–3 这一档的进展快一些。')).toContain('severity_from_patient_number');
  });

  // The register list is not a licence to read any comparative as a
  // prognosis. 「比较早期的报告」 is about a DOCUMENT's date.
  it('does not read 「比较早期」 as a claim about when the disease started', () => {
    expect(inspectAnswer('你 3 个重复单元这一格是比较早期的报告上写的。', evidence)).toHaveLength(
      0,
    );
  });

  // Unchanged by the register work: a cohort sentence that names no band
  // still passes untouched, which is the shape the prompt asks for.
  it('still leaves a cohort trend that names no band alone', () => {
    expect(
      inspectAnswer(
        '在人群层面，重复数越短总体上发病较早、病情较重，但这是趋势，不是对你个人的预测。',
        evidence,
      ),
    ).toHaveLength(0);
  });

  // ...and so does the platform's own refusal, said in the new register.
  it('still leaves the refusal alone', () => {
    expect(
      inspectAnswer('我不能拿你的 3 个重复单元去说你以后会不会比较重。', evidence),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
describe('a follow-up turn that retrieved the wrong patient chunk', () => {
  // The fallback used to read the conversation only when NOTHING of the
  // patient's came back. A patient-scoped retrieval is not one thing:
  // this turn pulled the FOLLOW-UP records and not the genetics report,
  // so `patientPayloads` had a chunk in it, the fallback stood down, and
  // the chunk it had carried no genetics cell at all.
  const FOLLOWUP_PAYLOAD: Record<string, unknown> = {
    documentType: 'followup',
    followupDate: '2026-05-01',
    muscleStrengthScore: '4',
    note: '随访记录',
  };

  const followUp = buildGuardEvidence({
    patientPayloads: [FOLLOWUP_PAYLOAD],
    emitted: { fields: new Set(), ocrKeys: new Set() },
    corpusTexts: [],
    conversationTexts: [
      '你的基因检测报告里，D4Z4 重复数是 3 个，甲基化值是 95%。',
      '我上个月复查的时候提到过随访，那 3 个重复单元是不是意味着病情比较重？',
    ],
  });

  it('still recovers the numbers for the cells that chunk did not carry', () => {
    expect(followUp.numbers.map((number) => number.value)).toContain(3);
    expect(followUp.numbers.map((number) => number.value)).toContain(95);
  });

  it('catches the claim the empty number set was letting through', () => {
    expect(
      inspectAnswer('1–3 个重复单元的患者，发病较早、病情较重。', followUp).map((v) => v.kind),
    ).toContain('severity_from_patient_number');
  });

  // The follow-up chunk's own numbers are still the record's, and a
  // tally on it is still not a measurement of this patient's genetics.
  it('does not read the follow-up chunk own score as a genetics measurement', () => {
    expect(
      followUp.numbers.some((number) => number.value === 4 && number.origin === 'record'),
    ).toBe(true);
  });

  // The bound is per CELL. The record answered d4z4 authoritatively, so
  // a cohort band the conversation quoted about d4z4 must not enter the
  // set as though it were his.
  it('still stands down for a cell this turn own record carries', () => {
    const withRecord = evidenceFor(
      'precise',
      [REPORT_PAYLOAD, PROFILE_PAYLOAD],
      [],
      ['文献里说 8–10 个重复单元是灰区。'],
    );
    expect(withRecord.numbers.map((number) => number.value)).not.toContain(8);
    expect(withRecord.numbers.every((number) => number.origin === 'record')).toBe(true);
  });

  // A cell whose value the record holds unparseably — 「4qA」 is a
  // haplotype no number can be read off — is still ON FILE, so the
  // conversation must not start supplying digits for it.
  it('does not fall back for a cell whose value is on file but not a number', () => {
    const withHaplotype = buildGuardEvidence({
      patientPayloads: [{ fields: { haplotype: '4qA' } }],
      emitted: { fields: new Set(), ocrKeys: new Set() },
      corpusTexts: [],
      conversationTexts: ['单倍型 4qA 的人里，大约 30% 起病较早。'],
    });
    expect(withHaplotype.numbers.map((number) => number.value)).not.toContain(30);
  });
});

// ---------------------------------------------------------------------
describe('a band that reaches a bullet list through a prose lead-in', () => {
  const evidence = evidenceFor('precise');

  // The gap the file's own header note recorded: the inheritance only
  // inherited from a LIST ITEM, and a bolded prose line ending in 「：」
  // is how a model introduces a banded list.
  it('judges the bullets under a bolded band lead-in', () => {
    const answer = [
      '**你落在 1–3 个重复单元这一档**：',
      '',
      '- 发病年龄通常比较早',
      '- 病情相对较重，进展也快一些',
    ].join('\n');
    const violations = inspectAnswer(answer, evidence);
    expect(violations.map((v) => v.kind)).toEqual([
      'severity_from_patient_number',
      'severity_from_patient_number',
    ]);
    expect(violations[0].sentence).toContain('发病年龄通常比较早');
  });

  // The lead-in may point at its band rather than state it: the
  // anaphora chain feeds the label.
  it('judges the bullets under a lead-in that points back at the band', () => {
    const answer = ['你落在 1–3 这一档。这一档在临床上通常关联着：', '- 起病较早'].join('\n');
    expect(inspectAnswer(answer, evidence).map((v) => v.kind)).toEqual([
      'severity_from_patient_number',
    ]);
  });

  // THE TRADE THE FILE ALREADY REFUSED, STILL REFUSED. Propagating from
  // any colon-terminated lead-in deletes a follow-up plan for the word
  // 病程. A lead-in propagates a BAND, never a bare value — and this one
  // names a value.
  it('does not delete a follow-up plan introduced by a lead-in naming his value', () => {
    const answer = ['你的重复数是 3，下面是随访建议：', '- 每年复查一次，注意病程变化'].join('\n');
    expect(inspectAnswer(answer, evidence)).toHaveLength(0);
  });

  // ...and a lead-in that names nothing numeric propagates nothing, so
  // a list of this platform's own readings under a severity heading is
  // untouched — the failure `TOPIC_CLAUSE` exists to prevent.
  it('does not propagate a severity heading downward', () => {
    const answer = ['关于病情严重程度：', '- 你的 D4Z4 重复数是 3', '- 单倍型是 4qA'].join('\n');
    expect(inspectAnswer(answer, evidence)).toHaveLength(0);
  });

  it('stops inheriting once the list ends', () => {
    const answer = [
      '**1–3 个重复单元这一档**：',
      '- 发病较早',
      '',
      '不同的人差别很大，具体还得看病程随访。',
    ].join('\n');
    const violations = inspectAnswer(answer, evidence);
    expect(violations).toHaveLength(1);
    expect(violations[0].sentence).toContain('发病较早');
  });
});

// ---------------------------------------------------------------------
describe('a possessive that attaches to the cell across a clause', () => {
  const evidence = evidenceFor('precise');

  // Eight characters is not where Chinese puts a possessive. Both of
  // these are the violation and both were outside the window.
  it('catches a grade whose 你的 is fifteen characters from the cell', () => {
    expect(
      inspectAnswer('你的这份 2026 年 4 月的报告里那一格甲基化数值偏高。', evidence).map(
        (v) => v.kind,
      ),
    ).toContain('ungraded_cell_graded');
  });

  it('catches a grade whose 你的 is separated by a relative clause', () => {
    expect(
      inspectAnswer('你的报告里这一次测出来的甲基化明显升高。', evidence).map((v) => v.kind),
    ).toContain('ungraded_cell_graded');
  });

  // ...and the false positive the window existed for is still rejected,
  // because the 你的 is in the NEXT clause. No character count separates
  // these two — the clause boundary does.
  it('still does not read a 你的 in the next clause as attaching', () => {
    expect(
      inspectAnswer(
        'FSHD1 通常表现为 D4Z4 区域的低甲基化，但具体的数值解读需要结合你的临床表型一起看。',
        evidence,
      ),
    ).toHaveLength(0);
  });

  it('still leaves a refusal to grade their own cell alone', () => {
    expect(
      inspectAnswer('你的甲基化这一格，我没办法把它解读成「高」或者「低」。', evidence),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
describe('an interval written with a measure word, which is how a repeat count is written', () => {
  it('reads the open-ended forms a Chinese report writes', () => {
    expect(intervalsIn('11 个以上')).toContain('>11');
    expect(intervalsIn('11 个单元以上')).toContain('>11');
    expect(intervalsIn('11 个重复单元以上')).toContain('>11');
    expect(intervalsIn('10 个重复单元以下')).toContain('<10');
    expect(intervalsIn('95% 以上')).toContain('>95');
  });

  it('reads a band written with a measure word on both ends', () => {
    expect(intervalsIn('1 个到 3 个重复单元')).toContain('1~3');
  });

  // The measure word carries no arithmetic, so the canonical form is
  // the same one the bare number produces and the comparison against
  // `recordIntervals` still works.
  it('canonicalises to the same interval as the bare form', () => {
    expect(intervalsIn('11 个单元以上')).toEqual(intervalsIn('11以上'));
  });

  it('catches the fabricated range that was invisible without it', () => {
    const evidence = evidenceFor('precise');
    const answer = [
      '| 项目 | 你的结果 | 参考范围 |',
      '| --- | --- | --- |',
      '| D4Z4 重复数 | 3 个 | 11 个单元以上为正常 |',
    ].join('\n');
    expect(inspectAnswer(answer, evidence).map((v) => v.kind)).toContain(
      'fabricated_reference_range',
    );
  });

  it('does not read a date range as an interval', () => {
    expect(intervalsIn('2026 年 4 月 1 日到 5 日')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
describe('a segment that quotes this platform own refusal and then denies the finding', () => {
  // Every localised refusal in `WIRE_TOKEN_ZH` is itself an absence
  // sentence, and resolving only the FIRST absence marker made the
  // platform's own wording the password.
  const strict = evidenceFor('strict');

  it('catches the real absence standing after the quoted refusal', () => {
    const answer =
      '这一格标的是「本平台没有把这一格当成化验报告上的读数」，你的报告里也没有甲基化的结果。';
    expect(inspectAnswer(answer, strict).map((v) => v.kind)).toContain('retest_of_a_value_on_file');
  });

  it('catches it when the refusal is the platform own 「这一格没有写明」', () => {
    const answer = '判读写的是「这一格没有写明」，也就是说这份报告里没有做甲基化。';
    expect(inspectAnswer(answer, strict).map((v) => v.kind)).toContain('retest_of_a_value_on_file');
  });

  // The quoted refusal ALONE is still not a violation — it is this
  // platform's own correct position, and deleting it would be enforcing
  // the opposite of the rule.
  it('leaves the quoted refusal on its own alone', () => {
    expect(
      inspectAnswer('这一格标的是「本平台没有把这一格当成化验报告上的读数」。', strict),
    ).toHaveLength(0);
  });

  it('still leaves 「按当前授权没有发给我」 alone in a sentence with two markers', () => {
    expect(
      inspectAnswer('我这边没有拿到甲基化的数值，你的报告里的那一格按当前授权没有发给我。', strict),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
describe('what the excision notice may honestly say', () => {
  const notice = buildExcisionNotice([
    { kind: 'severity_from_patient_number', sentence: 'x', because: 'y' },
  ]);

  it('says how many sentences went and why', () => {
    expect(notice).toContain('1 处被我删掉了');
    expect(notice).toContain('病情轻重');
  });

  // THE POINT. The fixed point converges over what the detector can
  // SEE, the detector is a register list, and a register list is never
  // complete — so the notice must not read as 「the rest has been
  // checked」.
  it('tells the patient the check is not complete', () => {
    expect(notice).toContain('只是我认出来的');
    expect(notice).toContain('不等于');
    expect(notice).toContain('以你主治医生的判断为准');
  });
});

// ---------------------------------------------------------------------
// Shapes captured from a run against the RUNNING STACK in this round —
// real LLM, real KB on :5010, real redactor — with the same synthetic
// patient. Each of these reached the patient under the previous guard.
describe('what the model actually wrote when this round was driven against the stack', () => {
  const evidence = evidenceFor('precise');

  // Asked for the bands as a bolded-heading list. The heading carries no
  // bullet marker and no colon — the bold is the punctuation — so the
  // band reached none of the bullets under it.
  it('judges the bullets under a bolded band heading with no colon', () => {
    const answer = [
      '**1–4 个重复单元**',
      '- **发病年龄**：通常在儿童期或青春期早发，部分患者在婴幼儿时期就出现症状',
      '- **病情特点**：整体上病情相对更重，肌肉无力往往更明显',
      '',
      '**8–10 个重复单元（灰色地带）**',
      '- **发病年龄**：发病较晚，多数在成年后才出现症状',
    ].join('\n');
    const violations = inspectAnswer(answer, evidence);
    // The 1–4 band contains his 3; the 8–10 band does not, and its
    // bullets are left alone.
    expect(violations).toHaveLength(2);
    expect(violations.every((v) => v.kind === 'severity_from_patient_number')).toBe(true);
    expect(violations.map((v) => v.sentence).join(' ')).toContain('儿童期或青春期早发');
    expect(violations.map((v) => v.sentence).join(' ')).not.toContain('多数在成年后');
  });

  // A line drawn on the one cell this platform permanently refuses to
  // grade, said in the synonym the lexicon did not hold.
  it('catches 「你的甲基化 95% 是在 FSHD1 的典型范围里的」', () => {
    expect(
      inspectAnswer('这些信息放在一起，你的甲基化 95% 是在 FSHD1 的典型范围里的。', evidence).map(
        (v) => v.kind,
      ),
    ).toContain('ungraded_cell_graded');
  });

  // A claim about what a laboratory calls normal, standing beside this
  // patient's own value, phrased around every word the context list
  // held — and with the interval written in measure words, which is the
  // other half of why it was invisible.
  it('catches 「正常人是 11 个以上，你的结果是 3 个」', () => {
    expect(
      inspectAnswer(
        '- **D4Z4 重复数**：正常人是 11 个以上，你的结果是 3 个，落在 FSHD1 的范围里。',
        evidence,
      ).map((v) => v.kind),
    ).toContain('fabricated_reference_range');
  });

  // Same claim, the other synonym, observed in the same round.
  it('catches 「健康人（正常）：D4Z4 重复数 >10 个单元」', () => {
    expect(
      inspectAnswer(
        '- **健康人（正常）**：D4Z4 重复数 **>10 个单元**，你的是 3 个。',
        evidence,
      ).map((v) => v.kind),
    ).toContain('fabricated_reference_range');
  });

  // ...and this platform's OWN reading, read back verbatim, still
  // reaches the patient. It is the sentence the whole file exists to
  // protect.
  it('still leaves this platform own reading of the same cell alone', () => {
    expect(
      inspectAnswer(
        '你的 D4Z4 重复数是 3，这个重复数落在 FSHD1 的范围里。单倍型是 4qA，属于允许型单倍型。',
        evidence,
      ),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
// THE THIRD ROUND OF SEAMS ON THIS FILE. Every one of them is a lexicon
// or a window the language walked around, and every one was driven
// against the running stack with the same synthetic patient.
describe('a band written with the tilde this file uses for a band itself', () => {
  const evidence = evidenceFor('precise');

  // The emphasis stripper removed `~` as markdown, and `BAND_SOURCE`
  // lists `~` as a band separator. Every check reads the normalised
  // text, so 「1~3」 arrived as the four-digit string 13.
  it('leaves an ASCII tilde standing so a band written 1~3 is still a band', () => {
    expect(normaliseForMatch('落在 1~3 这一档')).toBe('落在 1~3 这一档');
  });

  it('catches the severity claim on a band written 1~3', () => {
    expect(
      inspectAnswer('你的重复数落在 1~3 这一档，病情通常比较重。', evidence).map((v) => v.kind),
    ).toEqual(['severity_from_patient_number']);
  });

  it('reads a tilde band as an interval', () => {
    expect(intervalsIn('参考范围 1~10')).toContain('1~10');
  });

  // `~~` is markdown strikethrough and only `~~`, so it still comes off.
  it('still strips strikethrough', () => {
    expect(normaliseForMatch('~~删掉的~~内容')).toBe('删掉的内容');
  });
});

// ---------------------------------------------------------------------
describe('an open-ended interval joined to its boundary word by 及', () => {
  const evidence = evidenceFor('precise');

  // 「11 个及以上」 is the ordinary Chinese form; the pattern required
  // 以上 to sit against the measure tail, so it produced no interval at
  // all and `fabricated_reference_range` had nothing to compare.
  it('reads 「11 个及以上」 and 「10 个及以下」', () => {
    expect(intervalsIn('正常参考：11 个及以上')).toContain('>11');
    expect(intervalsIn('10 个及以下')).toContain('<10');
    expect(intervalsIn('11 个或以上')).toContain('>11');
  });

  it('catches a 参考范围 column written in the 及以上 form', () => {
    const answer = [
      '| 项目 | 你的结果 | 参考范围 |',
      '| --- | --- | --- |',
      '| D4Z4 重复数 | 3 | 正常参考：11 个及以上 |',
    ].join('\n');
    expect(inspectAnswer(answer, evidence).map((v) => v.kind)).toEqual([
      'fabricated_reference_range',
    ]);
  });

  // Symmetric: the same widening reads the RECORD's own intervals, so an
  // interval the record printed in this form is admissible rather than
  // fabricated.
  it('still admits an interval the record itself printed', () => {
    const withRange = buildGuardEvidence({
      patientPayloads: [{ fields: { d4z4Repeats: '3', d4z4Reference: '11 个及以上' } }],
      emitted: { fields: new Set(['d4z4Repeats']), ocrKeys: new Set() },
      corpusTexts: [],
      renderedTexts: ['D4Z4 重复数: 3'],
    });
    expect(withRange.recordIntervals.has('>11')).toBe(true);
    expect(
      inspectAnswer('报告上印的参考范围是 11 个及以上，你的结果是 3 个。', withRange),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
describe('the consent wording placed between the report and the absence', () => {
  const strict = evidenceFor('strict');

  // The absence resolves to the LAST holder before the marker, and 授权
  // was in the self-holder list — so consent wording written as a reason
  // clause, which is where Chinese puts one, made the platform the
  // subject of a sentence whose subject is the document.
  it('catches 「你的报告里的甲基化，按当前授权，没有结果。」', () => {
    expect(
      inspectAnswer('你的报告里的甲基化，按当前授权，没有结果。', strict).map((v) => v.kind),
    ).toEqual(['retest_of_a_value_on_file']);
  });

  it('catches the same claim with the consent clause in front', () => {
    expect(
      inspectAnswer('按当前授权，你的报告里没有甲基化的结果。', strict).map((v) => v.kind),
    ).toEqual(['retest_of_a_value_on_file']);
  });

  // ...and the one wording that IS correct here still survives. What
  // hands the absence back to this assistant is the delivery verb, not
  // the word 授权.
  it('leaves the assistant-side absence alone', () => {
    expect(inspectAnswer('你的报告里的甲基化数值，按当前授权没有发给我。', strict)).toHaveLength(0);
    expect(
      inspectAnswer('我这边没有拿到甲基化的数值，你的报告里的那一格按当前授权没有发给我。', strict),
    ).toHaveLength(0);
  });

  // This platform's own projection says 「按当前授权没有发出」. The model
  // quoting that back must not be read as denying the finding.
  it('leaves the projection own wording 「没有发出」 alone', () => {
    expect(
      inspectAnswer('你的报告里那一格写的是「有结果在案，按当前授权没有发出」。', strict),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
describe('the ordinary ways Chinese says a report lacks a field', () => {
  const strict = evidenceFor('strict');

  it.each([
    '你的报告里未提及甲基化这一项。',
    '你的报告里找不到甲基化的结果。',
    '你的报告里甲基化这一项是缺失的。',
    '你的报告里甲基化那一格是空的。',
    '你的报告里甲基化那一栏是空白的。',
  ])('catches %s', (sentence) => {
    expect(inspectAnswer(sentence, strict).map((v) => v.kind)).toContain(
      'retest_of_a_value_on_file',
    );
  });

  // 缺失 is also the clinical word for a DELETION, which is a finding the
  // report STATES. The field-state words only count when they are
  // predicated of a field, so this true sentence survives.
  it('does not read 「D4Z4 片段缺失」 as a missing field', () => {
    expect(
      inspectAnswer('你的报告里写的是 D4Z4 片段缺失，这是 FSHD1 的常见形式。', strict),
    ).toHaveLength(0);
  });

  // The gate is still `withheldCells`: a cell the record does not hold
  // at all can honestly be reported as absent.
  it('leaves an absence of a cell the record really does not hold', () => {
    expect(inspectAnswer('你的报告里未提及 EcoRI 片段长度这一项。', strict)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
describe('a band that reaches a TABLE through the same prose lead-in', () => {
  const evidence = evidenceFor('precise');

  // The label stack was cleared by any segment that is not a list item,
  // and a table row is not a list item — so the header row threw the
  // lead-in away before a single data row was judged.
  it('judges the rows under a bolded band lead-in', () => {
    const answer = [
      '**你落在 1–3 个重复单元这一档**：',
      '',
      '| 项目 | 说明 |',
      '| --- | --- |',
      '| 发病年龄 | 通常比较早 |',
      '| 病情 | 相对较重，进展也快一些 |',
    ].join('\n');
    const violations = inspectAnswer(answer, evidence);
    expect(violations.map((v) => v.kind)).toEqual([
      'severity_from_patient_number',
      'severity_from_patient_number',
    ]);
    expect(violations[0].sentence).toContain('通常比较早');
  });

  // The band gate is unchanged, and it is what keeps this honest: a
  // lead-in naming a VALUE propagates nothing, so a table of follow-up
  // advice under it is judged on its own words.
  it('does not delete a follow-up plan tabulated under a value lead-in', () => {
    const answer = [
      '你的重复数是 3，下面是随访建议：',
      '',
      '| 项目 | 建议 |',
      '| --- | --- |',
      '| 复查 | 每年复查一次，注意病程变化 |',
    ].join('\n');
    expect(inspectAnswer(answer, evidence)).toHaveLength(0);
  });

  // ...and this platform's own readings, tabulated, still reach the
  // patient.
  it('leaves a table of this platform own readings alone', () => {
    const answer = [
      '你的报告我读到了，下面是本平台的判读：',
      '',
      '| 项目 | 结果 | 本平台判读 |',
      '| --- | --- | --- |',
      '| D4Z4 重复数 | 3 | 这个重复数落在 FSHD1 的范围里 |',
      '| 单倍型 | 4qA | 允许型单倍型 |',
    ].join('\n');
    expect(inspectAnswer(answer, evidence)).toHaveLength(0);
  });

  // The scope still ends: the first ordinary sentence after the table
  // clears the stack.
  it('stops inheriting after the table ends', () => {
    const answer = [
      '**你落在 1–3 个重复单元这一档**：',
      '',
      '| 项目 | 说明 |',
      '| --- | --- |',
      '| 发病年龄 | 通常比较早 |',
      '',
      '不同的人差别很大，具体还得看病程随访。',
    ].join('\n');
    expect(inspectAnswer(answer, evidence)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------
describe('a follow-up that points back at the number with a bare classifier', () => {
  const conversationOnly = (texts: readonly string[]) =>
    buildGuardEvidence({
      patientPayloads: [{ documentType: 'followup', note: '随访记录：下次复查待定' }],
      emitted: { fields: new Set(), ocrKeys: new Set() },
      corpusTexts: [],
      renderedTexts: ['随访记录：下次复查待定'],
      conversationTexts: texts,
    });

  // The cell is in one sentence and the number in the next, and the
  // question refers back with a bare classifier that names neither. Every
  // segment failed the per-segment gate and the number set came out
  // empty.
  const followUp = conversationOnly([
    '那 3 个是不是意味着我病情比较重？',
    '你的 D4Z4 重复数这一格我读到了。报告上写的是 3。',
  ]);

  it('recovers the number the bare classifier points at', () => {
    expect(followUp.numbers.map((number) => number.value)).toContain(3);
    expect(followUp.numbers.every((number) => number.origin === 'conversation')).toBe(true);
  });

  it('catches the severity claim the empty number set was letting through', () => {
    expect(
      inspectAnswer('是的，3 个单元这一档的患者病情通常比较重。', followUp).map((v) => v.kind),
    ).toContain('severity_from_patient_number');
  });

  it('carries the unit when the anaphor does', () => {
    const methylation = conversationOnly(['那 95% 是不是偏高？', '你的甲基化这一格我读到了。']);
    expect(methylation.numbers).toContainEqual({
      value: 95,
      cell: 'methylation',
      unit: '%',
      origin: 'conversation',
    });
  });

  // THE NARROW DIRECTION, which is the one this list has to fail in: a
  // number wrongly admitted here gets TRUE sentences deleted. A
  // classifier with a head noun after it is not an anaphor.
  it('does not read a demonstrative with a head noun as a reference to his value', () => {
    expect(
      conversationOnly(['我家那 2 个孩子要不要也查一下？', '你的 D4Z4 重复数这一格我读到了。'])
        .numbers,
    ).toHaveLength(0);
    expect(
      conversationOnly(['那 3 家医院都能做吗？', '你的 D4Z4 重复数这一格我读到了。']).numbers,
    ).toHaveLength(0);
  });

  it('does not read a demonstrative over a span of years', () => {
    expect(
      conversationOnly(['我这 5 年一直在复查。', '你的 D4Z4 重复数这一格我读到了。']).numbers,
    ).toHaveLength(0);
  });

  // The fact half is still required: no cell named anywhere in the
  // conversation, no antecedent, nothing recovered.
  it('recovers nothing when the conversation names no cell at all', () => {
    expect(conversationOnly(['那 3 个是不是意味着我病情比较重？']).numbers).toHaveLength(0);
  });

  // ...and the per-cell bound still holds: a cell this turn's own record
  // carries is authoritative and the conversation is not read for it.
  it('still stands down for a cell this turn own record carries', () => {
    const withRecord = evidenceFor(
      'precise',
      [REPORT_PAYLOAD, PROFILE_PAYLOAD],
      [],
      ['那 8 个是不是就安全了？'],
    );
    expect(withRecord.numbers.map((number) => number.value)).not.toContain(8);
  });
});

// ---------------------------------------------------------------------
// Shapes the RUNNING STACK produced while the fixes above were being
// verified, in this round, with the same synthetic patient. Both are the
// prose lead-in seam: once the table under the lead-in could be judged,
// the model wrote the lead-in in a form the label test could not see.
describe('a bolded band sentence sitting directly on top of a table', () => {
  const evidence = evidenceFor('precise');

  // Seventeen content characters, one over LABEL_CONTENT_MAX, ending in
  // 「。」 rather than 「：」 — and what makes it a lead-in is not its
  // length, it is that a table starts on the next line.
  it('judges the rows under a full-sentence band lead-in with no colon', () => {
    const answer = [
      '**你的重复数落在 1-3 个重复单元这一档。**',
      '',
      '| 发病年龄 | 在群体中往往发病较早，研究显示中位数约 5 岁 |',
      '|---------|--------------------------------------|',
      '| 病情特点 | 在群体中往往病情较重，与最严重表型相关联 |',
      '| 进展速度 | 在群体中进展往往较快，严重程度评分下降幅度更大 |',
    ].join('\n');
    const violations = inspectAnswer(answer, evidence);
    expect(violations).toHaveLength(3);
    expect(violations.every((v) => v.kind === 'severity_from_patient_number')).toBe(true);
  });

  // The closing 「**」 lands AFTER the 。, so the sentence split left a
  // two-character span of pure markdown standing between the lead-in and
  // the table. It can never be a violation, and it was hiding one.
  it('does not make a segment out of a stray asterisk pair', () => {
    const answer = ['**你落在 1–3 这一档。**', '- 病情相对较重'].join('\n');
    expect(inspectAnswer(answer, evidence).map((v) => v.kind)).toEqual([
      'severity_from_patient_number',
    ]);
  });

  // The band gate is still the whole safety of this: a lead-in naming a
  // VALUE introduces a list too, and propagates nothing.
  it('still does not propagate from a lead-in that names no band', () => {
    const answer = [
      '你的 D4Z4 重复数是 3 个，单倍型是 4qA。',
      '| 项目 | 建议 |',
      '| --- | --- |',
      '| 复查 | 每年复查一次，注意病程变化 |',
    ].join('\n');
    expect(inspectAnswer(answer, evidence)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
// THE PARSER THAT WAS READING A BOUND BACKWARDS.
//
// Every other list in this file may be incomplete for free, because a
// missing entry costs a sentence that should have been cut. A BOUNDARY
// WORD IS ARITHMETIC: 不低于 11 has one right answer, the parser gave
// the complement of it, and every check that reasons about which band
// the patient falls in was reasoning about the opposite band.
//
// So this is a ROUND-TRIP TABLE rather than a handful of cases: every
// form of an open-ended bound that can be written in Chinese, each one
// asserted to produce exactly one interval and the RIGHT one.
describe('every way a Chinese bound is written, and which side of the number it is on', () => {
  const AT_OR_ABOVE_11 = [
    // the plain direction words
    '大于 11',
    '高于 11',
    '超过 11',
    '多于 11',
    '超出 11',
    // ...NEGATED, which is the seam: 不低于 11 means AT LEAST 11 and was
    // matching the 低于 alternative.
    '不低于 11 个',
    '不小于 11',
    '不少于 11 个重复单元',
    '未低于 11',
    '没有低于 11',
    // ...the spelt-out ≥, which is how a Chinese report writes it and
    // which produced no interval at all.
    '大于等于 11 个',
    '大于或等于 11',
    '高于等于 11',
    // the symbols
    '≥11',
    '>=11',
    '>11',
    '＞11',
    '≧11',
    // the closed adverbs
    '至少 11 个',
    '最少 11',
    '起码 11 个重复单元',
    // the suffix forms
    '11 个以上',
    '11 个及以上',
    '11 个或以上',
    '11 个重复单元以上',
    '11 之上',
    '11以上',
  ];

  const AT_OR_BELOW_10 = [
    '小于 10',
    '低于 10',
    '少于 10',
    // ...NEGATED: 不超过 10 means AT MOST 10 and was matching the 超过
    // alternative.
    '不超过 10',
    '不高于 10',
    '不大于 10',
    '不多于 10',
    '未超过 10',
    '没有超过 10',
    '没超过 10',
    // the atoms that are not negations of anything
    '不足 10',
    '不到 10',
    '不满 10',
    '未满 10',
    // the spelt-out ≤
    '小于等于 10',
    '小于或等于 10 个',
    '低于等于 10',
    // the symbols
    '≤10',
    '<=10',
    '<10',
    '＜10',
    '≦10',
    // the closed adverbs
    '至多 10',
    '最多 10 个',
    // the suffix forms
    '10 个以下',
    '10 个及以下',
    '10 个以内',
    '10 个重复单元以下',
    '10 之内',
    '10 之下',
  ];

  it.each(AT_OR_ABOVE_11)('reads 「%s」 as the band at or above 11', (form) => {
    expect(intervalsIn(form)).toEqual(['>11']);
  });

  it.each(AT_OR_BELOW_10)('reads 「%s」 as the band at or below 10', (form) => {
    expect(intervalsIn(form)).toEqual(['<10']);
  });

  // The defect stated as its own assertion: a negated bound must not
  // come out as the bound it negates.
  it('does not read a negated bound as the bound it negates', () => {
    expect(intervalsIn('不低于 11 个')).not.toContain('<11');
    expect(intervalsIn('不超过 100%')).not.toContain('>100');
    expect(intervalsIn('不超过 100%')).toEqual(['<100']);
  });

  // The band forms are untouched by the rewrite, and the two readers of
  // BAND_SOURCE still agree.
  it('still reads the closed bands, and still reads no interval out of a date range', () => {
    expect(intervalsIn('1-10')).toEqual(['1~10']);
    expect(intervalsIn('40%-60%')).toEqual(['40~60']);
    expect(intervalsIn('1 个到 3 个重复单元')).toEqual(['1~3']);
    expect(intervalsIn('2026 年 4 月 1 日到 5 日')).toHaveLength(0);
  });

  // WHAT THE INVERSION COST A PATIENT, both directions, through the
  // check that reads this parser. The record printed the interval in a
  // negated form; the answer reprints the laboratory's own range in the
  // ordinary one.
  it('admits the interval the record printed as 「不低于 11 个」', () => {
    const withRange = buildGuardEvidence({
      patientPayloads: [{ fields: { d4z4Repeats: '3', d4z4Reference: '不低于 11 个' } }],
      emitted: { fields: new Set(['d4z4Repeats']), ocrKeys: new Set() },
      corpusTexts: [],
      renderedTexts: ['D4Z4 重复数: 3'],
    });
    expect(withRange.recordIntervals.has('>11')).toBe(true);
    expect(withRange.recordIntervals.has('<11')).toBe(false);
    expect(
      inspectAnswer('报告上印的参考范围是 11 个以上，你的结果是 3 个。', withRange),
    ).toHaveLength(0);
  });

  it('admits the interval the record printed as 「大于等于 11 个」', () => {
    const withRange = buildGuardEvidence({
      patientPayloads: [{ fields: { d4z4Repeats: '3', d4z4Reference: '大于等于 11 个' } }],
      emitted: { fields: new Set(['d4z4Repeats']), ocrKeys: new Set() },
      corpusTexts: [],
      renderedTexts: ['D4Z4 重复数: 3'],
    });
    expect(withRange.recordIntervals.has('>11')).toBe(true);
    expect(inspectAnswer('参考范围是 ≥11 个，你的结果是 3 个。', withRange)).toHaveLength(0);
  });

  // ...and the other direction: a record whose bound is 不超过 100% must
  // not make an invented 「>100%」 look sourced.
  it('still catches an invented range beside a record that printed a negated one', () => {
    const withRange = buildGuardEvidence({
      patientPayloads: [
        { fields: { methylationValue: '95%', methylationReference: '不超过 100%' } },
      ],
      emitted: { fields: new Set(['methylationValue']), ocrKeys: new Set() },
      corpusTexts: [],
      renderedTexts: ['甲基化: 95%'],
    });
    expect(withRange.recordIntervals.has('<100')).toBe(true);
    expect(
      inspectAnswer('你的甲基化的正常参考范围是 40% 以上。', withRange).map((v) => v.kind),
    ).toContain('fabricated_reference_range');
  });
});

// ---------------------------------------------------------------------
describe('a severity claim attached to his cell by the possessive rather than by a number', () => {
  const evidence = evidenceFor('precise');

  it.each([
    '你的重复数意味着病情较重。',
    '你的这个甲基化水平提示病程进展会比较快。',
    '你的 D4Z4 重复数属于发病比较早的那一类。',
  ])('catches %s, which carries no digit at all', (sentence) => {
    expect(inspectAnswer(sentence, evidence).map((v) => v.kind)).toContain(
      'severity_from_patient_number',
    );
  });

  // The fact half. A cell this turn holds nothing of his for is a
  // sentence about the concept, and this limb never sees it.
  it('says nothing about a cell this turn holds no value of his for', () => {
    const noGenetics = buildGuardEvidence({
      patientPayloads: [{ fields: { gender: '女' } }],
      emitted: { fields: new Set(), ocrKeys: new Set() },
      corpusTexts: [],
      renderedTexts: [],
    });
    expect(inspectAnswer('你的重复数意味着病情较重。', noGenetics)).toHaveLength(0);
  });

  // The clause is what keeps the honest sentence alive: the possessive
  // and the cell in one clause, the severity word in the next.
  it('leaves the platform reading with the question handed on alone', () => {
    expect(
      inspectAnswer('你的 D4Z4 重复数这一格我读到了，至于病情会不会进展，得看随访。', evidence),
    ).toHaveLength(0);
  });

  it('still leaves a refusal that names his cell alone', () => {
    expect(
      inspectAnswer('你的甲基化这一格，我不能拿来判断你的病情严重不严重。', evidence),
    ).toHaveLength(0);
  });

  it('still leaves a topic clause that names severity alone', () => {
    expect(
      inspectAnswer('关于病情严重程度，你的 D4Z4 重复数这一格我读到了。', evidence),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
describe('an anaphor pointing back at his own value rather than at a band', () => {
  const evidence = evidenceFor('precise');

  it('judges the claim that points back with 这个数值', () => {
    const answer = '你的重复数是 3。这个数值在临床上通常关联着更早的发病年龄。';
    const violations = inspectAnswer(answer, evidence);
    expect(violations.map((v) => v.kind)).toEqual(['severity_from_patient_number']);
    expect(violations[0].sentence).toContain('这个数值');
  });

  it.each(['这个数字', '这个结果', '这个重复数', '这个读数'])(
    'judges the claim that points back with %s',
    (anaphor) => {
      const answer = `你的重复数是 3。${anaphor}对应的病程进展通常比较快。`;
      expect(inspectAnswer(answer, evidence).map((v) => v.kind)).toContain(
        'severity_from_patient_number',
      );
    },
  );

  // The fact half is unchanged: the anaphor only causes the sentence
  // before to be read alongside this one, and the number in it still has
  // to be his.
  it('borrows nothing from a sentence that named no number of his', () => {
    const answer = '知识库里说 FSHD 的表型差别很大 [2]。这个结果对应的病程进展通常比较快。';
    expect(inspectAnswer(answer, evidence)).toHaveLength(0);
  });

  // 这一格 points at a FIELD, and the sentence that says this platform
  // does not grade it has to BREAK the chain rather than extend it.
  it('does not turn the platform own 「这一格」 sentence into a link', () => {
    const answer = '重复数 1–3 是最短的一档。甲基化这一格本平台不下结论。这个数值的预后更差。';
    expect(inspectAnswer(answer, evidence).map((v) => v.kind)).not.toContain(
      'severity_from_patient_number',
    );
  });
});

// ---------------------------------------------------------------------
describe('a follow-up that ends on a sentence-final particle', () => {
  const conversationOnly = (texts: readonly string[]) =>
    buildGuardEvidence({
      patientPayloads: [{ documentType: 'followup', note: '随访记录：下次复查待定' }],
      emitted: { fields: new Set(), ocrKeys: new Set() },
      corpusTexts: [],
      renderedTexts: ['随访记录：下次复查待定'],
      conversationTexts: texts,
    });

  it.each(['那 3 个呢？', '那 3 个吗？', '那 3 个吧？', '那 3 个啊？'])(
    'recovers the number out of %s',
    (question) => {
      const evidence = conversationOnly([question, '你的 D4Z4 重复数这一格我读到了。']);
      expect(evidence.numbers.map((number) => number.value)).toContain(3);
    },
  );

  it('catches the severity claim the particle question was letting through', () => {
    const evidence = conversationOnly(['那 3 个呢？', '你的 D4Z4 重复数这一格我读到了。']);
    expect(
      inspectAnswer('3 个单元这一档的患者病情通常比较重。', evidence).map((v) => v.kind),
    ).toContain('severity_from_patient_number');
  });

  // The elision is still what makes this an anaphor: a particle cannot
  // be a head noun, so the narrow direction this list has to fail in is
  // unchanged.
  it('still does not read a demonstrative with a head noun in front of the particle', () => {
    expect(
      conversationOnly(['我家那 2 个孩子呢？', '你的 D4Z4 重复数这一格我读到了。']).numbers,
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
describe('an absence stated first and explained second, which is the ordinary order', () => {
  const strict = evidenceFor('strict');

  it('catches 「报告里没有…，因为按当前授权没有发给我」', () => {
    expect(
      inspectAnswer('你的报告里没有甲基化的结果，因为按当前授权没有发给我。', strict).map(
        (v) => v.kind,
      ),
    ).toEqual(['retest_of_a_value_on_file']);
  });

  it('catches it with the true half stated first', () => {
    expect(
      inspectAnswer('按当前授权没有发给我，所以你的报告里没有甲基化的结果。', strict).map(
        (v) => v.kind,
      ),
    ).toEqual(['retest_of_a_value_on_file']);
  });

  // The wording that IS correct still survives — the delivery verb is
  // this marker's own predicate.
  it('leaves the assistant-side absence alone, including with an adverb in between', () => {
    expect(inspectAnswer('你的报告里的甲基化数值，按当前授权没有发给我。', strict)).toHaveLength(0);
    expect(
      inspectAnswer('你的报告里的甲基化数值，按当前授权没有完整地发给我。', strict),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
describe('a reference range invented in the sentence after his value', () => {
  const evidence = evidenceFor('precise');

  it('catches the two-sentence form', () => {
    const answer = '你的 D4Z4 重复数是 3 个。正常参考范围是 11 个以上。';
    const violations = inspectAnswer(answer, evidence);
    expect(violations.map((v) => v.kind)).toEqual(['fabricated_reference_range']);
    expect(violations[0].sentence).toContain('11 个以上');
  });

  // The row names no cell of his and carries none of his numbers, so
  // asked on its own it is about nobody. A table is judged as part of
  // what introduced it, so the header row does not spend the hop.
  it('catches a table of ranges introduced by a sentence about his value', () => {
    const answer = [
      '你的 D4Z4 重复数是 3 个。',
      '| 项目 | 正常参考 |',
      '| --- | --- |',
      '| 检测下限 | 11 个以上 |',
    ].join('\n');
    expect(inspectAnswer(answer, evidence).map((v) => v.kind)).toContain(
      'fabricated_reference_range',
    );
  });

  // ONE HOP, and the encyclopedia is still somebody else's problem: two
  // sentences neither of which is about this patient stay put.
  it('leaves an interval in a passage that is about nobody alone', () => {
    const answer = 'FSHD 是一种常染色体显性遗传病 [2]。文献里的正常参考范围是 11 个以上 [2]。';
    expect(inspectAnswer(answer, evidence)).toHaveLength(0);
  });

  it('reaches back exactly one sentence and no further', () => {
    const answer = '你的 D4Z4 重复数是 3 个。这些都记在档案里了。正常参考范围是 11 个以上。';
    expect(inspectAnswer(answer, evidence).map((v) => v.kind)).not.toContain(
      'fabricated_reference_range',
    );
  });
});

// ---------------------------------------------------------------------
// WHAT THE MODEL ACTUALLY WROTE WHEN THIS ROUND WAS DRIVEN AGAINST THE
// STACK — real LLM, real KB service on :5010, real redactor and
// renderer, same synthetic patient. Every string below is verbatim from
// a live answer, and every one of them published under the previous
// version of this file.
describe('the shapes the running stack produced in this round', () => {
  const evidence = evidenceFor('precise');
  const strict = evidenceFor('strict');

  // Asked for the normal lower bound in a 参考范围 column. The bound is
  // NEGATED, and the parser was matching it inside the 低于 alternative
  // and canonicalising 「at least 11」 to 「below 11」.
  it('reads 「不低于 11 个」 in a 参考范围 column as the band it states', () => {
    const answer = [
      '| 检测指标 | 参考范围 |',
      '|---------|---------|',
      '| D4Z4 重复数 | 不低于 11 个 |',
    ].join('\n');
    expect(inspectAnswer(answer, evidence).map((v) => v.kind)).toEqual([
      'fabricated_reference_range',
    ]);
    expect(intervalsIn('不低于 11 个')).toEqual(['>11']);
  });

  // Same question, the spelt-out ≥. It produced no interval at all, so
  // there was nothing to compare and the invented threshold published.
  it('catches 「正常人群的 D4Z4 重复数参考范围是 大于等于 11 个」', () => {
    expect(
      inspectAnswer(
        '根据检索到的资料，正常人群的 D4Z4 重复数参考范围是 **大于等于 11 个**。',
        evidence,
      ).map((v) => v.kind),
    ).toEqual(['fabricated_reference_range']);
  });

  // Asked for his value in one sentence and the claim in the next, with
  // no digit in the second. The anaphor points at the VALUE, not at a
  // band, and nothing was inherited.
  it('catches 「这个数值在人群里通常和发病年龄有关——重复数越短，往往发病越早。」', () => {
    const answer =
      '我的重复数是 3。\n\n这个数值在人群里通常和发病年龄有关——重复数越短，往往发病越早。';
    const violations = inspectAnswer(answer, evidence);
    expect(violations.map((v) => v.kind)).toEqual(['severity_from_patient_number']);
    expect(violations[0].sentence).toContain('这个数值');
  });

  // A follow-up turn whose retrieval brought no genetics back. The
  // number lives in 「那 3 个呢？」 and the question ends on a particle.
  it('recovers the number out of 「那 3 个呢？」 and catches the claim under it', () => {
    const followUp = buildGuardEvidence({
      patientPayloads: [{ documentType: 'followup', note: '随访记录：下次复查待定' }],
      emitted: { fields: new Set(), ocrKeys: new Set() },
      corpusTexts: [],
      renderedTexts: ['随访记录：下次复查待定'],
      conversationTexts: [
        '那 3 个呢？这一档的人是不是发病都比较早、病情比较重？',
        '你的 D4Z4 重复数这一格我读到了。报告上写的是 3。',
      ],
    });
    expect(followUp.numbers.map((n) => n.value)).toContain(3);
    expect(
      inspectAnswer(
        '**在群体层面**，1–3 个重复单元确实与更早发病、更快的疾病进展相关。',
        followUp,
      ).map((v) => v.kind),
    ).toEqual(['severity_from_patient_number']);
  });

  // Under basic consent, asked to state the absence and then explain it.
  // The delivery verb in the reason clause was standing the whole check
  // down through a 24-character window.
  it('catches 「我的报告里没有甲基化的结果，因为按当前授权没有发给我。」', () => {
    expect(
      inspectAnswer('我的报告里没有甲基化的结果，因为按当前授权没有发给我。', strict).map(
        (v) => v.kind,
      ),
    ).toEqual(['retest_of_a_value_on_file']);
  });

  // Asked for the value in one sentence and the normal value in the
  // next. The second sentence names no cell and carries none of his
  // numbers, so asked on its own it is about nobody.
  it('catches 「正常情况下，这个数值通常大于 10。」 standing after his value', () => {
    const answer = '你的 D4Z4 重复数是 **3**。\n正常情况下，这个数值通常**大于 10**。';
    const violations = inspectAnswer(answer, evidence);
    expect(violations.map((v) => v.kind)).toEqual(['fabricated_reference_range']);
    expect(violations[0].sentence).toContain('大于 10');
  });
});
