import { describe, expect, it } from 'vitest';

import {
  isLaboratoryGeneticReport,
  pickGeneticEvidenceDocument,
  readGeneticEvidence,
  type GeneticEvidenceDocumentLike,
} from './genetic-evidence.js';

/**
 * THE ONE ANSWER.
 *
 * Which uploaded document is a profile's genetic evidence used to be
 * decided separately by the passport, by the baseline autofill and by
 * the portable exports, and the answers had come apart. These pin the
 * ordering rather than any rendered wording: the wording downstream is
 * derived, and the ordering is what decides whether a real measurement
 * is on the page at all, and whether every page shows the same one.
 */

const doc = (over: Partial<GeneticEvidenceDocumentLike> = {}): GeneticEvidenceDocumentLike => ({
  id: 'd',
  documentType: 'genetic_report',
  status: 'parsed',
  uploadedAt: '2026-02-01T00:00:00.000Z',
  ocrPayload: { fields: { classifiedType: 'genetic_report' } },
  ...over,
});

/**
 * A GENETICS LABORATORY'S OWN REPORT, WITH THE PAGE IT WAS READ OFF.
 *
 * `extractedText` is on the fixture and not optional, because it is on
 * the real row: PROFILE_OCR_PAYLOAD_PROJECTION in profile.service.ts
 * puts it on every document the profile query returns, and
 * `buildReportFields` puts it on every assistant chunk. It used to be
 * absent here, and the fixture passed anyway — off `documentType`,
 * which the parse had already overwritten with the classifier's own
 * label. That is the defect these files now pin, so the fixture has to
 * be a document rather than a pair of labels agreeing with each other.
 */
const REPORT_PAGE_ZH =
  '示例医学检验实验室　基因检测报告\n送检单位：神经内科\n检测项目：D4Z4 重复序列检测\n' +
  '检测方法：Southern blot\n检测结论：符合 FSHD1\n报告医师：王××';

const geneticReport = (
  id: string,
  fields: Record<string, unknown>,
  over: Partial<GeneticEvidenceDocumentLike> = {},
) =>
  doc({
    id,
    ocrPayload: {
      fields: { classifiedType: 'genetic_report', ...fields },
      extractedText: REPORT_PAGE_ZH,
    },
    ...over,
  });

/** A 病历摘要 — a clinic's summary that quotes the laboratory. */
const medicalSummary = (
  id: string,
  fields: Record<string, unknown>,
  over: Partial<GeneticEvidenceDocumentLike> = {},
) =>
  doc({
    id,
    documentType: 'medical_summary',
    ocrPayload: { fields: { classifiedType: 'medical_summary', ...fields } },
    ...over,
  });

const pickedId = (documents: GeneticEvidenceDocumentLike[]) =>
  pickGeneticEvidenceDocument(documents)?.id ?? null;

/** Every ordering answer must be independent of the order the rows
 *  arrive in — the profile query's ORDER BY is not part of the rule. */
const stablePickedId = (documents: GeneticEvidenceDocumentLike[]) => {
  const forwards = pickedId(documents);
  expect(pickedId([...documents].reverse())).toBe(forwards);
  return forwards;
};

