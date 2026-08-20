import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ApiError,
  deletePatientDocument,
  generatePatientDocumentSummary,
  getMyConsent,
  getPatientDocumentOcr,
  patchPatientDocumentOcr,
  reparsePatientDocument,
  updateMyConsent,
  type PatientDocument,
} from '../../lib/api';
import { bumpConsentEpoch } from '../../lib/consent-epoch';
import { inferMriBodyMap, inferReportKind, type BodyView } from '../../lib/clinical-visuals';
import { COLOR } from '../../lib/design';
import { buildReportInsights, getSystemPanelHeroMetrics } from '../../lib/report-insights';
import { describeReportDelete } from '../../lib/report-delete';
import Button from '../common/Button';
import SegmentedControl from '../common/SegmentedControl';
import AnswerText from '../common/AnswerText';
import AskAboutDrawer from '../common/AskAboutDrawer';
import styles from './styles';
import { shouldAutoSummarize } from './auto-summary';

import InlineNotice from '../common/feedback/InlineNotice';
import HumanBodyFigure from '../common/HumanBodyFigure';
import ScreenHeader from '../common/ScreenHeader';
import SystemMonitoringPanels from '../common/SystemMonitoringPanels';
import { useAppDialog } from '../common/feedback/AppDialog';

/** Every spelling a parse has ever written a given value under, in
 *  preference order — the same lists the passport, the profile
 *  autofill and report-insights carry, because they are all reading
 *  one payload written by one pipeline.
 *
 *  There is one list per value and both readers on this screen use it.
 *  The field table and the correction sheet used to keep their own,
 *  and they had drifted: the sheet's 单倍型 knew the spelling the
 *  passport reads and the table's did not, so a report carrying it
 *  opened a sheet showing a 单倍型 the screen behind the sheet had no
 *  row for. Two readers of the same value cannot disagree about
 *  whether it exists. */
const OCR_FIELD_KEYS = {
  reportName: ['reportName', 'report_name'],
  reportTime: ['reportTime', 'report_time'],
  diagnosisType: ['diagnosisType', 'geneType', 'geneticType', 'diagnosis_type', 'genetic_type'],
  d4z4Repeats: ['d4z4Repeats', 'd4z4RepeatPathogenic', 'd4z4_repeat_pathogenic', 'd4z4_repeats'],
  haplotype: ['haplotype', 'haplotype4q', 'haplotype_4q'],
  methylationValue: ['methylationValue', 'methylation_value'],
} as const;

/** Whitelisted OCR fields a patient can hand-correct — `key` mirrors
 *  the backend's EDITABLE_OCR_FIELDS schema exactly, and is the name
 *  the PATCH writes back under; `read` is the shared alias list above.
 *  Every field is rendered whether or not the parse produced it, so a
 *  value the parse never found gets a box to type into, not only a box
 *  to correct in. */
const CORRECTABLE_OCR_FIELDS: Array<{
  key: string;
  label: string;
  placeholder: string;
  read: readonly string[];
}> = [
  {
    key: 'reportName',
    label: '报告名称',
    placeholder: '例如：基因检测报告',
    read: OCR_FIELD_KEYS.reportName,
  },
  {
    key: 'reportTime',
    label: '报告时间',
    placeholder: '例如：2026-03-12',
    read: OCR_FIELD_KEYS.reportTime,
  },
  {
    key: 'diagnosisType',
    label: 'FSHD 分型',
    placeholder: '例如：FSHD1',
    read: OCR_FIELD_KEYS.diagnosisType,
  },
  {
    key: 'd4z4Repeats',
    label: 'D4Z4 重复数',
    placeholder: '例如：4/22',
    read: OCR_FIELD_KEYS.d4z4Repeats,
  },
  {
    key: 'haplotype',
    label: '单倍型',
    placeholder: '例如：4qA',
    read: OCR_FIELD_KEYS.haplotype,
  },
  {
    key: 'methylationValue',
    label: '甲基化',
    placeholder: '例如：12%',
    read: OCR_FIELD_KEYS.methylationValue,
  },
];

type OcrPayload = NonNullable<PatientDocument['ocrPayload']>;
/** The one member of the stored payload that is not on the DTO: the
 *  page's own OCR text, under the spelling older rows used.
 *
 *  `aiExtraction` / `ai_extraction` were declared here and are gone
 *  with the reader that used them — 来源追溯 dumped that blob as JSON to
 *  the patient and no longer does. A declared field nothing reads is a
 *  standing invitation to print it again. */
type DebugPayload = OcrPayload & {
  extracted_text?: string;
};

/**
 * ══════════════════════════════════════════════════════════════════════
 * WHAT THE READ-PATH GUARD DID TO THIS PAYLOAD, WHICH THIS SCREEN WAS
 * NOT ASKING.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `withholdUnsafeReadings` in the API's profile.service.ts asks two
 * questions of every laboratory reading on a payload before it goes out
 * — is this number the same number as another row's, and does it sit
 * outside the interval this same report printed beside it — and files
 * the answer at the TOP LEVEL of the payload as `unsafeReadings`, with
 * a one-line summary under `unsafeReadingsNotice`. A WITHHELD reading
 * has had its cell deleted from `fields` under every spelling it had; a
 * FLAGGED one is still there and is not to be printed as an ordinary
 * number.
 *
 * That file's own note names the surfaces that owe the reader the other
 * half of the defence, and this screen is on the list — it is the FIRST
 * one on it, because it is the screen a patient opens to look at one
 * report. It read `fields` and nothing else. So a report whose LDH was
 * withheld for being a row index rendered as a report that simply has
 * one row fewer: no gap, no mark, no sentence, nothing anywhere on the
 * page saying a number had been taken out or why. A patient comparing
 * this screen against the paper in their hand would find a row on the
 * paper and no row here, and the only available conclusion is that this
 * platform failed to read it.
 *
 * THE VALUE IS NEVER IN THIS RECORD AND MUST NOT BE PUT BACK. A
 * withheld cell was deleted; handing the number back under a second key
 * would make the deletion theatre. The analyte, its spellings and the
 * reason are all a surface gets, and all it needs.
 *
 * DECLARED HERE RATHER THAN ON THE DTO because this screen is the only
 * reader in this bundle, exactly as `extracted_text` above is.
 */
interface UnsafeReading {
  analyte: string;
  keys: string[];
  disposition: 'withheld' | 'flagged';
  reason: string;
  sharedWith?: string[];
  corroboration?: string;
}

type GuardedPayload = OcrPayload & {
  unsafeReadings?: UnsafeReading[];
  unsafeReadingsNotice?: string;
};

const readUnsafeReadings = (payload: OcrPayload | null): UnsafeReading[] => {
  const raw = (payload as GuardedPayload | null)?.unsafeReadings;
  if (!Array.isArray(raw)) return [];
  // A malformed entry is dropped rather than rendered: this list drives
  // a sentence about a patient's own laboratory result, and a row with
  // no analyte and no keys cannot be turned into a true one.
  return raw.filter(
    (item): item is UnsafeReading =>
      Boolean(item) &&
      typeof item.analyte === 'string' &&
      Array.isArray(item.keys) &&
      (item.disposition === 'withheld' || item.disposition === 'flagged'),
  );
};

const readUnsafeNotice = (payload: OcrPayload | null): string | null => {
  const raw = (payload as GuardedPayload | null)?.unsafeReadingsNotice;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
};

/** Why this platform stopped showing a number, or marked one — the same
 *  four cases `buildUnsafeReadingNotice` composes its sentence from,
 *  said one cell at a time. The notice says THAT it happened; this says
 *  to WHICH reading, which is the half a patient holding the paper
 *  report needs.
 *
 *  Keyed on the pair, because the same reason means different things
 *  under the two dispositions: a duplicate the page could not settle is
 *  withheld, and one it could corroborate is only marked. */
const UNSAFE_REASON_ZH: Record<string, string> = {
  'withheld:duplicate_reading': '和这份报告上的另一个项目印着同一个数，报告原件核对不上',
  'withheld:contradictory_aliases': '同一个项目读出了两个互相矛盾的数值',
  'flagged:duplicate_reading': '和这份报告上的另一个项目印着同一个数，无法用报告原件核对',
  'flagged:outside_reference_interval': '超出报告自己印的参考区间',
};

/** The fall-throughs say only what the disposition itself guarantees.
 *  A reason this build has no wording for is still a reading the reader
 *  must be told about — dropping the row would hide the very thing this
 *  panel exists for. */
const UNSAFE_REASON_FALLBACK_ZH: Record<UnsafeReading['disposition'], string> = {
  withheld: '这一项没有通过本平台的核对',
  flagged: '这一项需要你对着报告原件核对',
};

/** Why a duplicate was believed, in the guard's own closed vocabulary.
 *  Printed so the judgement can be checked against the paper rather
 *  than only trusted. */
const UNSAFE_CORROBORATION_ZH: Record<string, string> = {
  page_prints_it_once: '报告原文里这个数只出现过一次',
  three_or_more_rows: '同一个数出现在三个以上的项目上',
  known_pair: '这两个项目本来就容易被读串',
  one_row_twice: '两行的单位和参考区间完全一样，像是同一行被读了两遍',
};

const getAnalysisStatus = (payload: OcrPayload | null) => {
  const status = payload?.fields?.analysisStatus ?? payload?.fields?.analysis_status;
  return typeof status === 'string' ? status : undefined;
};

const isProcessing = (payload: OcrPayload | null) => {
  const status = getAnalysisStatus(payload);
  return status === 'processing' || status === 'pending';
};

