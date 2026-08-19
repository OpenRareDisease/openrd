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
  redactViolations,
  inspectAnswer,
  localiseWireTokens,
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
): GuardEvidence => {
  const fields = new Set<string>();
  const ocrKeys = new Set<string>();
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
  }
  return buildGuardEvidence({
    patientPayloads: [...payloads],
    emitted: { fields, ocrKeys },
    corpusTexts,
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

  // The prompt explicitly PERMITS this, and it is most of an honest
  // answer to 「重复数少是不是更重」. A guard that deleted it would be
  // enforcing a rule this platform does not have.
  it('leaves a cohort statement said as a cohort statement alone', () => {
    expect(
      inspectAnswer('在人群研究里，1–3 个重复单元与更早的发病年龄、更重的表型相关 [2]。', evidence),
    ).toHaveLength(0);
  });

  // Removed from a live answer for not repeating the word 群体 inside
  // itself, while the sentence that opened the list said it.
  it('lets a list item inherit its lead-in framing', () => {
    const answer = [
      '在群体研究中，1–3 个重复单元是较短的 D4Z4 阵列。研究显示：',
      '- 1–3 个重复单元的患者更有可能属于「早发型」FSHD，病情可能相对更严重，进展可能相对较快 [2]',
    ].join('\n');
    expect(inspectAnswer(answer, evidence)).toHaveLength(0);
  });

  // ...and the inheritance is not a hole: a list under a lead-in that
  // frames nothing is judged on its own.
  it('does not let a list item inherit framing that is not there', () => {
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