describe('是不是实验室自己出的那份报告 —— 排序用它，排完了还要用它', () => {
  /**
   * The same question the ordering asks, asked of the winner. It is
   * exported because picking a 病历摘要 decides what is DISPLAYED and
   * says nothing about what may be GRADED: the passport prints the
   * transcribed value with its origin beside it and refuses to grade
   * it, and it needs one expression to ask which case it is in.
   */
  it('基因报告是，病历摘要不是', () => {
    expect(isLaboratoryGeneticReport(geneticReport('lab', { d4z4Repeats: '4' }))).toBe(true);
    expect(isLaboratoryGeneticReport(medicalSummary('summary', { d4z4Repeats: '7' }))).toBe(false);
  });

  it('抄得再全的病历摘要还是不是 —— 内容多少不改变它是谁写的', () => {
    expect(
      isLaboratoryGeneticReport(
        medicalSummary('rich', {
          diagnosisType: 'FSHD1',
          d4z4Repeats: '7',
          haplotype: '4qA',
          methylationValue: '12%',
          geneticTestMethod: 'southern_blot',
        }),
      ),
    ).toBe(false);
  });

  it('什么都没读出来的基因报告仍然是 —— 它是谁写的与读没读出来无关', () => {
    // No cell extracted, and still the laboratory's: what answers is
    // the page, which says 检测方法 / 检测结论 / 报告医师 whether or not
    // the extractor got a number out of it.
    expect(isLaboratoryGeneticReport(geneticReport('empty', {}))).toBe(true);
  });

  /**
   * THE FOURTH QUESTION MAY NOT BE ANSWERED BY THE FIRST ONE'S ANSWER.
   *
   * The step reads the type the UPLOADER declared, and this module and
   * profile.controller.ts both said so in as many words — 「feeding the
   * resolved documentType back in as the fourth would make a classifier
   * corroborate itself」. Executed, it WAS the resolved type on every
   * path: `startOcrJob` UPDATEs `patient_documents.document_type` with
   * `resolveDocumentTypeFromPayload`'s answer, which prefers
   * `fields.classifiedType`, and the declaration it replaced is stored
   * nowhere. So (1) and (4) were one expression and (3) — the agreeing
   * witness — was dead on every parsed row.
   *
   * The row below is what the pipeline leaves on disk for a 门诊病历摘要
   * the old keyword classifier scored `genetic_report` (18 against
   * medical_summary 16) and uploaded under 其他: the column says
   * `genetic_report` because the CLASSIFIER said so, not the patient.
   * Driven through every caller it graded `confirmation: genetic`,
   * `grade: trial_ready`, 「基因报告」 on the citation chip, and
   * `within_fshd1_repeat_range` + `permissive_haplotype` in BOTH
   * redaction modes.
   */
  it('分类器改写过的 document_type 不能再当作「上传者声明的类型」用', () => {
    const asStoredAfterParse: GeneticEvidenceDocumentLike = {
      id: 'archived-summary',
      // What the UPDATE wrote, derived from `classifiedType` below.
      // The patient picked 其他; that answer no longer exists on the row.
      documentType: 'genetic_report',
      status: 'parsed',
      uploadedAt: '2020-06-01T00:00:00.000Z',
      ocrPayload: {
        fields: {
          classifiedType: 'genetic_report',
          diagnosisType: 'FSHD1',
          d4z4Repeats: '4',
          haplotype: '4qA',
        },
      },
    };
    expect(isLaboratoryGeneticReport(asStoredAfterParse)).toBe(false);
    // And the same row with the laboratory's own witness on it is still
    // accepted — what (4) lost is the power to stand in for (3).
    expect(
      isLaboratoryGeneticReport({
        ...asStoredAfterParse,
        ocrPayload: {
          fields: {
            ...(asStoredAfterParse.ocrPayload as { fields: Record<string, unknown> }).fields,
            geneticTestMethod: 'Southern blot',
          },
        },
      }),
    ).toBe(true);
  });

  /**
   * THE DECLARATION IS NOT LOST, AND REFUSING TO LOOK FOR IT COST REAL
   * PATIENTS THEIR DIAGNOSIS.
   *
   * The row above is what the pipeline leaves for a payload written by
   * no provider of this pipeline. What it leaves for every row the
   * current bridge parsed carries one cell more: `fields.documentType`,
   * stamped by `buildFields` out of the `documentType` `startOcrJob`
   * was CALLED with, which is the upload form's dropdown value. The
   * classification lands in `classifiedType` and the column UPDATE
   * reads that one, so the blob holds both answers and they disagree
   * exactly where it matters.
   *
   * Refusing the fourth question on every classifier-labelled row —
   * which is what the previous attempt did — made a GENUINE laboratory
   * report byte-identical to a transcription whenever its page was not
   * stored and its 检测方法 was not read. That is not an edge: the
   * passport separates 方法对但结果不全 from 结果不全 precisely because
   * a laboratory report with no readable method is ordinary. Executed
   * over that shape, the patient dropped from 基因确诊 to 自述, from
   * 可用于入组 to 仅有转录结果, the citation chip under their own
   * Southern blot's repeat count turned from 报告读取 into
   * 转录自非基因报告文件, and both redaction modes began answering
   * `not_read_off_a_laboratory_report` about a laboratory's reading.
   *
   * The two rows below differ in ONE cell and in nothing else. That
   * cell is the whole of what the gate has to go on, and it is the
   * right one: it is what the patient said, and no classifier writes
   * it.
   */
  describe('上传时声明的类型存在 payload 里，解析不会覆盖它', () => {
    const archivedRow = (declaredOnUpload: string | null): GeneticEvidenceDocumentLike => ({
      id: 'archived',
      // The column, overwritten by the parse with the classification —
      // identical on both rows, which is why it decides nothing.
      documentType: 'genetic_report',
      status: 'parsed',
      uploadedAt: '2020-06-01T00:00:00.000Z',
      ocrPayload: {
        fields: {
          classifiedType: 'genetic_report',
          ...(declaredOnUpload ? { documentType: declaredOnUpload } : {}),
          diagnosisType: 'FSHD1',
          d4z4Repeats: '4',
          haplotype: '4qA',
        },
      },
    });

    it('真基因报告：没存下页面、也没读出检测方法，仍然按报告评级', () => {
      expect(isLaboratoryGeneticReport(archivedRow('genetic_report'))).toBe(true);
      expect(readGeneticEvidence([archivedRow('genetic_report')]).laboratory).toBe(true);
    });

    it('同一形状的门诊病历摘要：上传时选的是「其他」，照样拦住', () => {
      expect(isLaboratoryGeneticReport(archivedRow('other'))).toBe(false);
      expect(readGeneticEvidence([archivedRow('other')]).laboratory).toBe(false);
      // And the value is still carried, because refusing to GRADE it is
      // not refusing to show it.
      expect(readGeneticEvidence([archivedRow('other')]).d4z4).toBe('4');
    });

    it('声明没存下来时不猜 —— 拒绝是往叙述那边错，代价是可逆的', () => {
      expect(isLaboratoryGeneticReport(archivedRow(null))).toBe(false);
    });

    it('snake_case 的那一份拼写读的是同一格', () => {
      const row = archivedRow(null);
      const fields = (row.ocrPayload as { fields: Record<string, unknown> }).fields;
      expect(
        isLaboratoryGeneticReport({
          ...row,
          ocrPayload: { fields: { ...fields, document_type: 'genetic_report' } },
        }),
      ).toBe(true);
    });

    it('声明这一格不是分类标签的第二个出口', () => {
      // The separation is the whole mechanism: `documentType` is read as
      // the declaration and `classifiedType` as the classification, and
      // neither list may reach the other's cell. A 病历摘要 the parser
      // labelled correctly is refused at the first question however its
      // uploader declared it.
      const row = archivedRow('genetic_report');
      const fields = (row.ocrPayload as { fields: Record<string, unknown> }).fields;
      expect(
        isLaboratoryGeneticReport({
          ...row,
          ocrPayload: { fields: { ...fields, classifiedType: 'medical_summary' } },
        }),
      ).toBe(false);
    });

    it('页面上写着病历摘要时，声明救不回来 —— (2) 排在 (4) 前面', () => {
      const row = archivedRow('genetic_report');
      expect(
        isLaboratoryGeneticReport({
          ...row,
          ocrPayload: {
            ...(row.ocrPayload as object),
            extractedText: '门诊病历摘要\n主诉：双上肢无力5年\n查体：翼状肩胛',
          },
        }),
      ).toBe(false);
    });
  });

  it('解析器改判的类型算数，跟排序用的是同一个答案', () => {
    // The uploader picks a type from a dropdown and the parser reads
    // the page; where they disagree the parser wins. Asked through the
    // payload for the same reason the ordering asks it there.
    expect(
      isLaboratoryGeneticReport(
        doc({
          documentType: 'other',
          ocrPayload: {
            fields: {
              classifiedType: 'genetic_report',
              geneticTestMethod: 'southern_blot',
              d4z4Repeats: '4',
            },
          },
        }),
      ),
    ).toBe(true);
    expect(
      isLaboratoryGeneticReport(
        doc({
          documentType: 'genetic_report',
          ocrPayload: { fields: { classifiedType: 'medical_summary', d4z4Repeats: '7' } },
        }),
      ),
    ).toBe(false);
  });
});

