/**
 * Turn a knowledge-base source filename into something a patient can
 * read.
 *
 * Why
 * ---
 * Citations name their source by `sourceFile`, which is the filename as
 * ingested. Until the KB service was running these were never seen —
 * every answer came back with zero citations — and the first real ones
 * looked like this under an answer about exercise:
 *
 *   引用 5 条：13023_2021_Article_1793-2_副本.pdf、gkaf643.pdf、
 *   B.FSHD生殖咨询、怀孕和分娩.pdf…
 *
 * A citation exists to tell a patient where an answer came from, so
 * that they can weigh it and, if they want, take it to their doctor.
 * `gkaf643.pdf` does the opposite: it reads like a machine leaked
 * something. The ingest artefacts — a sort prefix, a page range, a
 * 「_副本」 from a duplicated download, a `_1_1_translate` suffix — say
 * nothing about the source and crowd out the part that does.
 *
 * What is kept
 * ------------
 * Anything that describes the document survives, including provenance
 * a reader should weigh:「（谷歌翻译）」stays, because a machine-
 * translated guideline is exactly the kind of thing worth knowing you
 * are reading. Only filing mechanics are removed.
 *
 * The true filename stays on the wire and in the audit trail; this is
 * display only.
 */

/** `.pdf`, `.docx`, `.html`… */
const EXTENSION = /\.(pdf|docx?|html?|txt|md|pptx?|csv|jpe?g|png|webp|heic|tiff?)$/i;

const NOISE: readonly RegExp[] = [
  // Filing prefixes used to order the corpus: `A.`, `B.`, `10、`, `1_1_`.
  /^[A-Z][.、]\s*/,
  /^\d+\s*[、.]\s*/,
  /^\d+_\d+_/,
  // Duplicate-download marker.
  /[_\s]*副本/g,
  // Page-range + translation suffixes from the ingest pipeline:
  // `_1_44_translate`, `_1_1_translate`, `_1_1`.
  /_\d+_\d+(_translate)?$/i,
  // A trailing `-2`, `(1)` etc. from a re-download.
  /[-\s]*\(\d+\)$/,
  // Publisher filing vocabulary. `13023_2021_Article_1793-2` reduces to
  // 「Article 1793-2」 without this, which tells a patient no more than
  // the raw id did — the word is the publisher's, not the document's.
  // `\b` does not fire inside `_Article_` — underscore is a word
  // character — so the boundary has to be spelled out.
  /(?<![A-Za-z])(Article|Paper|Document|Supplement(ary)?|Manuscript)(?![A-Za-z])/gi,
];

/**
 * Filenames that carry no information at all — a bare journal or
 * repository id. Shown as a neutral label instead of a fake title.
 *
 * Matched after separators are stripped, because publishers hyphenate
 * these freely: `s13395-025-00388-0` and `fphar-12-642858` are both a
 * short alpha prefix followed by nothing but digits, and neither tells
 * a patient anything. A name that resumes letters after its digits —
 * `Shanghai FSHD models 2025 PLJ` — is a real title and survives.
 */
const OPAQUE = /^[a-z]{0,6}\d+$/i;

/**
 * Retriever ids, which are what a citation falls back to when it has no
 * filename. `medical_kb` and `patient_reports` are internal names and
 * were rendering verbatim — a patient asking about their own genetics
 * saw 「引用 8 条：medical_kb、medical_kb、…」.
 */
const SOURCE_LABELS: Record<string, string> = {
  medical_kb: '医学知识库',
  platform_docs: '平台文档',
  patient_profile: '你的健康档案',
  patient_reports: '你的检查报告',
  patient_followups: '你的日常记录',
};

export const labelForSource = (source: string | null | undefined): string =>
  SOURCE_LABELS[(source ?? '').trim()] ?? '医学知识库';

export const formatCitationLabel = (
  sourceFile: string | null | undefined,
  source?: string | null,
): string => {
  const fallback = labelForSource(source);
  const raw = (sourceFile ?? '').trim();
  if (!raw) return fallback;

  // Only ever the basename. A patient report's `sourceFile` is its
  // storage path, and rendering that put an internal directory layout —
  // including the per-user id segment — under the answer, where it is
  // both meaningless and more than the reader should be shown.
  let label = raw.split(/[/\\]/).pop() ?? raw;
  label = label.replace(EXTENSION, '');
  for (const pattern of NOISE) label = label.replace(pattern, '');
  label = label
    .replace(/[_]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // `gkaf643`, `13023 2021 Article 1793-2` — nothing left worth showing.
  if (!label || OPAQUE.test(label.replace(/[-_\s]/g, ''))) return fallback;
  return label;
};