/** The pipeline's own count of what it extracted, read the way the
 *  server's reparse gate reads it: absent or unparseable counts as
 *  zero. That equivalence is the point — it is what makes a 「识别完成」
 *  that extracted nothing a report the server will re-run. */
const countExtractedFields = (payload: OcrPayload | null): number => {
  const parsed = Number.parseInt(String(payload?.fields?.fieldCount ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Keys written into `fields` that are not values read off the report:
 *  the parse's own status, its counters, its diagnostics, the type
 *  hint the uploader handed it, its classification of the document,
 *  the placeholder line the stand-in provider writes when no real OCR
 *  is configured, and the stamps this app adds afterwards. Everything
 *  else in `fields` came out of the report.
 *
 *  The classification entries sit here rather than among the values
 *  because a re-run re-derives them from the same file — nothing is
 *  lost by parsing again — while the reparse gate exists precisely for
 *  reports the classifier labelled and the extractor came away from
 *  empty. Treating a type label as extracted evidence would withhold
 *  the re-run from exactly those reports.
 *
 *  THE AI SUMMARY IS THREE KEYS, NOT ONE. `generateDocumentSummary`
 *  writes the sentence, the producer that wrote it (the model, or the
 *  rule-based fallback it uses when the model call fails) and the hash
 *  of the prompt the sentence is cached against, in one write into
 *  this same record. Listing only the sentence meant an empty parse
 *  started reading as a report full of data as soon as a summary was
 *  generated for it — which happens by itself, unattended, the moment
 *  the parse settles under granted AI consent. It is the whole block
 *  or none of it: a summary describes the report, it is not a reading
 *  taken off it, and it survives a re-run because it is regenerated
 *  from whatever the re-run finds.
 *
 *  Only the spelling each writer actually emits is listed. The OCR
 *  bridge copies its Python fields in under both cases, which is why
 *  those appear twice; the summary is written by one server-side path
 *  in camelCase, and `ai_summary` below is the one exception — a
 *  spelling no current writer emits, kept because payloads on disk
 *  predate this pipeline. Nothing new is added on that pattern. */
const PIPELINE_BOOKKEEPING_FIELDS = new Set([
  'documentType',
  'document_type',
  'analysisStatus',
  'analysis_status',
  'ocrStatus',
  'ocr_status',
  'ocrIssue',
  'ocr_issue',
  'extractedTextLength',
  'extracted_text_length',
  'reviewRecommendedCount',
  'review_recommended_count',
  'fieldCount',
  'field_count',
  'classifiedType',
  'classified_type',
  'classifiedTypeConfidence',
  'classified_type_confidence',
  'reportTypeLabel',
  'report_type_label',
  'manuallyEditedAt',
  'manually_edited_at',
  'aiSummary',
  'ai_summary',
  'aiSummarySource',
  'aiSummaryInputHash',
  'hint',
]);

/** Does this payload still hold something a parse took off the report?
 *
 *  Read off the payload, not off the rows this screen drew. The
 *  passport reads the same `fields` record with its own key list, and
 *  that list is not this screen's: a 诊断日期 or a 检测方法 has no row
 *  in the table here and is printed on the passport all the same. A
 *  guard derived from the table therefore called a report empty while
 *  the passport was printing it, and put a button beside that sentence
 *  which blanks `ocr_payload` before re-running. Anything the passport
 *  can print lives under a key that is not bookkeeping, so this
 *  question covers it without having to enumerate the passport's
 *  list. */
const carriesExtractedValues = (payload: OcrPayload | null): boolean => {
  const fields = payload?.fields;
  if (!fields) return false;
  return Object.entries(fields).some(
    ([key, value]) => !PIPELINE_BOOKKEEPING_FIELDS.has(key) && String(value ?? '').trim() !== '',
  );
};

/** What this row offers, or nothing at all.
 *
 *  Eligibility mirrors the reparse endpoint rather than approximating
 *  it, because the cost of the two drifting apart is a button that
 *  answers a tap with a 409: a failed parse, a row the pipeline has
 *  not settled, a parse whose job evidently died, and a 「识别完成」
 *  holding no extracted fields.
 *
 *  `pollTimedOut` is this screen's stand-in for the server's stuck-job
 *  test, and it is the one input that is a guess: the server judges
 *  staleness from the upload time, we judge it from ten minutes of
 *  watching. They usually agree and can disagree at the boundary,
 *  which is why the refusal path re-reads the row instead of
 *  insisting.
 *
 *  A row the server would re-run is still offered nothing whenever
 *  `carriesExtractedValues` says the payload holds values some reader
 *  is printing, because the action here starts by blanking that
 *  payload. Withholding the offer costs a recovery path the patient
 *  did not ask for; making it costs them their own numbers.
 *
 *  An `uploaded` row splits on whether a parse landed a payload at
 *  all. It is the only signal that separates the two, and they are
 *  different situations: nothing has run yet (OCR switched off, or a
 *  row older than the async pipeline), versus a parse that ran and
 *  came back with a result the pipeline could not label — which is
 *  what every provider that files no analysisStatus produces. The
 *  second one had been reading 「还没有开始识别」 under a button
 *  labelled 开始识别, so the patient started a parse that had already
 *  happened and landed back on the same sentence, with nothing on the
 *  page admitting the round trip. */
type ReparseOffer = { message: string; retryLabel: string };

const resolveReparseOffer = (
  rowStatus: string | null | undefined,
  payload: OcrPayload | null,
  pollTimedOut: boolean,
): ReparseOffer | null => {
  if (pollTimedOut) {
    return { message: '识别时间超出预期，任务可能已中断。', retryLabel: '重新识别' };
  }
  if (rowStatus === 'parse_failed') {
    return { message: '这份报告识别失败了，可以重新识别一次。', retryLabel: '重新识别' };
  }
  if (rowStatus === 'uploaded') {
    if (!payload) {
      return { message: '这份报告还没有开始识别。', retryLabel: '开始识别' };
    }
    if (carriesExtractedValues(payload)) return null;
    return {
      message: '这份报告识别过一次，没有取到报告里的具体数据。再识别一次可能仍是这个结果。',
      retryLabel: '重新识别',
    };
  }
  if (
    rowStatus === 'parsed' &&
    countExtractedFields(payload) === 0 &&
    !carriesExtractedValues(payload)
  ) {
    return {
      message: '这次识别没有取到报告里的具体数据，可以再识别一次。',
      retryLabel: '重新识别',
    };
  }
  return null;
};

const pickField = (fields: Record<string, string> | undefined, keys: readonly string[]) => {
  if (!fields) return undefined;
  for (const key of keys) {
    const raw = fields[key];
    if (raw === null || raw === undefined) continue;
    const text = String(raw).trim();
    if (text) return text;
  }
  return undefined;
};

/** Chip colour only — the label stays the raw pipeline status so the
 *  string a patient reads is unchanged by this styling pass. */
const statusChipTone = (status: string) => {
  switch (status) {
    case 'parsed':
      return { chip: styles.statusChipGood, text: styles.statusChipGoodText };
    case 'processing':
    case 'pending':
    case 'needs_review':
      return { chip: styles.statusChipWarn, text: styles.statusChipWarnText };
    case 'parse_failed':
      return { chip: styles.statusChipAlert, text: styles.statusChipAlertText };
    default:
      return { chip: undefined, text: undefined };
  }
};

/** Pipeline status → what the patient should read. `parsed` /
 *  `parse_failed` are our state machine's vocabulary, not theirs. */
/**
 * 性别, BACK IN CHINESE.
 *
 * `patientSex` is not the report's own word. The report said 「男」; the
 * parser (`_parse_patient_info` in fshd_report_service.py) matched it
 * and stored `male`, and this page printed `male` under 性别 — on a page
 * where every other value is Chinese, to a patient reading a Chinese
 * report that had the right word on it in the first place. A round trip
 * out of the language and back with the meaning intact and only the
 * wording lost.
 *
 * The parser falls THROUGH for anything it does not recognise (its last
 * branch is `else raw_sex`), so this must fall through too: an
 * unmatched value is the report's own text, and printing it is right.
 * That is also why this is a lookup and not a boolean — mapping the
 * unknown case onto one of the two would state a sex nobody read.
 *
 * Beside `formatStatusLabel` because it is the same bug that comment
 * already describes: an English enum painted into a Chinese row.
 */
const SEX_LABELS: Record<string, string> = {
  male: '男',
  female: '女',
};

const formatSexLabel = (value?: string): string | undefined =>
  value === undefined ? undefined : (SEX_LABELS[value.trim().toLowerCase()] ?? value);

const formatStatusLabel = (status: string): string => {
  switch (status) {
    case 'parsed':
      return '识别完成';
    case 'processing':
      return '识别中';
    case 'parse_failed':
      return '识别失败';
    case 'needs_review':
      return '待核对';
    case 'uploaded':
      return '待识别';
    default:
      return status;
  }
};

/** `0.99` → `99%`. A 0–1 float is a number for a log line. */
const formatConfidence = (raw: string | undefined): string | undefined => {
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) return raw;
  return `${Math.round(value * 100)}%`;
};

/**
 * ══════════════════════════════════════════════════════════════════════
 * 来源追溯 IS FOR CLINICAL CROSS-CHECKING. IT WAS A JSON DUMP.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The panel said 「保留原始字段、AI 抽取结果和 OCR 文本，便于设计稿之外的
 * 临床核对」 and then printed `JSON.stringify({ fields, aiExtraction,
 * extractedText })` — braces, quoted keys, every payload key in
 * snake_case or camelCase, every stored enum in English — to the
 * patient, on the screen whose own sibling test is headed 「NO WIRE ENUM
 * REACHES THE PATIENT ON THIS SCREEN」. 性别 was fixed in the table
 * above while `"patientSex": "male"` sat in the panel below it.
 *
 * WHAT CROSS-CHECKING ACTUALLY IS, which is what decides the shape:
 * someone holding the paper report wants to compare, cell by cell, what
 * this platform read against what the laboratory printed. That needs
 * two things and neither of them is JSON —
 *
 *   1. EVERY CELL THIS PLATFORM READ, named in the language of the
 *      report, including the ones no card above happens to render. The
 *      cards are curated; this list is not, and that is its whole job.
 *   2. THE PAGE'S OWN TEXT, as text, so a cell the parser MISSED is
 *      visible as a gap between the two.
 *
 * AND `aiExtraction` IS GONE. It is an intermediate blob from the
 * extraction model — not a cell off the report and not the report's own
 * words, so it is neither of the two things above. Dumping it invited
 * the reader to check the report against a machine's working notes, and
 * it was the largest source of raw keys on the panel. A patient who
 * needs the underlying record has 报告管理 → 导出; a maintainer has the
 * server logs.
 *
 * THE TABLE IS THIS BUNDLE'S OWN, and that is the arrangement rather
 * than an accident. A handset cannot import from apps/api, so the same
 * vocabulary is spelled in `OCR_FIELD_LABELS_ZH` there (where it is
 * also what admits a cell to a prompt) and here (where it is what a
 * patient reads) — the same split `humanize.ts` lives with for the
 * allowlist keys. What keeps it honest is the fall-through below rather
 * than a parity check: a cell this table has not caught up with still
 * appears, so the gap is visible on the screen instead of silently
 * shrinking the list.
 *
 * A KEY WITH NO CHINESE NAME IS STILL SHOWN, under its own heading that
 * says so. Hiding it would make this panel less complete than the dump
 * it replaces, and completeness is the point; what changes is that an
 * identifier is presented as this platform's own gap rather than
 * printed in a row that looks like a medical term.
 */
const TRACE_FIELD_LABELS: Record<string, string> = {
  // Report identity
  reportName: '报告名称',
  report_name: '报告名称',
  reportTime: '报告时间',
  report_time: '报告时间',
  reportId: '报告编号',
  facility: '医院',
  department: '科室',
  specimen: '标本',
  testMethod: '检测方法',
  test_method: '检测方法',
  methodology: '检测方法',
  // Genetics
  diagnosisType: 'FSHD 分型',
  diagnosis_type: 'FSHD 分型',
  geneType: '基因分型',
  geneticType: '基因分型',
  d4z4Repeats: 'D4Z4 重复数',
  d4z4_repeats: 'D4Z4 重复数',
  d4z4RepeatPathogenic: 'D4Z4 收缩等位基因重复数',
  d4z4_repeat_pathogenic: 'D4Z4 收缩等位基因重复数',
  d4z4RepeatOther: 'D4Z4 另一条等位基因重复数',
  d4z4_repeat_other: 'D4Z4 另一条等位基因重复数',
  haplotype: '单倍型',
  haplotype4q: '单倍型',
  haplotype_4q: '单倍型',
  methylationValue: '甲基化值',
  methylation_value: '甲基化值',
  ecoRIFragment: 'EcoRI 片段长度',
  ecoriFragmentKb: 'EcoRI 片段长度（kb）',
  ecori_fragment_kb: 'EcoRI 片段长度（kb）',
  diagnosisDate: '诊断日期',
  diagnosis_date: '诊断日期',
  // Muscle enzymes / biochemistry
  ck: '肌酸激酶 CK',
  creatineKinase: '肌酸激酶',
  creatine_kinase: '肌酸激酶',
  ckmb: '肌酸激酶同工酶 CK-MB',
  ldh: '乳酸脱氢酶 LDH',
  mb: '肌红蛋白 Mb',
  myoglobin: '肌红蛋白',
  alt: '丙氨酸氨基转移酶 ALT',
  ast: '天冬氨酸氨基转移酶 AST',
  creatinine: '肌酐',
  uricAcid: '尿酸',
  uric_acid: '尿酸',
  calcium: '钙',
  // Haematology
  wbc: '白细胞计数',
  rbc: '红细胞计数',
  hgb: '血红蛋白',
  hct: '红细胞压积',
  plt: '血小板计数',
  // Coagulation
  pt: '凝血酶原时间 PT',
  inr: '国际标准化比值 INR',
  aptt: '活化部分凝血活酶时间 APTT',
  tt: '凝血酶时间 TT',
  fibrinogen: '纤维蛋白原',
  // Thyroid
  ft3: '游离三碘甲状腺原氨酸 FT3',
  ft4: '游离甲状腺素 FT4',
  tsh: '促甲状腺激素 TSH',
  // Pulmonary
  fvc: '用力肺活量 FVC',
  fvcPredPct: '用力肺活量占预计值',
  fvc_pred_pct: '用力肺活量占预计值',
  fev1: '第一秒用力呼气容积 FEV1',
  dlco: '一氧化碳弥散量 DLCO',
  dlcoPredPct: '弥散量占预计值',
  dlco_pred_pct: '弥散量占预计值',
  tlcPredPct: 'TLC 占预计值',
  tlc_pred_pct: 'TLC 占预计值',
  ventilatoryPattern: '通气模式',
  ventilatory_pattern: '通气模式',
  // Cardiac
  heartRate: '心率',
  heart_rate: '心率',
  ecgRhythm: '心电节律',
  ecg_rhythm: '心电节律',
  ecgSummary: '心电结论',
  ecg_summary: '心电结论',
  echoSummary: '心超结论',
  echo_summary: '心超结论',
  conductionAbnormality: '传导异常',
  conduction_abnormality: '传导异常',
  LVEF: 'LVEF',
  lvef: 'LVEF',
  QTc: 'QTc',
  qtc: 'QTc',
  qtcMs: 'QTc 间期（ms）',
  qtc_ms: 'QTc 间期（ms）',
  qtMs: 'QT 间期（ms）',
  qt_ms: 'QT 间期（ms）',
  prIntervalMs: 'PR 间期（ms）',
  pr_interval_ms: 'PR 间期（ms）',
  qrsDurationMs: 'QRS 时限（ms）',
  qrs_duration_ms: 'QRS 时限（ms）',
  // Imaging
  fattyInfiltration: '脂肪浸润',
  fatty_infiltration: '脂肪浸润',
  inflammatoryChange: '炎性改变',
  inflammatory_change: '炎性改变',
  asymmetry: '左右不对称',
  serratusFatigueGrade: '前锯肌脂肪化等级',
  serratus_fatigue_grade: '前锯肌脂肪化等级',
  reportImpression: '报告印象',
  report_impression: '报告印象',
  impressionText: '报告印象',
  impression_text: '报告印象',
  findingText: '影像所见',
  finding_text: '影像所见',
  abdominalUltrasoundImpression: '腹部超声提示',
  abdominal_ultrasound_impression: '腹部超声提示',
  diaphragmMotionSummary: '膈肌运动',
  diaphragm_motion_summary: '膈肌运动',
  // Patient identity the parse lifted off the page. Named rather than
  // hidden: it is on the paper the reader is holding, and a name this
  // platform read WRONG is exactly the kind of thing a cross-check is
  // for.
  patientName: '患者姓名',
  patientSex: '性别',
  patientAge: '年龄',
  orderingDoctor: '送检医生',
  ordering_doctor: '送检医生',
  bedNo: '床号',
  bed_no: '床号',
};

/** The suffixes the OCR bridge writes the laboratory's own abnormal
 *  marker and reference interval under — one spelling each, camelCase,
 *  as `services/ocr/embedded-report-ocr.ts` writes them. */
const TRACE_FLAG_SUFFIX = 'Flag';
const TRACE_REFERENCE_SUFFIX = 'Reference';

/** `high` / `low` are tokens this platform minted out of 「↑」, 「偏高」
 *  and a bare 「H」 (`_read_row_flag` in the parser), so they are
 *  localised here for the same reason `patientSex` is. */
const TRACE_FLAG_LABELS: Record<string, string> = {
  high: '偏高',
  low: '偏低',
  abnormal_unspecified: '异常',
};

/** How much of the page's own text the panel prints. The rest is
 *  reachable through 报告管理 → 导出; a phone rendering an unbounded
 *  string is a phone that stops scrolling. */
const OCR_TEXT_LIMIT = 4000;

/** One traceability row: what to call the cell, and what this platform
 *  read into it. `named` is false for a key with no Chinese name — the
 *  row still prints, under its own heading.
 *
 *  `mark` is what the read-path guard said about THIS cell, where it
 *  said anything. A flagged reading is still printed — that is what
 *  separates it from a withheld one — and a defence that marks where
 *  nothing shows the mark is a defence that does nothing. */
interface TraceRow {
  key: string;
  label: string;
  value: string;
  named: boolean;
  mark?: string;
}

const traceLabelFor = (key: string): string | undefined => {
  const direct = TRACE_FIELD_LABELS[key];
  if (direct) return direct;
  for (const [suffix, word] of [
    [TRACE_FLAG_SUFFIX, '异常标记'],
    [TRACE_REFERENCE_SUFFIX, '参考区间'],
  ] as const) {
    if (!key.endsWith(suffix)) continue;
    const base = TRACE_FIELD_LABELS[key.slice(0, -suffix.length)];
    if (base) return `${base} ${word}`;
  }
  return undefined;
};

/** 通气模式, in Chinese. Parsed out of a Chinese report, stored in
 *  English, and read by Chinese speakers — the same round trip 性别
 *  makes. Mirrors `VENTILATORY_PATTERN_ZH` in the API's passport. */
const VENTILATORY_PATTERN_LABELS: Record<string, string> = {
  restrictive: '限制性通气功能障碍',
  obstructive: '阻塞性通气功能障碍',
  mixed: '混合性通气功能障碍',
  normal: '通气功能正常',
};

const traceValueFor = (key: string, raw: string): string => {
  if (key.endsWith(TRACE_FLAG_SUFFIX)) {
    return TRACE_FLAG_LABELS[raw.trim().toLowerCase()] ?? raw;
  }
  if (key === 'patientSex') return formatSexLabel(raw) ?? raw;
  if (key === 'ventilatoryPattern' || key === 'ventilatory_pattern') {
    return VENTILATORY_PATTERN_LABELS[raw.trim()] ?? raw;
  }
  return raw;
};

/**
 * WHAT TO CALL A READING THAT IS NO LONGER IN `fields`.
 *
 * A withheld entry's `keys` are the cells that are GONE, so the only
 * names available are the spellings themselves and the canonical
 * analyte. Every one of them is tried against the same table the cross-
 * check panel uses, so a value this screen would have called 乳酸脱氢酶
 * LDH is called that in the sentence saying it is not being shown.
 *
 * The raw analyte is the fall-through, for the same reason an unnamed
 * cell still prints in 来源追溯: a reading this platform stopped showing
 * and cannot name is the one it most owes the reader an admission
 * about.
 */
const unsafeReadingLabel = (reading: UnsafeReading): string => {
  for (const key of [...reading.keys, reading.analyte]) {
    const named = traceLabelFor(key);
    if (named) return named;
  }
  return reading.analyte;
};

/** The one-line 「why」 for a single reading: the reason, then — for a
 *  duplicate — which other item on the page shares the number, and what
 *  made this platform believe it was one row read twice.
 *
 *  A corroboration token this build has no wording for is dropped
 *  rather than printed raw: it is an audit word, and the reason above
 *  is already the true half of the sentence. */
const unsafeReadingDetail = (reading: UnsafeReading): string => {
  const reason =
    UNSAFE_REASON_ZH[`${reading.disposition}:${reading.reason}`] ??
    UNSAFE_REASON_FALLBACK_ZH[reading.disposition];
  const shared = (reading.sharedWith ?? []).map((analyte) => traceLabelFor(analyte) ?? analyte);
  const corroboration = reading.corroboration
    ? UNSAFE_CORROBORATION_ZH[reading.corroboration]
    : undefined;
  const aside = [
    shared.length > 0 ? `与${shared.join('、')}是同一个数` : undefined,
    corroboration ? `依据：${corroboration}` : undefined,
  ].filter((part): part is string => Boolean(part));
  return aside.length > 0 ? `${reason}（${aside.join('；')}）` : reason;
};

/** Every `fields` spelling the guard marked but did NOT delete, mapped
 *  to the mark that belongs on it. Withheld entries are absent on
 *  purpose: their cells are gone, so there is no row here to mark, and
 *  they are named in the 数值核对 panel instead. */
const buildUnsafeMarks = (readings: UnsafeReading[]): Map<string, string> => {
  const marks = new Map<string, string>();
  for (const reading of readings) {
    if (reading.disposition !== 'flagged') continue;
    const detail = unsafeReadingDetail(reading);
    for (const key of reading.keys) marks.set(key, detail);
  }
  return marks;
};

/** Every cell the parse took off this report, named where this platform
 *  has a name for it. Bookkeeping keys are excluded by the same set the
 *  reparse gate uses, so 「what was read」 means the same thing here as
 *  it does there. */
const buildTraceRows = (
  fields: Record<string, string> | undefined,
  marks: Map<string, string>,
): TraceRow[] => {
  if (!fields) return [];
  const rows: TraceRow[] = [];
  for (const [key, rawValue] of Object.entries(fields)) {
    if (PIPELINE_BOOKKEEPING_FIELDS.has(key)) continue;
    const value = String(rawValue ?? '').trim();
    if (!value) continue;
    const label = traceLabelFor(key);
    const mark = marks.get(key);
    rows.push({
      key,
      label: label ?? key,
      value: traceValueFor(key, value),
      named: label !== undefined,
      ...(mark ? { mark } : {}),
    });
  }
  return rows;
};

/**
 * One row of 来源追溯.
 *
 * THE MARK IS UNDER THE VALUE AND NOT INSIDE IT. The value column is
 * the cell as the report printed it, and a reader running down that
 * column is comparing it against paper; splicing this platform's own
 * sentence into the same string would make the two indistinguishable.
 * It is prefixed 本平台标注 for the same reason and set in caption
 * weight, so nothing about it can be read as something the laboratory
 * wrote.
 */
const TraceRowView = ({ row }: { row: TraceRow }) => (
  <View style={styles.fieldRow}>
    <Text style={styles.fieldLabel}>{row.label}</Text>
    {row.mark ? (
      <View style={styles.fieldValueColumn}>
        <Text style={styles.fieldValueStacked}>{row.value}</Text>
        <Text style={styles.fieldMark}>{`本平台标注：${row.mark}`}</Text>
      </View>
    ) : (
      <Text style={styles.fieldValue}>{row.value}</Text>
    )}
  </View>
);

const formatKindLabel = (kind: string) => {
  switch (kind) {
    case 'genetic':
      return '基因报告';
    case 'mri':
      return 'MRI / 影像';
    case 'lab':
      return '实验室';
    case 'monitoring':
      return '监测资料';
    case 'strength':
      return '肌力评估';
    default:
      return '综合报告';
  }
};

export default function ReportDetailScreen() {
  const router = useRouter();
  const { confirm, notify } = useAppDialog();
  const params = useLocalSearchParams();
  const documentId = useMemo(() => {
    const raw = params.documentId;
    return Array.isArray(raw) ? raw[0] : raw;
  }, [params.documentId]);

  const poller = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  // OCR hand-correction modal: whitelisted fields only (mirrors the
  // backend schema). Draft is keyed by field, prefilled from the
  // current payload when the modal opens.
  const [correctVisible, setCorrectVisible] = useState(false);
  const [correctDraft, setCorrectDraft] = useState<Record<string, string>>({});
  const [correctBusy, setCorrectBusy] = useState(false);
  const [correctError, setCorrectError] = useState<string | null>(null);
  const [payload, setPayload] = useState<OcrPayload | null>(null);
  const [docStatus, setDocStatus] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  // Recoverable failures render inline (three-way feedback split);
  // the summary one keeps a retry since regeneration is idempotent.
  const [summaryNotice, setSummaryNotice] = useState<string | null>(null);
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [summary, setSummary] = useState<string>('');
  const [askVisible, setAskVisible] = useState(false);
  const [bodyView, setBodyView] = useState<BodyView>('front');
  // The poll gave up (10 min) without the parse settling — the job is
  // almost certainly lost; offer「重新识别」instead of spinning forever.
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [isReparsing, setIsReparsing] = useState(false);
  const [reparseNotice, setReparseNotice] = useState<string | null>(null);
  // Bumping this restarts the load+poll effect (used after a reparse).
  const [pollNonce, setPollNonce] = useState(0);
  // AI consent drives interpretation automation: 'granted' →
  // summaries generate themselves once the parse settles; 'none' →
  // an unlock card explains what turning it on buys.
  const [aiConsent, setAiConsent] = useState<'unknown' | 'granted' | 'none'>('unknown');
  const [isGrantingConsent, setIsGrantingConsent] = useState(false);
  // One auto-trigger per screen visit: a failed generation degrades
  // to the manual button instead of retry-looping LLM calls.
  const autoSummaryTriggeredRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getMyConsent()
      .then((consent) => {
        if (!cancelled) setAiConsent(consent.level === 'none' ? 'none' : 'granted');
      })
      .catch(() => {
        // 404 (no profile) or transient failure: treat as not granted
        // — the unlock card's grant call will surface a real error.
        if (!cancelled) setAiConsent('none');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = async (id: string) => {
    const res = await getPatientDocumentOcr(id);
    const next = res.ocrPayload ?? null;
    setPayload(next);
    setDocStatus(res.status ?? null);
    const maybeSummary = next?.fields?.aiSummary;
    setSummary(typeof maybeSummary === 'string' ? maybeSummary : '');
    return res;
  };

  // "Still parsing" = the document ROW says processing (async
  // pipeline keeps the payload null while the job runs). The old
  // payload-based analysisStatus check stays as a fallback for
  // pre-async rows whose payload carried the transient state.
  const isDocumentProcessing = (status: string | null | undefined, ocrPayload: OcrPayload | null) =>
    status === 'processing' || isProcessing(ocrPayload);

  useEffect(() => {
    if (!documentId) {
      setIsLoading(false);
      setErrorMessage('缺少 documentId');
      return;
    }

    let cancelled = false;

    const start = async () => {
      try {
        setIsLoading(true);
        setErrorMessage(null);
        setPollTimedOut(false);
        const first = await load(documentId);
        if (cancelled) return;

        const startedAt = Date.now();
        const tick = async () => {
          try {
            const refreshed = await load(documentId);
            if (!isDocumentProcessing(refreshed.status, refreshed.ocrPayload ?? null)) {
              poller.current = null;
              return;
            }
          } catch {
            // retry on next poll
          }

          if (Date.now() - startedAt > 10 * 60 * 1000) {
            poller.current = null;
            setPollTimedOut(true);
            return;
          }

          poller.current = setTimeout(tick, 2000);
        };

        if (isDocumentProcessing(first.status, first.ocrPayload ?? null)) {
          poller.current = setTimeout(tick, 1200);
        }
      } catch (error) {
        const message = error instanceof ApiError ? error.message : '无法获取报告详情';
        setErrorMessage(message);
        // EVERYTHING THE LAST READ PRODUCED GOES WITH IT.
        //
        // `payload` was already dropped here; `docStatus` was not, and
        // that is what stranded the screen. This effect re-runs after
        // a reparse, and it clears `pollTimedOut` on the way in — so a
        // failed read left the row's LAST status on the page with
        // nothing watching it and no way back: the chip still read
        // 识别中, the spinner still turned, and the line under it still
        // promised 「识别完成后这里会自动更新」 while no poll was armed
        // and the timeout that had offered 重新识别 a moment earlier
        // had been reset. Every one of those is drawn from a status
        // this screen no longer has any evidence for. A read that
        // failed tells us nothing about the row, and the honest render
        // of nothing is nothing — the states below all fall through to
        // the fetch-failure branch, which is the only thing that
        // actually happened.
        setPayload(null);
        setDocStatus(null);
        setSummary('');
      } finally {
        setIsLoading(false);
      }
    };

    start();

    return () => {
      cancelled = true;
      if (poller.current) {
        clearTimeout(poller.current);
        poller.current = null;
      }
    };
  }, [documentId, pollNonce]);

  /** 重新识别: flip the row back to processing server-side, then
   *  restart the whole load+poll cycle via the nonce. */
  const handleReparse = async () => {
    if (!documentId || isReparsing) return;
    setIsReparsing(true);
    setReparseNotice(null);
    try {
      await reparsePatientDocument(documentId);
      setPayload(null);
      setDocStatus('processing');
      setPollTimedOut(false);
      setPollNonce((n) => n + 1);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '重新识别失败，请稍后重试';
      setReparseNotice(message);
      // A refusal is nearly always the server saying the job is in
      // fact still running — its staleness test reads the upload
      // time, ours is ten minutes of watching, and at the boundary
      // they disagree. The screen had stopped polling by then, so the
      // patient was left holding 「请稍候」 on a page that would never
      // change again. Re-read the row and resume tracking it: the
      // wait is only honest if something is still watching.
      setPollNonce((n) => n + 1);
    } finally {
      setIsReparsing(false);
    }
  };

  const fields = payload?.fields ?? undefined;
  // Prefer the document-row status: under the async pipeline the
  // payload (and its analysisStatus) is null for the entire parse.
  //
  // Null when neither source has one, and NOT the string 'unknown'.
  // That literal was the chip's own text — `formatStatusLabel` has no
  // case for it and falls through to printing what it was handed — so
  // the two states where the screen holds no status painted an English
  // enum into a Chinese chip: the first frame before the fetch
  // resolves, and every frame after a fetch that failed. The chip is a
  // claim about the row, so a screen that has not read the row draws
  // no chip at all.
  const status = docStatus ?? getAnalysisStatus(payload) ?? null;
  const statusTone = statusChipTone(status ?? '');
  const reportKind = inferReportKind(payload);
  const mriInference = useMemo(() => inferMriBodyMap(payload), [payload]);
  const activeRegions = mriInference.regions;
  const activeSummary = mriInference.findings;
  const relevantSystemPanels = useMemo(() => {
    if (!payload) return [];
    const classifiedType = pickField(fields, [
      'classifiedType',
      'classified_type',
      'reportType',
      'report_type',
    ]);
    const reportTime = pickField(fields, ['reportTime', 'report_time']);
    // The row this screen is showing, handed over whole: the id and
    // the status ride along because `buildReportInsights` asks which
    // of its documents is the genetic evidence and will not guess at
    // either. Here the list is one document long, so the answer is
    // never in doubt — but only 检查结果 is read out of the result
    // below, and the values that question governs are not on this
    // path at all.
    const insights = buildReportInsights([
      {
        id: documentId ?? '',
        status: docStatus,
        documentType: classifiedType ?? 'other',
        uploadedAt: reportTime ?? new Date().toISOString(),
        ocrPayload: payload,
      },
    ]);

    return insights.systemPanels.filter(
      (panel) => panel.metrics.length > 0 || panel.coverage.length > 0,
    );
  }, [documentId, docStatus, fields, payload]);

  const openCorrection = () => {
    const current: Record<string, string> = {};
    for (const field of CORRECTABLE_OCR_FIELDS) {
      current[field.key] = fields ? (pickField(fields, field.read) ?? '') : '';
    }
    setCorrectDraft(current);
    setCorrectError(null);
    setCorrectVisible(true);
  };

  const submitCorrection = async () => {
    if (correctBusy) return;
    // Send only fields the user actually changed/filled — the backend
    // rejects an empty patch, and untouched keys shouldn't get a
    // manual-edit stamp.
    const changed: Record<string, string> = {};
    // Emptying a box that held a value is a real edit, and it is one
    // this sheet cannot carry out. The PATCH merges what it is sent
    // into the stored fields, so a blank writes a blank under the
    // canonical key — while every reader, this screen included, falls
    // through an empty value to the next spelling of the same key. A
    // value the parse wrote under one of those other spellings would
    // be back on screen the moment the sheet closed.
    //
    // So clearing is refused, and refused the same way whichever
    // boxes were touched: on its own it used to be reported as 「没有
    // 需要保存的修改」, which told the patient they had changed
    // nothing when they had; alongside another edit it went the other
    // way, saving the other edit and dropping the blank without a
    // word, which told them the clear had worked. The save is held
    // back entirely so what the patient typed is still in front of
    // them, and the fields are named so they know which box to put
    // back.
    const blanked: string[] = [];
    for (const field of CORRECTABLE_OCR_FIELDS) {
      const next = (correctDraft[field.key] ?? '').trim();
      const prev = fields ? (pickField(fields, field.read) ?? '') : '';
      if (next && next !== prev) changed[field.key] = next;
      if (!next && prev) blanked.push(field.label);
    }
    if (blanked.length > 0) {
      setCorrectError(
        `${blanked.join('、')}不能清空。改成正确的值就能保存；如果这份报告本身不对，可以删掉它重新上传。`,
      );
      return;
    }
    if (Object.keys(changed).length === 0) {
      setCorrectError('没有需要保存的修改。');
      return;
    }
    setCorrectBusy(true);
    setCorrectError(null);
    try {
      const result = await patchPatientDocumentOcr(documentId, changed);
      const nextFields = result.ocr_payload?.fields;
      if (nextFields) {
        setPayload((prevPayload) => ({ ...(prevPayload ?? {}), fields: nextFields }));
      }
      setCorrectVisible(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // The button that opened this sheet is drawn only for rows the
        // server accepts corrections on, so a 409 means the row moved
        // underneath us — a reparse started while the sheet sat open.
        // 「请先完成识别」 told the patient to finish something they
        // have no control over, and was simply wrong if that reparse
        // had already failed. Re-read the row instead: whatever it
        // says now, the screen behind this sheet redraws with the
        // control that matches it.
        setCorrectError('这份报告刚刚重新开始识别，现在存不进去。识别结束后再回到这里修正。');
        setPollNonce((n) => n + 1);
      } else {
        setCorrectError(error instanceof Error ? error.message : '保存失败，请稍后重试。');
      }
    } finally {
      setCorrectBusy(false);
    }
  };

  // Both empty states below depend on the parse being *over*. See the
  // comment at the 提示 row.
  const parseInProgress = isDocumentProcessing(docStatus, payload) && !pollTimedOut;
  const parseFailed = status === 'parse_failed';
  // A row the pipeline has not touched. Reachable whenever OCR is
  // switched off, and for rows written before the async pipeline. It
  // had no branch anywhere in this chain, so it read as 「暂无识别出的
  // 关键指标」 — a conclusion about the report's contents drawn from a
  // parse that never ran.
  //
  // The missing payload is the whole of the test: an `uploaded` row
  // that carries one has been parsed, and 「还没有识别过」 would be
  // the opposite error — denying a parse that happened. Those rows
  // fall through to the last branch, which claims nothing about
  // whether anything ran.
  const notYetParsed = docStatus === 'uploaded' && payload === null;
  // `isLoading` and `errorMessage` come first, and they are the whole
  // point of this chain. The parse-state branches below were correct
  // but only reachable once the document had actually arrived;
  // before that — and after a failed fetch — `payload` is null, so every
  // branch fell through to 「暂无识别出的关键指标」. The screen was
  // telling the patient their report contained nothing recognisable
  // while it was still loading it, and again when it had failed to load
  // it at all. Neither is a statement about the report.
  const emptyHighlightText = isLoading
    ? '正在载入'
    : errorMessage
      ? '暂时读不到这份报告'
      : parseInProgress
        ? '正在识别，稍等一下'
        : parseFailed
          ? '这份没能识别出来'
          : notYetParsed
            ? '还没有识别过'
            : '暂无识别出的关键指标';
  const emptySectionText = isLoading
    ? '正在载入这份报告。'
    : errorMessage
      ? '这份报告暂时读取失败，请重试；这不代表报告里没有内容。'
      : parseInProgress
        ? '正在识别这份报告，完成后这里会显示检查结果。'
        : parseFailed
          ? '这份报告没能识别出来，可以重新识别或换一张更清晰的图。'
          : notYetParsed
            ? '这份报告还没有识别过，识别之后这里会显示检查结果。'
            : '这份报告暂无可归入检查结果的识别指标。';
  // The 识别出的关键信息 section used to answer the same question with
  // its own sentence — 「暂无识别出的关键指标（或仍在识别中）。」 — and
  // that parenthetical is the drift made visible. It hedged across
  // states this screen can tell apart: a report still parsing had not
  // reached any conclusion yet, one that had failed had reached a
  // different one, and one never parsed had reached none at all. Same
  // chain as above, worded for this section.
  const emptyFieldsText = isLoading
    ? '正在载入这份报告。'
    : errorMessage
      ? '这份报告暂时读取失败，请重试。'
      : parseInProgress
        ? '正在识别这份报告，完成后这里会显示识别出的信息。'
        : parseFailed
          ? '这份报告没能识别出来，所以这里没有可显示的信息。'
          : notYetParsed
            ? '这份报告还没有识别过，所以这里还没有信息。'
            : '暂无识别出的关键指标。';

  const structuredSections = useMemo(() => {
    if (!fields) return [];
    const reportItems: Array<{ label: string; value?: string }> = [
      // Same rule as the chip: the row is filtered out below when its
      // value is empty, so no status means no row rather than a row
      // naming a status nobody read.
      { label: '解析状态', value: status ? formatStatusLabel(status) : undefined },
      {
        label: '识别类型',
        // `reportTypeLabel` is the pipeline's own Chinese name for the
        // type it concluded. Showing `infection_screening` instead was
        // showing the patient our enum.
        value:
          pickField(fields, ['reportTypeLabel', 'report_type_label']) ??
          pickField(fields, ['classifiedType', 'classified_type']),
      },
      {
        label: '识别置信度',
        value: formatConfidence(
          pickField(fields, ['classifiedTypeConfidence', 'classified_type_confidence']),
        ),
      },
      { label: '报告时间', value: pickField(fields, OCR_FIELD_KEYS.reportTime) },
      { label: '报告名称', value: pickField(fields, OCR_FIELD_KEYS.reportName) },
      { label: '医院', value: pickField(fields, ['facility']) },
      { label: '科室', value: pickField(fields, ['department']) },
      { label: '标本', value: pickField(fields, ['specimen']) },
      { label: '送检医生', value: pickField(fields, ['orderingDoctor', 'ordering_doctor']) },
      { label: '患者姓名', value: pickField(fields, ['patientName']) },
      { label: '性别', value: formatSexLabel(pickField(fields, ['patientSex'])) },
      { label: '年龄', value: pickField(fields, ['patientAge']) },
    ];

    const fshdItems: Array<{ label: string; value?: string }> = [
      { label: 'FSHD 分型', value: pickField(fields, OCR_FIELD_KEYS.diagnosisType) },
      { label: '单倍型', value: pickField(fields, OCR_FIELD_KEYS.haplotype) },
      {
        label: 'EcoRI',
        value: pickField(fields, [
          'ecoRIFragment',
          'ecoriFragmentKb',
          'ecori_fragment_kb',
          'EcoRI_kb',
          'ecoriFragment',
        ]),
      },
      { label: 'D4Z4 重复', value: pickField(fields, OCR_FIELD_KEYS.d4z4Repeats) },
      { label: '甲基化值', value: pickField(fields, OCR_FIELD_KEYS.methylationValue) },
      { label: 'MRI 印象', value: pickField(fields, ['reportImpression', 'report_impression']) },
      {
        label: '腹部超声提示',
        value: pickField(fields, [
          'abdominalUltrasoundImpression',
          'abdominal_ultrasound_impression',
        ]),
      },
    ];

    return [
      { title: '报告信息', items: reportItems.filter((item) => item.value) },
      { title: 'FSHD 关键结果', items: fshdItems.filter((item) => item.value) },
    ].filter((section) => section.items.length > 0);
  }, [fields, status]);

  const reparseOffer = resolveReparseOffer(docStatus, payload, pollTimedOut);

  const highlightItems = useMemo(() => {
    const systemHighlights = relevantSystemPanels.flatMap((panel) =>
      getSystemPanelHeroMetrics(panel),
    );
    if (systemHighlights.length > 0) {
      return systemHighlights.slice(0, 4);
    }
    return structuredSections.flatMap((section) => section.items).slice(0, 4);
  }, [relevantSystemPanels, structuredSections]);

  /** What the read-path guard did to this payload. See
   *  `UnsafeReading` — the array is on the payload's TOP level, beside
   *  `fields` and deliberately not inside it. */
  const unsafeReadings = useMemo(() => readUnsafeReadings(payload), [payload]);
  const unsafeNotice = useMemo(() => readUnsafeNotice(payload), [payload]);
  const withheldReadings = useMemo(
    () => unsafeReadings.filter((item) => item.disposition === 'withheld'),
    [unsafeReadings],
  );
  const flaggedReadings = useMemo(
    () => unsafeReadings.filter((item) => item.disposition === 'flagged'),
    [unsafeReadings],
  );
  const unsafeMarks = useMemo(() => buildUnsafeMarks(unsafeReadings), [unsafeReadings]);

  /** Every cell the parse read, for the cross-check. See
   *  `TRACE_FIELD_LABELS`. */
  const traceRows = useMemo(() => buildTraceRows(fields, unsafeMarks), [fields, unsafeMarks]);
  const namedTraceRows = useMemo(() => traceRows.filter((row) => row.named), [traceRows]);
  const unnamedTraceRows = useMemo(() => traceRows.filter((row) => !row.named), [traceRows]);

  /**
   * The page's own words, as text.
   *
   * THE ONE THING ON THIS PANEL THAT IS NOT THIS PLATFORM'S — which is
   * why it keeps a mono well and a length cap and gets no labelling
   * pass: rewriting a word here would defeat the only purpose it has,
   * which is to show a reader what the parser was reading when it
   * missed a cell.
   */
  const extractedText = useMemo(() => {
    if (!payload) return '';
    const obj = payload as DebugPayload;
    const raw = obj.extractedText ?? obj.extracted_text ?? '';
    return typeof raw === 'string' ? raw.trim() : '';
  }, [payload]);

  const ocrTextShown = extractedText.slice(0, OCR_TEXT_LIMIT);
  const ocrTextTruncated = extractedText.length > OCR_TEXT_LIMIT;

  const onGenerateSummary = async () => {
    if (!documentId) return;
    try {
      setSummaryLoading(true);
      setSummaryNotice(null);
      const res = await generatePatientDocumentSummary(documentId);
      setSummary(res.summary);
      setPayload((prev) => {
        if (!prev) return prev;
        const nextFields = { ...(prev.fields ?? {}), aiSummary: res.summary };
        return { ...prev, fields: nextFields };
      });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '生成 AI 总结失败';
      setSummaryNotice(message);
    } finally {
      setSummaryLoading(false);
    }
  };

  // Interpretation automation: once the parse settles and AI consent
  // is granted, the summary generates itself — upload → recognize →
  // interpret with zero manual steps. The DECISION lives in
  // shouldAutoSummarize (pure, unit-tested — this path spends LLM
  // calls unattended, so every guard is load-bearing); the effect
  // only owns the timing. A failure degrades to the manual button
  // (summaryNotice already carries the retry).
  useEffect(() => {
    if (!documentId) return;
    const fire = shouldAutoSummarize({
      aiConsent,
      docStatus,
      hasPayload: payload !== null,
      isProcessing: isDocumentProcessing(docStatus, payload),
      hasSummary: Boolean(summary),
      summaryLoading,
      alreadyTriggered: autoSummaryTriggeredRef.current,
    });
    if (!fire) return;
    autoSummaryTriggeredRef.current = true;
    void onGenerateSummary();
    // onGenerateSummary is recreated per render but idempotent, and the
    // ref guard above already caps it at one firing per document; the
    // decision function holds the real dependency story. Nothing in the
    // handler can go stale either — it reads stable setters, module
    // imports, and `documentId`, which is a dependency already. Adding
    // the function itself would re-run this on every render.
  }, [aiConsent, payload, docStatus, summary, summaryLoading, documentId]);

  /** Unlock card: grant both required flags in one tap, then let the
   *  auto-trigger effect above take over and generate the summary. */
  const handleGrantAndSummarize = async () => {
    if (isGrantingConsent) return;
    setIsGrantingConsent(true);
    setSummaryNotice(null);
    try {
      await updateMyConsent({ personal: true, thirdParty: true });
      // Same rule as every consent surface: a change starts a new QnA
      // history epoch (see lib/consent-epoch.ts).
      await bumpConsentEpoch();
      setAiConsent('granted');
    } catch (error) {
      const detail =
        error instanceof ApiError && error.status === 404
          ? '请先在「我的 → 编辑档案」完成基础档案，再开启 AI 授权。'
          : error instanceof ApiError
            ? error.message
            : '授权失败，请稍后重试';
      setSummaryNotice(detail);
    } finally {
      setIsGrantingConsent(false);
    }
  };

  const runDelete = async () => {
    if (!documentId) return;

    try {
      setDeleteLoading(true);
      const result = await deletePatientDocument(documentId);
      // Not discarded. A 200 means the row is gone; whether the stored
      // scan is gone is a separate answer, and saying「这份报告已移除」
      // over a failed cleanup is the app telling a patient their
      // genetic report was erased when it was not. See
      // lib/report-delete.ts for the wording of each case.
      const outcome = describeReportDelete(result.storageCleanupStatus);
      // The banner lives in the root provider, so it survives this
      // navigation — the patient lands on the list and still sees the
      // confirmation, instead of arriving at a silently shorter list.
      // That matters more for the unhappy branch than the happy one:
      // the row is gone either way, so there is nothing left on this
      // screen to hold the message.
      notify({ title: outcome.title, message: outcome.message, tone: outcome.tone });
      router.replace('/p-report_management');
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '删除报告失败';
      setDeleteNotice(`删除失败：${message}`);
    } finally {
      setDeleteLoading(false);
    }
  };

  /**
   * The most dangerous call site in this screen. `Alert.alert` is a
   * no-op on web, so on the platform patients actually use, the
   * "confirm" step did not exist: one press on 删除 and the report was
   * gone, unrecoverably, with nothing shown in between.
   */
  const onDelete = async () => {
    if (deleteLoading) return;
    const confirmed = await confirm({
      title: '删除报告',
      message: '删除后将从病程、临床护照和汇总视图中移除，且无法恢复。',
      confirmLabel: '删除',
      destructive: true,
    });
    if (!confirmed) return;
    await runDelete();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* The "REPORT READER" eyebrow said nothing the title didn't.
          Back + home now come from the shared header: this screen is
          commonly reached three deep (档案 → 报告管理 → 报告详情). */}
      <ScreenHeader title="报告详情" fallbackHref="/p-report_management" />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroTopRow}>
            {/* Kind is a real eyebrow — it isn't in the report name. */}
            <Text style={styles.kindEyebrow}>{formatKindLabel(reportKind)}</Text>
            {status ? (
              <View style={[styles.statusChip, statusTone.chip]}>
                <Text style={[styles.statusChipText, statusTone.text]}>
                  {formatStatusLabel(status)}
                </Text>
              </View>
            ) : null}
          </View>
          {/* The report's own name, then the classifier's label, then
              a generic. What was here before was 「报告关键指标视图」 —
              a description of the screen, not of the report — over a
              line reading 「documentId: 0ccb8d23-2c53-…」. The uuid is
              a database key; it tells the patient nothing and it is the
              second-largest thing on the card. It lives in 来源追溯
              below, where a support conversation can find it. */}
          <Text style={styles.heroTitle}>
            {pickField(fields, ['reportName', 'report_name']) ||
              pickField(fields, ['reportTypeLabel', 'report_type_label']) ||
              '检查报告'}
          </Text>
          <Text style={styles.heroDescription}>
            {[pickField(fields, ['facility']), pickField(fields, ['reportTime', 'report_time'])]
              .filter(Boolean)
              .join(' · ') || '暂无报告日期'}
            {isDocumentProcessing(docStatus, payload) && !pollTimedOut ? ' · 识别进行中' : ''}
          </Text>

          {isDocumentProcessing(docStatus, payload) && !pollTimedOut ? (
            <View style={styles.processingRow}>
              <ActivityIndicator size="small" color={COLOR.accent} />
              <Text style={styles.processingText}>
                正在识别这份报告，通常需要 1-2 分钟。可以先离开本页，识别完成后这里会自动更新。
              </Text>
            </View>
          ) : null}

          {/* Drawn for the rows the server will re-run, minus the ones
              whose payload is still holding values — see
              resolveReparseOffer, which decides the sentence and the
              button together because they are one claim. */}
          {reparseOffer ? (
            <View style={styles.noticeBlock}>
              <InlineNotice
                message={reparseOffer.message}
                onRetry={() => void handleReparse()}
                retryLabel={reparseOffer.retryLabel}
                retryDisabled={isReparsing}
              />
            </View>
          ) : null}
          {reparseNotice ? (
            <View style={styles.noticeBlock}>
              <InlineNotice message={reparseNotice} />
            </View>
          ) : null}

          <View style={styles.highlightGrid}>
            {highlightItems.length > 0 ? (
              highlightItems.map((item) => (
                <View key={item.label} style={styles.highlightItem}>
                  <Text style={styles.highlightLabel}>{item.label}</Text>
                  <Text style={styles.highlightValue}>{item.value}</Text>
                </View>
              ))
            ) : (
              <View style={styles.highlightItem}>
                <Text style={styles.highlightLabel}>提示</Text>
                {/* 「暂无」 is a conclusion, and it is only available
                    once the parse has finished. Said while the chip
                    beside it reads 识别中, it is the screen
                    contradicting itself — and it is the reading a
                    patient acts on, because it is the sentence in
                    words. */}
                <Text style={styles.highlightValue}>{emptyHighlightText}</Text>
              </View>
            )}
          </View>
        </View>

        {/* ══════════════════════════════════════════════════════════
            数值核对 — DIRECTLY UNDER THE VALUES IT IS ABOUT.

            Placed here and not further down because the grid above and
            the panels below are where a withheld reading is INVISIBLE:
            the cell was deleted, so those surfaces simply have one row
            fewer and nothing about them says a row is missing. A
            patient holding the paper report finds a line on the paper
            with no line here, and the only conclusion available to
            them is that this platform could not read it.

            The notice is the server's own sentence, composed from the
            dispositions actually present on THIS payload (see
            `buildUnsafeReadingNotice`) — a payload that only marked
            says only that it marked. The two lists say WHICH reading,
            which is the half the sentence cannot carry. The numbers
            are not here and must not be: a withheld cell was deleted,
            and handing it back under a second key would make the
            deletion theatre. ═══════════════════════════════════════ */}
        {unsafeReadings.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>数值核对</Text>
            {unsafeNotice ? <Text style={styles.smallText}>{unsafeNotice}</Text> : null}
            {withheldReadings.length > 0 ? (
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldGroupTitle}>这些数值本平台已不再显示</Text>
                <View style={styles.fieldTable}>
                  {withheldReadings.map((reading) => (
                    <View key={`withheld-${reading.analyte}`} style={styles.fieldRow}>
                      <Text style={styles.fieldLabel}>{unsafeReadingLabel(reading)}</Text>
                      <Text style={styles.fieldNote}>{unsafeReadingDetail(reading)}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
            {flaggedReadings.length > 0 ? (
              <View style={styles.fieldGroup}>
                {/* 仍按报告原样显示 is the load-bearing half: these
                    values ARE on the screen above, unchanged. The
                    heading has to say so, or the panel reads as a
                    second withholding list. */}
                <Text style={styles.fieldGroupTitle}>
                  这些数值仍按报告原样显示，请对着报告原件留意
                </Text>
                <View style={styles.fieldTable}>
                  {flaggedReadings.map((reading) => (
                    <View key={`flagged-${reading.analyte}`} style={styles.fieldRow}>
                      <Text style={styles.fieldLabel}>{unsafeReadingLabel(reading)}</Text>
                      <Text style={styles.fieldNote}>{unsafeReadingDetail(reading)}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
          </View>
        ) : null}

        {reportKind === 'mri' &&
          (Object.keys(activeRegions).length > 0 || activeSummary.length > 0) && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>MRI 受累示意图</Text>
                <SegmentedControl
                  segments={[
                    { key: 'front', label: '正面' },
                    { key: 'back', label: '背面' },
                  ]}
                  value={bodyView}
                  onChange={(key) => setBodyView(key as 'front' | 'back')}
                  accessibilityLabel="受累分布视角"
                />
              </View>

              <HumanBodyFigure
                view={bodyView}
                regions={activeRegions}
                mode="mri"
                subtitle="根据 MRI 报告正文和识别出的关键指标推断受累区域，重点突出分布与侧别信息。"
              />

              <View style={styles.tagWrap}>
                {activeSummary.length > 0 ? (
                  activeSummary.map((item) => (
                    <View key={item} style={styles.summaryTag}>
                      <Text style={styles.summaryTagText}>{item}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.smallText}>当前报告尚无可直接映射的人体区域。</Text>
                )}
              </View>
            </View>
          )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>识别出的关键信息</Text>
          {docStatus === 'parsed' || docStatus === 'needs_review' ? (
            <Button
              label="识别有误？手动修正"
              icon="pen-to-square"
              variant="tinted"
              compact
              onPress={openCorrection}
            />
          ) : null}
          {structuredSections.length === 0 ? (
            <Text style={styles.smallText}>{emptyFieldsText}</Text>
          ) : (
            // A label column and a value column, one hairline per row:
            // the field list is a table, so it is set as one.
            structuredSections.map((section) => (
              <View key={section.title} style={styles.fieldGroup}>
                <Text style={styles.fieldGroupTitle}>{section.title}</Text>
                <View style={styles.fieldTable}>
                  {section.items.map((item) => (
                    <View key={`${section.title}-${item.label}`} style={styles.fieldRow}>
                      <Text style={styles.fieldLabel}>{item.label}</Text>
                      <Text style={styles.fieldValue}>{item.value}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>检查结果</Text>
          <SystemMonitoringPanels panels={relevantSystemPanels} emptyText={emptySectionText} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>AI 总结</Text>
          {summary ? (
            <>
              <AnswerText style={styles.summaryText}>{summary}</AnswerText>
              <Text style={styles.smallText}>仅供参考，仍需结合医生判断。</Text>
              {/* Asking about the report no longer means leaving it.
                  The drawer sends only the document id; the server
                  checks ownership and routes the planner at
                  get_my_reports, so the report's actual contents still
                  reach the model through the redacted retriever path
                  rather than being pasted into a prefilled sentence. */}
              <Button
                label="继续问 AI 这份报告"
                icon="comment-dots"
                variant="prominent"
                onPress={() => setAskVisible(true)}
              />
            </>
          ) : aiConsent === 'none' && !isDocumentProcessing(docStatus, payload) ? (
            <>
              <Text style={styles.smallText}>
                开启 AI 授权后，每份识别完成的报告都会自动生成通俗解读，无需手动操作。AI
                会引用你档案与报告中已脱敏的内容，可随时在「隐私设置」撤回。
              </Text>
              {summaryNotice ? (
                <View style={styles.actionBlock}>
                  <InlineNotice message={summaryNotice} />
                </View>
              ) : null}
              <View style={styles.actionBlock}>
                <Button
                  label="开启 AI 授权，自动解读这份报告"
                  icon="check"
                  variant="prominent"
                  fullWidth
                  busy={isGrantingConsent}
                  onPress={() => void handleGrantAndSummarize()}
                />
              </View>
            </>
          ) : (
            <>
              <Text style={styles.smallText}>
                {aiConsent === 'granted' && !isDocumentProcessing(docStatus, payload)
                  ? '识别完成后会自动生成解读；也可以手动重新生成。'
                  : '当前报告暂无 AI 总结，可在识别完成后按需生成并缓存。'}
              </Text>
              {summaryNotice ? (
                <View style={styles.actionBlock}>
                  <InlineNotice
                    message={summaryNotice}
                    onRetry={() => void onGenerateSummary()}
                    retryLabel="重新生成"
                    retryDisabled={summaryLoading}
                  />
                </View>
              ) : null}
              <View style={styles.actionBlock}>
                {/* This branch is the no-summary-yet state of the AI 总结
                    section, and this is its generate button. It had been
                    left labelled 删除这份报告 with a trash icon in the
                    alert colour while calling onGenerateSummary — a
                    destructive-looking control wired to a harmless one,
                    which is the worse direction of that mistake only
                    because the harmless direction would have deleted a
                    report. Nothing on this screen deletes; deletion
                    lives on 报告管理. */}
                <Button
                  label="生成 AI 解读"
                  icon="wand-magic-sparkles"
                  variant="prominent"
                  busy={summaryLoading}
                  disabled={isDocumentProcessing(docStatus, payload)}
                  accessibilityHint="根据这份报告的识别结果生成通俗解读"
                  onPress={onGenerateSummary}
                />
              </View>
            </>
          )}
        </View>

        {/* 来源追溯 — the cross-check, not a dump. See TRACE_FIELD_LABELS. */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>来源追溯</Text>
          <Text style={styles.smallText}>
            这里逐条列出本平台从这份报告里读到的每一格，以及 OCR
            识别出的报告原文，方便你对着纸质报告一项一项核对。上面的卡片只挑了重点，这里是全部。
          </Text>
          <Button
            label={showRaw ? '收起核对清单' : '展开核对清单'}
            variant="plain"
            compact
            trailingIcon={showRaw ? 'chevron-up' : 'chevron-down'}
            onPress={() => setShowRaw((value) => !value)}
          />
          {showRaw ? (
            <>
              {traceRows.length === 0 ? (
                <Text style={styles.smallText}>本平台没有从这份报告里读出任何字段。</Text>
              ) : (
                <>
                  {namedTraceRows.length > 0 ? (
                    <View style={styles.fieldGroup}>
                      <Text style={styles.fieldGroupTitle}>本平台读到的字段</Text>
                      <View style={styles.fieldTable}>
                        {namedTraceRows.map((row) => (
                          <TraceRowView key={row.key} row={row} />
                        ))}
                      </View>
                    </View>
                  ) : null}
                  {/* Shown rather than hidden: this panel's job is to be
                      complete, and a cell dropped here is a cell the
                      reader cannot cross-check. The heading says whose
                      gap it is. */}
                  {unnamedTraceRows.length > 0 ? (
                    <View style={styles.fieldGroup}>
                      <Text style={styles.fieldGroupTitle}>
                        本平台还没有为这些字段起名（按原始字段名列出）
                      </Text>
                      <View style={styles.fieldTable}>
                        {unnamedTraceRows.map((row) => (
                          <TraceRowView key={row.key} row={row} />
                        ))}
                      </View>
                    </View>
                  ) : null}
                </>
              )}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldGroupTitle}>报告原文（OCR 识别文字）</Text>
                {ocrTextShown ? (
                  <>
                    <View style={styles.codeBlock}>
                      <Text style={styles.codeText}>{ocrTextShown}</Text>
                    </View>
                    {ocrTextTruncated ? (
                      <Text style={styles.smallText}>
                        {`原文较长，这里只显示前 ${OCR_TEXT_LIMIT} 个字。`}
                      </Text>
                    ) : null}
                  </>
                ) : (
                  <Text style={styles.smallText}>
                    这份报告没有可显示的 OCR 文字（可能是扫描质量的原因，或识别尚未完成）。
                  </Text>
                )}
              </View>
            </>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>删除报告</Text>
          <Text style={styles.smallText}>
            如果这份报告传错了、识别错了，或只是重复上传，可以直接删除。删除后护照和病程摘要会按剩余数据重新计算。
          </Text>
          {deleteNotice ? (
            <View style={styles.actionBlock}>
              <InlineNotice message={deleteNotice} />
            </View>
          ) : null}
          {/* The red-bordered card is gone; the destructive weight now
              sits on the button itself, where the action is. */}
          <Button
            label="删除这份报告"
            icon="trash-can"
            variant="destructive"
            fullWidth
            busy={deleteLoading}
            onPress={() => {
              void onDelete();
            }}
          />
        </View>

        {isLoading && (
          <View style={styles.inlineState}>
            <ActivityIndicator color={COLOR.accent} />
            <Text style={styles.smallText}>正在加载报告内容...</Text>
          </View>
        )}

        {/* A FAILED READ IS RECOVERABLE, AND NOW SAYS SO.
            This was a line of grey text and nothing else, which was
            survivable while the only way to reach it was opening the
            screen on a bad connection — leaving and coming back re-ran
            the fetch. It stopped being survivable once 重新识别's own
            failure path started routing through here on purpose: the
            offer that sent the patient here is drawn from the row's
            status, the read that would have returned that status is
            the thing that just failed, and the screen had no way left
            to ask again. Re-arming the same effect is all the retry
            does, which is why it is the load's nonce and not a second
            fetch path. */}
        {errorMessage && (
          <View style={styles.inlineState}>
            <InlineNotice
              message={errorMessage}
              onRetry={() => setPollNonce((n) => n + 1)}
              retryLabel="重新加载"
              retryDisabled={isLoading}
            />
          </View>
        )}
      </ScrollView>

      <Modal
        visible={correctVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setCorrectVisible(false)}
      >
        {/* Pressable defaults `accessible` to true, and an accessible
            view swallows its whole subtree into one element on iOS. The
            overlay is flex:1, so VoiceOver stopped at it and never
            reached a single one of the TextInputs below — the sheet
            whose entire purpose is correcting a misread lab value was
            not operable by screen reader. Both of these are structural
            (a scrim and a bubble-stopper), never controls. */}
        <Pressable
          style={styles.correctOverlay}
          accessible={false}
          onPress={() => setCorrectVisible(false)}
        >
          <Pressable style={styles.correctSheet} accessible={false} onPress={() => {}}>
            <View accessibilityViewIsModal>
              <Text style={styles.sectionTitle}>修正识别结果</Text>
              {/* Was 「保存后档案自动补全会优先使用你修正的值」. There is
                  no such precedence to promise: the autofill reads the
                  one document the API picks as this profile's genetic
                  evidence and fills only the profile fields still
                  blank, and the manual-edit stamp this save writes has
                  no reader anywhere. Whether the correction reaches the
                  profile therefore depends on which document that is —
                  which can change when a value is added here, since
                  what a document carries is one of the things the pick
                  weighs. This sheet knows what it writes and where; it
                  does not know how the profile ranks documents, so it
                  says neither. What is left is the list of fields it
                  can actually carry — the table above shows others,
                  EcoRI among them, which this sheet cannot touch. */}
              <Text style={styles.smallText}>
                填写有误或缺失的字段，保存后会写回这份报告的识别结果。可以修正的是报告名称、报告时间和下面四项基因结果。
              </Text>
              <ScrollView style={styles.correctList} keyboardShouldPersistTaps="handled">
                {CORRECTABLE_OCR_FIELDS.map((field) => (
                  <View key={field.key} style={styles.correctRow}>
                    <Text style={styles.correctLabel}>{field.label}</Text>
                    <TextInput
                      style={styles.correctInput}
                      value={correctDraft[field.key] ?? ''}
                      onChangeText={(value) =>
                        setCorrectDraft((prev) => ({ ...prev, [field.key]: value }))
                      }
                      placeholder={field.placeholder}
                      placeholderTextColor={COLOR.inkFaint}
                      accessibilityLabel={field.label}
                    />
                  </View>
                ))}
              </ScrollView>
              {correctError ? <Text style={styles.correctErrorText}>{correctError}</Text> : null}
              {/* Was two hand-rolled Touchables — the last consumers of
                  styles.button on a screen whose other six actions had
                  already moved. 保存修正 had no role, and while busy it
                  swapped its label for a spinner and became a control
                  with no name at all. */}
              <View style={styles.correctActions}>
                <Button label="取消" variant="tinted" onPress={() => setCorrectVisible(false)} />
                <Button
                  label="保存修正"
                  variant="prominent"
                  busy={correctBusy}
                  onPress={() => void submitCorrection()}
                />
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <AskAboutDrawer
        visible={askVisible}
        onClose={() => setAskVisible(false)}
        context={documentId ? { type: 'document', id: documentId } : undefined}
        contextLabel={pickField(fields, ['reportName', 'report_name']) || '这份检查报告'}
        suggestions={['这份报告说明什么', '有哪些数值需要注意', '下次门诊我该问什么']}
      />
    </SafeAreaView>
  );
}