/**
 * A CLASSIFICATION IS NOT A DOCUMENT.
 *
 * `isLaboratoryGeneticReport` was one string compare against
 * `classifiedType`, a label written by a keyword classifier that scores
 * a document on the genetics words it CONTAINS. A 门诊病历摘要 quoting
 * the patient's result therefore classified as the laboratory's own
 * report — measured on a real one, genetic_report 18 against
 * medical_summary 16 — and the uploader's declared 「other」 lost to it.
 * Driven through the real retriever and `renderChunkForPrompt`, the
 * transcribed count came out graded on the FSHD1 boundary and the
 * transcribed haplotype called permissive, in BOTH redaction modes,
 * with the citation chip calling the clinic letter 基因检测报告.
 *
 * The parser's classifier is fixed too, and that fixes nothing already
 * stored: no row is reclassified by a code change. These cases are
 * written as ARCHIVED payloads — `classifiedType: 'genetic_report'`
 * exactly as the old rule wrote it — because that is the population
 * this gate has to hold against.
 */
describe('分类标签本身不再是通行证 —— 库里存着的行也要拦住', () => {
  const archived = (
    documentType: string,
    fields: Record<string, unknown>,
    extractedText?: string,
  ): GeneticEvidenceDocumentLike => ({
    id: 'archived',
    documentType,
    status: 'parsed',
    uploadedAt: '2020-06-01T00:00:00.000Z',
    ocrPayload: { fields: { classifiedType: 'genetic_report', ...fields }, extractedText },
  });

  const TRANSCRIBED = { diagnosisType: 'FSHD1', haplotype: '4qA', d4z4RepeatPathogenic: '4' };
  const SUMMARY_PAGE =
    '示例市第一人民医院 门诊病历摘要\n主诉: 双上肢抬举无力10年\n' +
    '现病史: 2019年于外院行基因检测,结果示 D4Z4 重复单元数 4 个,单倍型 4qA,考虑 FSHD1。\n' +
    '查体: 双侧翼状肩胛';
  const REPORT_PAGE =
    '示例医学检验实验室 基因检测报告\n送检单位: 神经内科\n检测项目: D4Z4\n' +
    '检测结果\n单倍型: 4qA\nD4Z4重复单元数: 4\n报告医师: 王某某';

  it('存量病历摘要：页面上有主诉/现病史/查体，就不是实验室出的那份', () => {
    expect(isLaboratoryGeneticReport(archived('other', TRANSCRIBED, SUMMARY_PAGE))).toBe(false);
    // Even when the patient picked 基因检测报告 from the dropdown for
    // their clinic letter — which they do, because it is where their
    // genetic result is written down.
    expect(isLaboratoryGeneticReport(archived('genetic_report', TRANSCRIBED, SUMMARY_PAGE))).toBe(
      false,
    );
  });

  it('存量病历摘要：连页面都没存下来时，光有分类标签也不够', () => {
    // The assistant path is this case: a chunk's projection is the
    // `fields` blob, and no 主诉 travels with it. What refuses here is
    // the absence of any laboratory structure, not the presence of
    // narrative.
    expect(isLaboratoryGeneticReport(archived('other', TRANSCRIBED))).toBe(false);
  });

  it('叙述性字段本身就是证据 —— 只有病历摘要抽取器会写它们', () => {
    expect(
      isLaboratoryGeneticReport(
        archived('other', { ...TRANSCRIBED, onsetAge: '18', progressionNode: '10年前起病' }),
      ),
    ).toBe(false);
  });

  it('上传时选了「其他」的真基因报告，不能因此丢掉判读', () => {
    // The case this rule must not break: patients leave the picker
    // alone, and the dropdown may not decide whether a laboratory
    // result counts. The document's own page answers instead.
    expect(isLaboratoryGeneticReport(archived('other', TRANSCRIBED, REPORT_PAGE))).toBe(true);
    // And on the assistant path, where there is no page: the 检测方法
    // the parser read off it is the same witness in cell form.
    expect(
      isLaboratoryGeneticReport(
        archived('other', { ...TRANSCRIBED, geneticTestMethod: 'southern_blot' }),
      ),
    ).toBe(true);
    // As is the 检测结论 block, which travels in `interpretationSummary`.
    expect(
      isLaboratoryGeneticReport(
        archived('other', {
          ...TRANSCRIBED,
          interpretationSummary: '检测结论: 符合 FSHD1',
        }),
      ),
    ).toBe(true);
  });

  it('分类器自己写的那几个键不算第二个证人', () => {
    // `reportTypeLabel` for a document the classifier called a genetics
    // report is the literal string 基因检测报告. Counting it would let
    // the classifier corroborate itself and put the whole defect back.
    expect(
      isLaboratoryGeneticReport(
        archived('other', { ...TRANSCRIBED, reportTypeLabel: '基因检测报告' }),
      ),
    ).toBe(false);
  });

  it('还没解析的上传，只有上传时声明的类型可读，按声明算', () => {
    expect(
      isLaboratoryGeneticReport({
        id: 'processing',
        documentType: 'genetic_report',
        status: 'processing',
        uploadedAt: '2026-02-01T00:00:00.000Z',
        ocrPayload: null,
      }),
    ).toBe(true);
  });
});

