import { formatCitationLabel } from '../citation-label';

describe('formatCitationLabel', () => {
  // Every input below is a real `source_file` value from the corpus.
  it.each([
    ['B.FSHD生殖咨询、怀孕和分娩.pdf', 'FSHD生殖咨询、怀孕和分娩'],
    [
      '10、Diagnostic magnetic resonance imaging biomarkers for facioscapulohumeral.pdf',
      'Diagnostic magnetic resonance imaging biomarkers for facioscapulohumeral',
    ],
    ['FSHD-CCEF评分_副本.docx', 'FSHD-CCEF评分'],
    ['1_1_王朝霞肌炎MRI.pdf', '王朝霞肌炎MRI'],
    [
      '（指南）（全面）Dutch-FSHD-Guideline-English-24012019_1_44_translate.pdf',
      '（指南）（全面）Dutch-FSHD-Guideline-English-24012019',
    ],
    ['FSHD_Care_Guidelines_for_Clinicians.pdf', 'FSHD Care Guidelines for Clinicians'],
    ['我们的故事 _ 我的母亲.pdf', '我们的故事 我的母亲'],
  ])('cleans %s', (input, expected) => {
    expect(formatCitationLabel(input)).toBe(expected);
  });

  // Provenance a reader should weigh is not filing noise — keep it.
  it('keeps the machine-translation marker', () => {
    expect(formatCitationLabel('A.2024 FSHD分子诊断指南（谷歌翻译）- Giardina.pdf')).toContain(
      '（谷歌翻译）',
    );
  });

  it.each([
    ['gkaf643.pdf'],
    ['13023_2021_Article_1793-2_副本.pdf'],
    // Publisher DOI-suffix filenames — hyphenated, still nothing to read.
    ['s13395-025-00388-0.pdf'],
    ['fphar-12-642858.pdf'],
  ])('falls back for the opaque id %s', (input) => {
    expect(formatCitationLabel(input)).toBe('医学知识库');
  });

  // A title that resumes letters after its digits is a real name.
  it('keeps a title containing a year', () => {
    expect(formatCitationLabel('Shanghai FSHD models 2025 PLJ.pdf')).toBe(
      'Shanghai FSHD models 2025 PLJ',
    );
  });

  it('falls back when there is no source file', () => {
    expect(formatCitationLabel(null)).toBe('医学知识库');
    expect(formatCitationLabel('')).toBe('医学知识库');
  });
});

describe('retriever-id fallbacks', () => {
  // These are internal ids and were rendering verbatim: a patient
  // asking about their own genetics saw 「引用 8 条：medical_kb、
  // medical_kb、…」.
  it.each([
    ['medical_kb', '医学知识库'],
    ['patient_reports', '你的检查报告'],
    ['patient_profile', '你的健康档案'],
    ['patient_followups', '你的日常记录'],
  ])('renders %s as %s', (source, expected) => {
    expect(formatCitationLabel(null, source)).toBe(expected);
    // …and as the fallback when the filename is an opaque id.
    expect(formatCitationLabel('gkaf643.pdf', source)).toBe(expected);
  });

  it('never leaks an unknown retriever id', () => {
    expect(formatCitationLabel(null, 'some_future_retriever')).toBe('医学知识库');
  });
});

describe('patient-report source files', () => {
  // A report's sourceFile is its storage path. Rendering it verbatim
  // put the internal directory layout — including the per-user id
  // segment — under the answer a patient reads.
  it('shows only the basename, never the storage path', () => {
    expect(
      formatCitationLabel(
        '/var/data/uploads/u-d5180149/2026-07-31_基因检测.pdf',
        'patient_reports',
      ),
    ).toBe('2026-07-31 基因检测');
  });

  it('falls back for an opaque upload name rather than showing the path', () => {
    expect(formatCitationLabel('uploads/abc123.jpeg', 'patient_reports')).toBe('你的检查报告');
  });

  // Reports are photographed as often as they are scanned, so the
  // image extensions matter as much as .pdf here.
  it.each([['jpeg'], ['PNG'], ['heic'], ['tiff']])('strips the .%s extension', (ext) => {
    expect(formatCitationLabel(`肌肉MRI报告.${ext}`, 'patient_reports')).toBe('肌肉MRI报告');
  });
});
