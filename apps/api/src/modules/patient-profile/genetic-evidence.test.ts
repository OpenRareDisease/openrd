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

const geneticReport = (
  id: string,
  fields: Record<string, unknown>,
  over: Partial<GeneticEvidenceDocumentLike> = {},
) =>
  doc({
    id,
    ocrPayload: { fields: { classifiedType: 'genetic_report', ...fields } },
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
    expect(isLaboratoryGeneticReport(geneticReport('empty', {}))).toBe(true);
  });

  it('解析器改判的类型算数，跟排序用的是同一个答案', () => {
    // The uploader picks a type from a dropdown and the parser reads
    // the page; where they disagree the parser wins. Asked through the
    // payload for the same reason the ordering asks it there.
    expect(
      isLaboratoryGeneticReport(
        doc({
          documentType: 'other',
          ocrPayload: { fields: { classifiedType: 'genetic_report', d4z4Repeats: '4' } },
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
          ocrPayload: { fields: { classifiedType: 'genetic_report', d4z4Repeats: '4' } },
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