describe('不是基因报告的文件，压不过基因报告', () => {
  it('病历摘要抄了更多项，也压不过读出来更少的那份基因报告', () => {
    // The reviewer's first finding. Ranking by how much a document
    // carries BEFORE asking what kind of document it is let a clinic
    // summary quoting a repeat count outrank the laboratory report it
    // was quoting — and the passport then printed the transcription
    // with the summary named as its source.
    expect(
      stablePickedId([
        geneticReport('lab', { d4z4Repeats: '4' }),
        medicalSummary('summary', {
          diagnosisType: 'FSHD1',
          d4z4Repeats: '7',
          haplotype: '4qA',
          methylationValue: '12%',
        }),
      ]),
    ).toBe('lab');
  });

  it('病历摘要更新也一样压不过', () => {
    expect(
      stablePickedId([
        geneticReport('lab', { d4z4Repeats: '4' }, { uploadedAt: '2026-01-01T00:00:00.000Z' }),
        medicalSummary('summary', { d4z4Repeats: '7' }, { uploadedAt: '2026-09-01T00:00:00.000Z' }),
      ]),
    ).toBe('lab');
  });

  it('文件自报的类型算数，解析器改判的类型更算数', () => {
    // The uploader picks a type from a dropdown; the parser reads the
    // page. Where they disagree the parser wins, which is why this is
    // asked through the payload and not off `documentType`.
    expect(
      stablePickedId([
        doc({ id: 'mislabelled', documentType: 'other', ocrPayload: { fields: {} } }),
        medicalSummary('summary', { d4z4Repeats: '7' }),
      ]),
    ).toBe('summary');
    expect(
      stablePickedId([
        doc({
          id: 'reclassified',
          documentType: 'other',
          ocrPayload: {
            fields: {
              classifiedType: 'genetic_report',
              // The 检测方法 the parser read off this report's own page.
              // Present because a real genetics report's payload has it
              // and because `isLaboratoryGeneticReport` no longer takes
              // a classification on its own — see the block below.
              geneticTestMethod: 'southern_blot',
              d4z4Repeats: '4',
            },
          },
        }),
        medicalSummary('summary', { d4z4Repeats: '7', haplotype: '4qA' }),
      ]),
    ).toBe('reclassified');
  });
});

describe('还没解析出来的上传，顶不掉已经解析出结果的那一份', () => {
  const parsedFull = geneticReport(
    'parsed-full',
    { diagnosisType: 'FSHD1', d4z4Repeats: '4', haplotype: '4qA' },
    { uploadedAt: '2026-02-01T00:00:00.000Z' },
  );

  it('正在识别的新报告没有 payload，顶不掉', () => {
    // The reviewer's second finding. A row inserted by the upload
    // endpoint sits in `processing` with no payload until its job
    // lands, and the reparse path nulls `ocr_payload` before it starts
    // — so 「newest」 and 「has anything to say」 are different questions,
    // and answering the first one emptied a passport while the patient
    // was doing the one thing the app asks of them.
    expect(
      stablePickedId([
        parsedFull,
        geneticReport(
          'processing',
          {},
          { status: 'processing', ocrPayload: null, uploadedAt: '2026-09-01T00:00:00.000Z' },
        ),
      ]),
    ).toBe('parsed-full');
  });

  it('识别失败的新报告也顶不掉', () => {
    // `parse_failed` is where a raised parse lands and stays. Unlike
    // `processing` it never resolves on its own, so a passport that let
    // it win would stay empty until somebody pressed 重新识别.
    expect(
      stablePickedId([
        parsedFull,
        geneticReport(
          'failed',
          {},
          {
            status: 'parse_failed',
            ocrPayload: { provider: 'unknown', error: 'OCR failed' },
            uploadedAt: '2026-09-01T00:00:00.000Z',
          },
        ),
      ]),
    ).toBe('parsed-full');
  });

  it('解析成功但什么都没读出来的新报告，同样顶不掉', () => {
    // `parsed` is a statement about the job, not about the document.
    // `reparseDocument` treats a `parsed` row that extracted nothing as
    // a failure wearing a success label, recoverable by re-running the
    // same file — so this row's silence is not a measurement either.
    expect(
      stablePickedId([
        parsedFull,
        geneticReport('parsed-empty', {}, { uploadedAt: '2026-09-01T00:00:00.000Z' }),
      ]),
    ).toBe('parsed-full');
  });

  it('两份都读出了东西时，解析已经落地的那一份优先', () => {
    // A legacy `uploaded` row carries fields from an extraction path
    // that predates the async pipeline. It is not nothing, and it is
    // not what the current parser would say about the same file.
    // Newer AND first by id, so nothing but the landed parse can be
    // what decides this.
    expect(
      stablePickedId([
        geneticReport(
          'a-legacy',
          { d4z4Repeats: '4' },
          { status: 'uploaded', uploadedAt: '2026-09-01T00:00:00.000Z' },
        ),
        geneticReport('b-landed', { d4z4Repeats: '5' }, { uploadedAt: '2026-01-01T00:00:00.000Z' }),
      ]),
    ).toBe('b-landed');
  });
});

describe('势均力敌时：读出来更多的赢，然后是更新的，然后是定死的顺序', () => {
  it('读出来更多的赢，哪怕更旧', () => {
    expect(
      stablePickedId([
        geneticReport(
          'old-full',
          {
            diagnosisType: 'FSHD1',
            d4z4Repeats: '4',
            haplotype: '4qA',
            geneticTestMethod: 'southern_blot',
          },
          { uploadedAt: '2026-01-01T00:00:00.000Z' },
        ),
        geneticReport('new-thin', { d4z4Repeats: '5' }, { uploadedAt: '2026-09-01T00:00:00.000Z' }),
      ]),
    ).toBe('old-full');
  });

  it('读出来一样多时，更新的赢 —— 这不是「旧的永远赢」', () => {
    expect(
      stablePickedId([
        geneticReport(
          'old',
          { diagnosisType: 'FSHD1', d4z4Repeats: '4' },
          { uploadedAt: '2026-01-01T00:00:00.000Z' },
        ),
        geneticReport(
          'new',
          { diagnosisType: 'FSHD1', d4z4Repeats: '9' },
          { uploadedAt: '2026-09-01T00:00:00.000Z' },
        ),
      ]),
    ).toBe('new');
  });

  it('完全平手时按 id 定，所以没改过的档案每次渲染都一样', () => {
    // Not cosmetic: the export goldens and the share page are hashed,
    // and a pick that depended on row order would have an untouched
    // profile produce a different document every time it re-rendered.
    expect(
      stablePickedId([
        geneticReport('bbb', { d4z4Repeats: '4' }),
        geneticReport('aaa', { d4z4Repeats: '7' }),
      ]),
    ).toBe('aaa');
  });
});

describe('哪些文件根本不参与', () => {
  it('没有任何基因结果的文件不参与', () => {
    expect(
      pickedId([
        doc({
          id: 'mri',
          documentType: 'muscle_mri',
          ocrPayload: {
            fields: { classifiedType: 'muscle_mri', reportImpression: '双侧大腿脂肪浸润' },
          },
        }),
      ]),
    ).toBeNull();
  });

  it('只写了检测方法或诊断日期，不算基因结果', () => {
    // A document whose only genetic content is 「Southern blot」 has
    // reported nothing about this patient, and must not become the
    // document every page names as their genetic evidence.
    expect(
      pickedId([
        medicalSummary('method-only', { geneticTestMethod: 'southern_blot' }),
        medicalSummary('date-only', { diagnosisDate: '2019-05-03' }),
      ]),
    ).toBeNull();
  });

  it('一份文件都没有时，答案是「没有」而不是空值', () => {
    expect(pickGeneticEvidenceDocument([])).toBeNull();
    expect(readGeneticEvidence([])).toEqual({
      documentId: null,
      // `false` here is 「there is no document」 and not 「a transcription
      // supplied it」. Nothing was read, so nothing is attributable
      // either way, and every caller that writes prose about the source
      // branches on `documentId` before it looks at this.
      laboratory: false,
      diagnosisType: null,
      d4z4: null,
      haplotype: null,
      methylation: null,
      diagnosisDate: null,
    });
  });

  it('基因报告什么都没解析出来时，带着基因结果的另一份文件才是该读的那一份', () => {
    // The boundary between the two rules above, stated on purpose. A
    // genetics report that read out nothing is not the laboratory
    // speaking; it is a file this platform has not read. Ranking it
    // over a document that DOES carry the patient's repeat count would
    // be the same erasure as a still-parsing upload, reached by a
    // different road.
    expect(
      stablePickedId([
        geneticReport('empty-genetic', {}, { uploadedAt: '2026-09-01T00:00:00.000Z' }),
        medicalSummary('summary-with-values', { diagnosisType: 'FSHD1', d4z4Repeats: '4' }),
      ]),
    ).toBe('summary-with-values');
  });

  it('只有一份还没解析的报告时，它仍然被点名，但一个值都不供给', () => {
    // So the 基因检测 row can still say when the patient last uploaded
    // something. What it must not do is supply a value it has not read.
    const documents = [
      geneticReport('only-processing', {}, { status: 'processing', ocrPayload: null }),
    ];
    expect(pickedId(documents)).toBe('only-processing');
    expect(readGeneticEvidence(documents)).toEqual({
      documentId: 'only-processing',
      // The row is the laboratory's whether or not its parse has landed
      // — the flag answers what the document IS, and a value it has not
      // supplied yet is a separate question the nulls below answer.
      laboratory: true,
      diagnosisType: null,
      d4z4: null,
      haplotype: null,
      methylation: null,
      diagnosisDate: null,
    });
  });
});

describe('一份报告的读数只能来自这一份报告', () => {
  it('不会把 A 报告的 D4Z4 和 B 报告的单倍型拼成一份', () => {
    // The values are one assay's reading, and the evidence grade is
    // computed against the 检测方法 of the same report. A D4Z4 count
    // taken from a Southern blot and a haplotype taken from a WES,
    // merged, would be graded as one report that has both — which is
    // the sentence this product exists to avoid saying.
    const reading = readGeneticEvidence([
      geneticReport(
        'southern',
        { d4z4Repeats: '4', geneticTestMethod: 'southern_blot', diagnosisType: 'FSHD1' },
        { uploadedAt: '2026-01-01T00:00:00.000Z' },
      ),
      geneticReport(
        'wes',
        { haplotype: '4qA', geneticTestMethod: 'short_read_sequencing' },
        { uploadedAt: '2026-09-01T00:00:00.000Z' },
      ),
    ]);

    expect(reading.documentId).toBe('southern');
    expect(reading.d4z4).toBe('4');
    expect(reading.haplotype).toBeNull();
  });

  it('读数取自被点名的那一份，别的报告有什么都不算', () => {
    const reading = readGeneticEvidence([
      geneticReport('lab', { d4z4Repeats: '4', diagnosisDate: '2019-05-03' }),
      medicalSummary('summary', {
        d4z4Repeats: '7',
        haplotype: '4qA',
        methylationValue: '12%',
        diagnosisDate: '2020-01-01',
      }),
    ]);

    expect(reading).toEqual({
      documentId: 'lab',
      laboratory: true,
      diagnosisType: null,
      d4z4: '4',
      haplotype: null,
      methylation: null,
      diagnosisDate: '2019-05-03',
    });
  });

  /**
   * THE READING SAYS WHOSE PAGE IT CAME OFF.
   *
   * The picker takes a 病历摘要 quoting a repeat count when the genetics
   * report read out nothing, and for a while the reading it returned
   * was the same shape either way — so a caller writing a sentence
   * about the value had the number, the document id, and no way to say
   * whether a laboratory produced it. The registry export answered that
   * by hardcoding 基因报告.
   */
  it('读数带着「这一份是不是实验室自己出的报告」，转录件上的不冒充实验室', () => {
    const transcription = readGeneticEvidence([
      geneticReport('empty-lab', {}),
      medicalSummary('summary', { d4z4Repeats: '3', diagnosisType: 'FSHD1' }),
    ]);
    expect(transcription.documentId).toBe('summary');
    expect(transcription.laboratory).toBe(false);
    // The value still comes back: picking the transcription is what
    // keeps the patient's only copy of the number readable.
    expect(transcription.d4z4).toBe('3');

    // The same profile once the laboratory's own report reads something.
    const laboratory = readGeneticEvidence([
      geneticReport('lab', { d4z4Repeats: '4' }),
      medicalSummary('summary', { d4z4Repeats: '3', diagnosisType: 'FSHD1' }),
    ]);
    expect(laboratory.documentId).toBe('lab');
    expect(laboratory.laboratory).toBe(true);
  });

  it('数字读得出来，数组和对象读不出来', () => {
    // A number is a reading a bridge wrote without quoting it. An array
    // is not: stringifying a haplotype field that lists the probes gave
    // 「4qA,4qB」 and printed it where a result goes. There is no
    // sensible coercion, so there is none.
    expect(readGeneticEvidence([geneticReport('numeric', { d4z4Repeats: 4 })]).d4z4).toBe('4');
    expect(
      readGeneticEvidence([geneticReport('listy', { d4z4Repeats: '4', haplotype: ['4qA', '4qB'] })])
        .haplotype,
    ).toBeNull();
  });
});
