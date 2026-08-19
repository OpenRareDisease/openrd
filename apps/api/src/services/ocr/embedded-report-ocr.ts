import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ON_PREMISE_OCR, type OcrProvider, type OcrResult } from './ocr-provider.js';
import { flagKey, referenceKey } from '../../modules/ai-agents/security/allowlist.js';
import { AppError } from '../../utils/app-error.js';

const execFileAsync = promisify(execFile);

interface EmbeddedReportOcrConfig {
  pythonBin?: string;
  timeoutMs?: number;
  scriptPath?: string;
}

interface EmbeddedParsePayload {
  provider?: string;
  extracted_text?: string;
  analysis?: Record<string, unknown>;
  error?: string;
  detail?: string;
}

interface StructuredField {
  field_name?: unknown;
  field_value?: unknown;
  normalized_value?: unknown;
  unit?: unknown;
  source_text?: unknown;
  confidence?: unknown;
  side?: unknown;
  muscle_name?: unknown;
  body_region?: unknown;
  region?: unknown;
  /**
   * WHAT THE LABORATORY SAID ABOUT THE ROW, WHICH IS NOT THE NUMBER.
   *
   * The parser writes both of these onto a field the moment the row it
   * came off printed them (`_build_field` in
   * apps/report-manager/app/services/fshd_report_service.py), and until
   * now this bridge dropped both on the floor. See the flag paragraph
   * on the structured-field loop in `buildFields`.
   *
   * `reference_low` / `reference_high` are deliberately absent: they are
   * the parsed halves of `reference_range_raw`, this file has no reader
   * that computes on them, and `observations[].reference` already
   * carries them typed for the ones that do.
   */
  abnormal_flag?: unknown;
  reference_range_raw?: unknown;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const toStringField = (value: unknown) => {
  if (value === null || value === undefined) {
    return undefined;
  }
  const text = String(value).trim();
  return text || undefined;
};

const toCamelCase = (value: string) =>
  value.replace(/_([a-z])/g, (_, chr: string) => chr.toUpperCase());

const formatStructuredValue = (field: StructuredField) => {
  const normalized = field.normalized_value;
  const raw = field.field_value;
  const base =
    normalized !== null && normalized !== undefined && normalized !== ''
      ? String(normalized)
      : raw !== null && raw !== undefined
        ? String(raw)
        : '';
  const unit = toStringField(field.unit);
  if (!base) return undefined;
  if (unit && !base.includes(unit)) {
    // A UNIT THAT STARTS WITH A DIGIT NEEDS THE SPACE. Gluing was safe
    // while every unit that reached here began with a letter — 「693」 +
    // 「U/L」 — and a haematology panel prints 「10^9/L」, so a platelet
    // count of 249 rendered 「24910^9/L」: one string in which the first
    // five characters are two different numbers. The parser reads the
    // unit column off the row now (`_unit_from_row`), so this is the
    // first shape in which those units arrive at all.
    const separator = /^[0-9.]/.test(unit) ? ' ' : '';
    return `${base}${separator}${unit}`;
  }
  return base;
};

/**
 * A READING IS NOT A NUMBER. It is the number, the unit the laboratory
 * printed beside it, the laboratory's own verdict on it, and the
 * interval that verdict was reached against — and this type exists so
 * that no line in this file can pick up one of those four and put down
 * the other three.
 *
 * The defect it is a fix for was in this file and had four separate
 * spellings of one mistake: `creatineKinase = fields.ck` and
 * `myoglobin = fields.mb` copied the VALUE of a cell to a second key
 * and left `ckFlag` / `ckReference` behind under the first, the
 * cardio-respiratory projection wrote a bare panel float over a cell
 * the structured-field loop had already rendered WITH its unit, and
 * `canonicaliseGeneticCells` / the EcoRI block deleted an alias's value
 * while its siblings stayed. Measured on a synthetic 心肌酶谱: the
 * passport printed 「CK 693U/L」 with nothing beside it while the LDH on
 * the very same panel printed 「LDH 319U/L（偏高，参考区间 120-250）」 —
 * because `BLOOD_METRICS` is headed by `creatineKinase`, the twin this
 * file minted without siblings, and the picker took it.
 *
 * `flag` is the parser's own closed vocabulary (`_read_row_flag`:
 * `high`, `low`, `abnormal_unspecified`) and `reference` is the
 * interval EXACTLY as the row printed it — 「50-310」, 「<25」, 「>9」.
 * Both are optional and their absence is an ORDINARY STATE, not a
 * failure: a row the laboratory did not mark carries no flag, and a
 * great many rows print no interval at all. Nothing downstream may
 * read a missing interval as 「normal」; it means the report did not
 * say.
 */
interface ReportReading {
  readonly value: string;
  readonly flag?: string;
  readonly reference?: string;
}

/**
 * Every `fields` key one reading occupies — the value's own key and the
 * two siblings that belong to it.
 *
 * ONE SPELLING FOR THE SIBLINGS, and it is the camel form of whatever
 * spelling the value is under. `allowlist.ts` states the rule and
 * `siblingField` in profile.passport.ts is written against it: the
 * value is on disk under both the snake and the camel name because
 * both predate this pipeline, while the flag and the interval are new
 * and get one name each. So `uric_acid` and `uricAcid` share
 * `uricAcidFlag`, and there is no `uric_acidFlag` for a reader to have
 * to know about.
 */
const readingKeys = (key: string): readonly string[] => {
  const camel = toCamelCase(key);
  return [key, flagKey(camel), referenceKey(camel)];
};

/**
 * THE ONLY WAY A READING ENTERS `fields`.
 *
 * Every assignment of an analyte value in `buildFields` goes through
 * here, which is what makes 「the value moved without its flag」
 * unwritable rather than merely absent: to put the number somewhere you
 * have to be holding the whole `ReportReading`, and this writes all
 * three keys or none.
 */
const writeReading = (
  fields: Record<string, string>,
  readings: Map<string, ReportReading>,
  key: string,
  reading: ReportReading,
) => {
  const camel = toCamelCase(key);
  fields[key] = reading.value;
  if (reading.flag) {
    fields[flagKey(camel)] = reading.flag;
  }
  if (reading.reference) {
    fields[referenceKey(camel)] = reading.reference;
  }
  readings.set(key, reading);
};

/** The whole reading currently stored under `key`, or null when no
 *  value is. Used by the two blocks that RENAME a cell, so that a
 *  rename carries the flag and the interval rather than orphaning
 *  them under the name being retired. */
const takeReading = (fields: Record<string, string>, key: string): ReportReading | null => {
  const value = fields[key];
  if (!value) return null;
  const camel = toCamelCase(key);
  const flag = fields[flagKey(camel)];
  const reference = fields[referenceKey(camel)];
  return { value, ...(flag ? { flag } : {}), ...(reference ? { reference } : {}) };
};

/** Retire a spelling completely — value and both siblings. A `delete`
 *  of the value alone is how the flag and the interval came to outlive
 *  the number they describe. */
const deleteReading = (fields: Record<string, string>, key: string) => {
  for (const spelling of readingKeys(key)) {
    delete fields[spelling];
  }
};

/**
 * The EcoRI fragment carries its unit, and carries it once.
 *
 * `genetic_summary.ecori_fragment_kb` is a bare float — kb is in the
 * key's name, not in the value — and this bridge is the only place the
 * unit is ever attached to it. Idempotent because the same value can
 * arrive already spelled with it: the structured field for the same cell
 * is rendered by `formatStructuredValue` from the parser's own
 * `unit: "kb"`, and a payload written by an older shape of this file and
 * replayed through it must not come out 「18kbkb」.
 */
const withKbUnit = (value: string) => (/kb\s*$/i.test(value) ? value : `${value}kb`);

/**
 * THE OTHER CELLS THIS BRIDGE USED TO MINT TWICE, and the same fix
 * the EcoRI fragment got below: one cell on the report is one key in
 * the payload, and the key is the one every reader's alias list is
 * headed by.
 *
 * `canonical` is `GENETIC_FIELD_KEYS.<group>[0]` — checked against both
 * copies of that table, apps/api/src/modules/patient-profile/
 * genetic-evidence.ts and apps/mobile/lib/genetic-evidence.ts, and
 * against `OCR_FIELD_KEYS` in the app's report-detail screen. It is
 * also the name `EDITABLE_OCR_FIELDS` in profile.schema.ts accepts, so
 * a patient's hand-correction now lands ON this cell rather than beside
 * it: `patchDocumentOcrFields` spreads the patch over the stored
 * `fields`, so a correction to `methylationValue` used to leave the
 * OCR's `methylation_value` sitting next to it, disagreeing, and both
 * reached the prompt.
 *
 * `aliases` are the other spellings of that same cell this bridge has
 * ever minted — the snake name the Python parser gives the field, the
 * camelCase form `toCamelCase` derives from it, and (for the subtype)
 * a second hand-written copy under a name of this file's own. They are
 * DELETED rather than left beside the canonical key, for the reason the
 * EcoRI note gives in full: nothing on this platform reads any of them
 * on its own, every reader goes through an alias list that contains the
 * canonical name, and a spelling left behind is a row on the prompt.
 *
 * THE SUBTYPE WAS THE LAST ONE, and it was not a snake/camel pair — it
 * was this file assigning the parsed 分型 to two different keys in two
 * consecutive statements, `fields.diagnosisType` and
 * `fields.geneticType`. Both are on `OCR_FIELDS_SAFE_KEYS_PRECISE`,
 * neither has an underscore so `projectOcrFields` has no snake/camel
 * pair to collapse, and both end in 「type」 with a single-token value,
 * so `isCategoryLabel` passed them through strict mode too. One 分型 on
 * one laboratory report reached the model as 「diagnosisType: FSHD1」 and
 *「geneticType: FSHD1」 one under the other, in BOTH modes — the EcoRI
 * note's 「three measurements where the laboratory printed one」 applied
 * to the diagnosis itself, and the one row on the blob a model asked
 *「这份报告说是几型」 answers from. `GENETIC_FIELD_KEYS.geneticType` is
 * headed by `diagnosisType`, so that is the survivor; `geneticType` is
 * listed in that same table as LEGACY, which is what it now is again.
 *
 * The value is preferred off the canonical key when the loop already
 * wrote one there (methylation: the parser's field IS `methylation_value`,
 * so `toCamelCase` had already produced `methylationValue` carrying the
 * unit) and taken off the first alias holding one otherwise (D4Z4: the
 * parser's field is `d4z4_repeat_pathogenic`, which camelises to
 * something that is not the canonical name).
 *
 * READ OFF `fields` AND NOT OFF `genetic_summary`, which is the whole
 * point. `genetic_summary.d4z4_repeat_pathogenic` and
 * `.methylation_value` are typed as numbers and are null in exactly the
 * states this platform cares most about — a range, and a cell this
 * repo refuses to read as a count. The structured field is written in
 * every one of those states, carrying the raw text and the parser's own
 * unit, so canonicalising off it is what makes the alias set the same
 * shape whatever the report said.
 */
const CANONICAL_GENETIC_CELLS: ReadonlyArray<{
  canonical: string;
  aliases: readonly string[];
}> = [
  { canonical: 'd4z4Repeats', aliases: ['d4z4RepeatPathogenic', 'd4z4_repeat_pathogenic'] },
  { canonical: 'methylationValue', aliases: ['methylation_value'] },
  { canonical: 'diagnosisType', aliases: ['geneticType', 'diagnosis_type'] },
];

/**
 * THE WHOLE READING SURVIVES THE COLLAPSE, not just its number.
 *
 * This walked `fields[alias]` and `delete fields[alias]`, which is the
 * same one-key-at-a-time move the legacy analyte twins made below: a
 * 分型 or a 甲基化 cell the parser had flagged would keep
 * `methylationValueFlag` while `methylationValue` was rewritten from
 * an alias that had none, and a retired alias would leave its own
 * siblings standing under a name whose value is gone. `takeReading` /
 * `deleteReading` make the unit of work the cell rather than the key.
 */
/**
 * Analyte cells this bridge publishes under a second, readable name
 * because every reader's alias list on this platform is headed by that
 * name. Kept as data rather than as two hand-written assignments so
 * that adding a third twin cannot quietly add a third value-only copy;
 * see the note at the loop that consumes it.
 */
const LEGACY_ANALYTE_TWINS: ReadonlyArray<{ from: string; to: string }> = [
  { from: 'ck', to: 'creatineKinase' },
  { from: 'mb', to: 'myoglobin' },
];

const canonicaliseGeneticCells = (
  fields: Record<string, string>,
  readings: Map<string, ReportReading>,
) => {
  for (const { canonical, aliases } of CANONICAL_GENETIC_CELLS) {
    const reading =
      takeReading(fields, canonical) ??
      aliases.map((alias) => takeReading(fields, alias)).find(Boolean) ??
      null;
    for (const alias of aliases) {
      // THE SNAKE SPELLING SHARES THE CANONICAL'S SIBLINGS AND MUST
      // SURRENDER ONLY ITS VALUE. `methylation_value` and
      // `diagnosis_type` camelise to `methylationValue` and
      // `diagnosisType` — which ARE the canonical names — so
      // `deleteReading` on those aliases would delete the flag and the
      // interval this collapse exists to carry across. An alias whose
      // camel form is a name of its own (`geneticType`,
      // `d4z4RepeatPathogenic`) owns its siblings and takes them with
      // it.
      if (toCamelCase(alias) === canonical) {
        delete fields[alias];
      } else {
        deleteReading(fields, alias);
      }
      readings.delete(alias);
    }
    if (reading) {
      // ASSIGNED OVER THE CANONICAL KEY RATHER THAN DELETED AND
      // RE-ADDED, so a cell that was already under its canonical name
      // keeps its position in the payload. `fields` is iterated in
      // insertion order by `renderChunkForPrompt`, and reordering a
      // stable blob is churn a model sees.
      writeReading(fields, readings, canonical, reading);
      const camel = toCamelCase(canonical);
      // A sibling the SURVIVING reading does not carry is stale — it
      // described whichever spelling lost.
      if (!reading.flag) delete fields[flagKey(camel)];
      if (!reading.reference) delete fields[referenceKey(camel)];
    } else {
      deleteReading(fields, canonical);
      readings.delete(canonical);
    }
  }
};

const formatAggregateStrength = (items: Array<Record<string, unknown>>) => {
  const left = items.find((item) => item.side === 'left')?.mrc_score;
  const right = items.find((item) => item.side === 'right')?.mrc_score;
  const generic = items.find(
    (item) => item.side === 'unspecified' || item.side === 'bilateral',
  )?.mrc_score;
  const leftText = toStringField(left);
  const rightText = toStringField(right);
  const genericText = toStringField(generic);

  if (leftText || rightText) {
    const parts = [];
    if (leftText) parts.push(`L${leftText}`);
    if (rightText) parts.push(`R${rightText}`);
    return parts.join(' / ');
  }
  return genericText;
};

const resolveScriptPath = (explicit?: string) => {
  const candidates = [
    explicit,
    path.resolve(process.cwd(), 'apps/report-manager/embedded_parser.py'),
    path.resolve(process.cwd(), '../report-manager/embedded_parser.py'),
    path.resolve(__dirname, '../../../../report-manager/embedded_parser.py'),
  ].filter((value): value is string => Boolean(value));

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new AppError('Embedded report parser script not found', 500);
  }
  return found;
};

const resolveExtension = (mimeType: string | null, fileName?: string) => {
  const fromName = fileName?.match(/(\.[A-Za-z0-9]+)$/)?.[1];
  if (fromName) return fromName;
  switch (mimeType) {
    case 'application/pdf':
      return '.pdf';
    case 'image/png':
      return '.png';
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg';
    default:
      return '.bin';
  }
};

/**
 * Exported for `embedded-report-ocr.test.ts`, which is where the
 * one-cell-one-key invariant is actually checked. The test renders what
 * this returns through the real `renderChunkForPrompt` and counts the
 * rows the model receives, because that is the surface the duplicates
 * were visible on — counting keys here would have passed while the
 * prompt carried a cell twice. Everything above `parse` is process
 * plumbing; this is the whole of what the bridge decides.
 */
export const buildFields = (
  analysis: Record<string, unknown>,
  documentTypeHint: string,
  extractedText: string,
): { fields: Record<string, string>; confidence?: number } => {
  const normalizedExtractedText = extractedText.trim();
  const fshd = toRecord(analysis.fshd);
  const reviewQueue = Array.isArray(fshd?.review_queue) ? fshd.review_queue : [];
  const analysisStatus = normalizedExtractedText ? 'completed' : 'needs_review';
  const fields: Record<string, string> = {
    documentType: documentTypeHint,
    analysisStatus,
    ocrStatus: normalizedExtractedText ? 'text_extracted' : 'empty_text',
    extractedTextLength: String(normalizedExtractedText.length),
  };

  /**
   * WHAT THIS BRIDGE PUT IN `fields`, AS READINGS RATHER THAN AS
   * STRINGS — so a block that wants to publish a cell under a second
   * name can pick up the whole reading instead of re-reading the number
   * out of the map and losing the rest of it.
   *
   * Keyed by the `fields` spelling the reading was written under, which
   * is the only key a later block has to hand.
   */
  const readings = new Map<string, ReportReading>();

  const encounter = toRecord(analysis.encounter_info);
  const patientInfo = toRecord(analysis.patient_info);
  const normalizedSummary = toRecord(fshd?.normalized_summary);
  const structuredFields = Array.isArray(fshd?.structured_fields)
    ? (fshd?.structured_fields as StructuredField[])
    : [];

  const classifiedType = toStringField(fshd?.report_type);
  const classifiedTypeConfidence = toStringField(fshd?.report_type_confidence);
  if (classifiedType) {
    fields.classifiedType = classifiedType;
  }
  if (classifiedTypeConfidence) {
    fields.classifiedTypeConfidence = classifiedTypeConfidence;
  }

  const reportTypeLabel = toStringField(fshd?.report_type_label);
  if (reportTypeLabel) {
    fields.reportTypeLabel = reportTypeLabel;
  }

  const reportTime = toStringField(encounter?.report_time);
  if (reportTime) {
    fields.reportTime = reportTime;
  }

  const facility = toStringField(encounter?.facility);
  if (facility) {
    fields.facility = facility;
  }

  const patientName = toStringField(patientInfo?.name);
  if (patientName) {
    fields.patientName = patientName;
  }
  const patientSex = toStringField(patientInfo?.sex);
  if (patientSex) {
    fields.patientSex = patientSex;
  }
  const patientAge = toStringField(patientInfo?.age);
  if (patientAge) {
    fields.patientAge = patientAge;
  }
  const department = toStringField(encounter?.department);
  if (department) {
    fields.department = department;
  }
  const specimen = toStringField(encounter?.specimen);
  if (specimen) {
    fields.specimen = specimen;
  }
  const bedNo = toStringField(encounter?.bed_no);
  if (bedNo) {
    fields.bedNo = bedNo;
  }
  const orderingDoctor = toStringField(encounter?.ordering_doctor);
  if (orderingDoctor) {
    fields.orderingDoctor = orderingDoctor;
  }

  /**
   * THE FLAG AND THE REFERENCE INTERVAL STOPPED AT `observations`.
   *
   * The parser reads both off the row — 「*14肌酸激酶(CK) 693 ↑ 50-310
   * U/L」 — and writes them onto the structured field. `observations[]`
   * and `latest_summary.by_analyte` carry them. `ocr_payload.fields`,
   * which is the ONLY one of the three any patient-facing screen reads,
   * carried the number alone: 我的档案 → 血液/生化 renders a CK of 693
   * as an ordinary 「693U/L」, in the same colour as a normal one, with
   * nothing on the card saying the laboratory flagged it or what it was
   * flagged against.
   *
   * ONE SPELLING, NOT TWO. Every other cell in this loop is written
   * under both the snake and the camel name because both are already on
   * disk in stored payloads; these two are new, so they get the one
   * spelling every reader on this platform starts its alias list with,
   * and there is no snake/camel pair for `projectOcrFields` to have to
   * collapse. See the EcoRI note above for what a second spelling of one
   * cell costs.
   *
   * THE CONSUMING SHAPE HAD TO CHANGE FOR THIS TO REACH A PATIENT, AND
   * IT NOW HAS — `ReportInsightMetric` in apps/mobile/lib/
   * report-insights.ts carries `flag` and `reference`, the passport's
   * `buildMonitoringSummary` prints both, and fhir-r4.ts emits them as
   * `interpretation` / `referenceRange`. All three resolve the siblings
   * off the SAME key the value came from; see `pickLabReading` in
   * profile.passport.ts, which is the one resolver the API side shares.
   *
   * WHAT WAS STILL DROPPING THEM AFTER THIS LOOP RAN was this file:
   * three blocks below moved a value to a second key without its
   * siblings. They all go through `writeReading` now.
   */
  for (const field of structuredFields) {
    const fieldName = toStringField(field.field_name);
    const valueText = formatStructuredValue(field);
    if (!fieldName || !valueText) continue;
    const camelName = toCamelCase(fieldName);
    const abnormalFlag = toStringField(field.abnormal_flag);
    const referenceRange = toStringField(field.reference_range_raw);
    const reading: ReportReading = {
      value: valueText,
      ...(abnormalFlag ? { flag: abnormalFlag } : {}),
      ...(referenceRange ? { reference: referenceRange } : {}),
    };
    // Both spellings of the value, one spelling of the siblings — the
    // second call writes the same two sibling keys the first did, which
    // is why `writeReading` derives them from the camel form rather
    // than from the key it was handed.
    writeReading(fields, readings, fieldName, reading);
    writeReading(fields, readings, camelName, reading);
  }

  const geneticSummary = toRecord(normalizedSummary?.genetic_summary);
  if (geneticSummary) {
    const diagnosisType = toStringField(geneticSummary.diagnosis_type);
    const ecoriFragmentKb = toStringField(geneticSummary.ecori_fragment_kb);
    const interpretationSummary = toStringField(geneticSummary.interpretation_summary);

    if (diagnosisType) {
      // ONE 分型, ONE KEY. `fields.geneticType = diagnosisType` used to
      // stand on the next line and is gone — see the subtype paragraph
      // on `CANONICAL_GENETIC_CELLS`, which is what deletes the spelling
      // now that the structured-field loop also mints `diagnosis_type` /
      // `diagnosisType` from the very same cell.
      fields.diagnosisType = diagnosisType;
    }
    if (ecoriFragmentKb) {
      // ONE MEASUREMENT, ONE CELL.
      //
      // This block used to write the fragment twice — `ecoriFragmentKb`
      // as the bare float off `genetic_summary`, and `ecoRIFragment`
      // with 「kb」 stapled on — on top of the `ecori_fragment_kb` /
      // `ecoriFragmentKb` pair the structured-field loop above had
      // already written from the same cell, with the parser's own unit.
      // Three keys off one cell, in two different strings.
      //
      // Two strings is what made all three reach the prompt.
      // `projectOcrFields` collapses a snake/camel alias pair only when
      // the two values AGREE — a silent pick between two different
      // values would be the redactor editing clinical data — and the
      // bare float is what made them disagree. Rendered, one 18 kb
      // fragment on one laboratory report reached the model as
      // 「ecori_fragment_kb: 18kb」, 「ecoriFragmentKb: 18」 and
      // 「ecoRIFragment: 18kb」, one under the other. Each carries its own
      // 「length_in_kb_not_a_repeat_count」 now, so none of them reads as
      // a repeat count — but three refusals about three cells is still
      // three measurements where the laboratory printed one, and 「18」
      // with no unit beside it is the spelling that reads as a count of
      // 18 to a model asked about D4Z4 重复数.
      //
      // So the cell is written once, under the spelling every consumer's
      // alias list is headed by (`GENETIC_FIELD_KEYS.ecoRIFragment`, in
      // both the api's and the app's copy), carrying its unit — and the
      // structured-field spellings of the same cell are removed rather
      // than left beside it. Nothing reads either of those two on its
      // own: every reader on this platform goes through an alias list
      // that contains `ecoRIFragment`.
      //
      // PAYLOADS ALREADY STORED KEEP ALL THREE, and every read path
      // still understands them. The alias lists are unchanged, so the
      // passport, the app's report detail and the profile controller
      // still find the cell under its old spellings; the redactor
      // dispatches on the 「ecori」 substring rather than on a spelling,
      // so an archived row still gets the refusal on each of them. This
      // stops the triple being minted; it does not rewrite history.
      //
      // THE RENAME CARRIES THE ROW'S SIBLINGS. The structured field for
      // this cell can arrive flagged and with an interval printed
      // beside it, and the three `delete`s that used to stand here took
      // the value away while `ecoriFragmentKbFlag` stayed — a marker
      // with no number left to be about, and one this bridge would then
      // never write onto the surviving spelling.
      const retired = takeReading(fields, 'ecoriFragmentKb');
      deleteReading(fields, 'ecoriFragmentKb');
      deleteReading(fields, 'ecori_fragment_kb');
      readings.delete('ecoriFragmentKb');
      readings.delete('ecori_fragment_kb');
      writeReading(fields, readings, 'ecoRIFragment', {
        ...(retired ?? {}),
        value: withKbUnit(ecoriFragmentKb),
      });
    }
    // NO D4Z4 AND NO METHYLATION WRITE HERE. Both used to be copied out
    // of `genetic_summary` on top of what the structured-field loop had
    // already written from the same cell, and both are now
    // canonicalised off that loop's own output by
    // `canonicaliseGeneticCells` below. What each write did:
    //
    // THE METHYLATION CELL REACHED THE PROMPT AS TWO MEASUREMENTS, ONE
    // OF THEM WITHOUT ITS UNIT. `genetic_summary.methylation_value` is a
    // bare float; the parser's structured field for the same cell
    // carries the unit the laboratory printed, so the loop had written
    // 「35%」 under both `methylation_value` and `methylationValue` — a
    // pair that AGREES, which is the only case `projectOcrFields`
    // collapses. Overwriting the camel half with 「35」 is what broke the
    // agreement and kept both alive. Rendered, one cell on one report
    // reached the model as 「methylation_value: 35%」 and
    // 「methylationValue: 35」 one under the other in precise mode, and
    // in strict mode as `numericValuesWithheld: 2` — two measurements
    // withheld where the laboratory printed one. And because
    // `GENETIC_FIELD_KEYS.methylationValue` is headed by
    // `methylationValue`, the UNITLESS one is what every human-facing
    // surface picked: the passport, the share page, the referral pack,
    // the exports and the app's 病程 row. Commit 4a0c535 exists because
    // this same cell already reached a patient with the wrong unit
    // once, from the other end of the same pipe.
    //
    // ONE D4Z4 COUNT REACHED THE PROMPT AS TWO INDEPENDENTLY GRADED
    // CELLS. This block wrote `d4z4RepeatPathogenic` AND `d4z4Repeats`
    // from one number, on top of the `d4z4_repeat_pathogenic` /
    // `d4z4RepeatPathogenic` pair the loop had already written from the
    // same cell. The snake/camel pair collapses; `d4z4Repeats` has no
    // snake twin to collapse against, and `projectOcrFields` dispatches
    // on the 「d4z4」 substring rather than on a spelling — so each got
    // its own raw row AND its own `_clinical` row. A report printing
    // 「D4Z4 重复单元数 3/22」 handed the model
    // 「d4z4RepeatPathogenic: 3」 / 「d4z4RepeatPathogenic_clinical:
    // within_fshd1_repeat_range」 / 「d4z4Repeats: 3」 /
    // 「d4z4Repeats_clinical: within_fshd1_repeat_range」, four rows for
    // one contracted allele, beside the uncontracted allele's own two.
    //
    // AND THE ALIAS SET WAS INCONSISTENT BY STATE, which is the half
    // that could not be seen from the happy path.
    // `genetic_summary.d4z4_repeat_pathogenic` is null for a range and
    // for every cell this repo refuses to read as a count, so a report
    // whose count cell says 0 — or 1-10 — got `d4z4RepeatPathogenic`
    // and no `d4z4Repeats` at all, while a report printing 3 got both.
    // The one key `EDITABLE_OCR_FIELDS` lets a patient correct, and the
    // one `profile.controller.ts` names first when it writes 「D4Z4
    // 重复数 …」 into the baseline, was the key that existed only when
    // the reading was clean.
    if (interpretationSummary) {
      fields.interpretationSummary = interpretationSummary;
    }
  }

  // Outside the `genetic_summary` guard on purpose: the cells it
  // collapses are mostly the structured-field loop's, and that loop
  // runs for any document whose parse produced them. The subtype's
  // `diagnosisType` is written inside the guard as well, and running
  // after it is what lets the group take the canonical key's own value
  // rather than racing the write.
  //
  // PAYLOADS ALREADY STORED KEEP EVERY SPELLING, and every read path
  // still understands them — the same statement the EcoRI note above
  // makes, checked the same way. The alias lists are untouched:
  // `GENETIC_FIELD_KEYS.d4z4Repeats`, `.methylationValue` and
  // `.geneticType` all still list the removed spellings after the
  // canonical one, so the passport, the profile autofill, the exports,
  // the app's report-detail table and its correction sheet all still
  // find an archived cell. The redactor dispatches on the 「d4z4」 and
  //「methylation」 substrings rather than on a spelling, so an archived
  // row still gets its reading on each of them — including the
  // duplicate rows, which is exactly the state this stops being minted
  // rather than one it rewrites. The two archived readers that name
  // spellings without the canonical fallback are both in
  // `profile.controller.ts`, and both cover the removed one:
  // ['d4z4Repeats', 'd4z4RepeatPathogenic'] and
  // ['diagnosisType', 'geneticType'].
  canonicaliseGeneticCells(fields, readings);

  const muscleStrength = Array.isArray(normalizedSummary?.muscle_strength)
    ? (normalizedSummary?.muscle_strength as Array<Record<string, unknown>>)
    : [];
  const byMuscle = new Map<string, Array<Record<string, unknown>>>();
  for (const item of muscleStrength) {
    const muscleName = toStringField(item.muscle_name);
    if (!muscleName) continue;
    const existing = byMuscle.get(muscleName) ?? [];
    existing.push(item);
    byMuscle.set(muscleName, existing);
  }
  const strengthAliases: Record<string, string> = {
    deltoid: 'deltoidStrength',
    biceps: 'bicepsStrength',
    triceps: 'tricepsStrength',
    quadriceps: 'quadricepsStrength',
    tibialis_anterior: 'tibialisStrength',
  };
  for (const [muscleName, key] of Object.entries(strengthAliases)) {
    const aggregate = formatAggregateStrength(byMuscle.get(muscleName) ?? []);
    if (aggregate) {
      fields[key] = aggregate;
    }
  }

  const mriSummary = toRecord(normalizedSummary?.mri_summary);
  const reportImpression =
    toStringField(mriSummary?.report_impression) ?? toStringField(fields.reportImpression);
  if (reportImpression) {
    fields.reportImpression = reportImpression;
    fields.impressionText = reportImpression;
  }

  const cardio = toRecord(normalizedSummary?.cardio_respiratory_panel);
  if (cardio) {
    const directKeys = [
      'fvc',
      'fvcPredPct',
      'fev1',
      'fev1PredPct',
      'fev1Fvc',
      'tlc',
      'tlcPredPct',
      'dlco',
      'dlcoPredPct',
      'dlcoVa',
      'ventilatoryPattern',
      'severity',
      'diffusionStatus',
      'diaphragmMotionSummary',
      'diaphragmThickeningSummary',
      'ecgRhythm',
      'heartRate',
      'prIntervalMs',
      'qrsDurationMs',
      'qtMs',
      'qtcMs',
      'conductionAbnormality',
      'ecgSummary',
      'lvef',
      'fs',
      'co',
      'hr',
      'lad',
      'aod',
      'lvdD',
      'eOverEPrime',
      'chamberSizeStatus',
      'wallMotionStatus',
      'valveStatus',
      'echoSummary',
    ];
    /**
     * A FALLBACK, LIKE THE LAB PANEL BELOW — it used to be a clobber.
     *
     * `cardio_respiratory_panel` holds the BARE NORMALIZED FLOAT. The
     * structured-field loop above has already rendered the same cell
     * through `formatStructuredValue` with the unit the parser read off
     * the row, and with its flag and its interval; this loop then
     * assigned the float straight over it. Measured on a synthetic
     * 肺功能报告: `fvc_pred_pct: 「61%」` from the loop, `fvcPredPct:
     * 「61」` from here, one cell as two disagreeing strings — and the
     * `fvcPredPctFlag: low` / `fvcPredPctReference: 80-120` the loop had
     * just written left describing a number this block had overwritten.
     *
     * Two spellings of one cell that DISAGREE is also the one state
     * `projectOcrFields` refuses to collapse, so both reached the model
     * as separate rows, and `withholdUnsafeReadings` reads a disagreeing
     * pair as `contradictory_aliases` — the strongest thing a payload
     * can say about not knowing what was printed.
     *
     * So the panel answers only where the parse produced no structured
     * field to render, which is the one state in which the bare float
     * is the best this bridge has. Written through `writeReading` like
     * everything else: most of these keys are prose or wire tokens that
     * carry no flag, and going through the one writer is what keeps
     * that a property of the DATA rather than of this call site.
     */
    for (const key of directKeys) {
      if (fields[key]) continue;
      const snakeKey = key.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
      const valueText = toStringField(cardio[key]) ?? toStringField(cardio[snakeKey]);
      if (valueText) {
        writeReading(fields, readings, key, { value: valueText });
      }
    }
  }

  const labPanel = toRecord(normalizedSummary?.lab_panel);
  if (labPanel) {
    /**
     * THE UNIT WAS STRIPPED FROM EXACTLY THE ANALYTES THIS DISEASE IS
     * MONITORED BY.
     *
     * `normalized_summary.lab_panel` holds the BARE FLOAT — the unit
     * lives on the structured field, which the loop above has already
     * rendered through `formatStructuredValue` with the unit attached.
     * This block then wrote the float over it. Measured on a synthetic
     * 心肌酶谱 and a synthetic 生化全套: `ck: 「693」` and `ldh: 「319」`
     * where the parser had produced 「693U/L」 and 「319U/L」, on a
     * payload whose `alb`, `globulin`, `sodium` and `calcium` — every
     * analyte NOT on this list — kept theirs. So the eight cells a
     * clinician reads an FSHD patient's muscle damage off were the
     * eight that reached 我的档案, the passport, the exports and the
     * model prompt as unitless numbers, beside neighbours that read
     * 「42g/L」.
     *
     * This is the clobber shape `CANONICAL_GENETIC_CELLS` was written
     * for, on the muscle-damage panel: one cell, one key, and the
     * spelling that carries the laboratory's own unit is the one that
     * survives. The panel is now a FALLBACK — it answers only where the
     * parse produced a panel entry and no structured field to render,
     * which is the one state in which the bare float is the best this
     * bridge has.
     */
    const directKeys = ['ck', 'mb', 'ldh', 'ckmb', 'creatinine', 'uricAcid', 'alt', 'ast'];
    for (const key of directKeys) {
      if (fields[key]) continue;
      const snakeKey = key.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
      const valueText = toStringField(labPanel[key]) ?? toStringField(labPanel[snakeKey]);
      if (valueText) {
        writeReading(fields, readings, key, { value: valueText });
      }
    }
  }

  /**
   * THE TWO LEGACY TWINS, AND WHY THEY WERE THE END OF THE CHAIN.
   *
   * These two lines were `fields.creatineKinase = fields.ck` and
   * `fields.myoglobin = fields.mb`: the VALUE of a cell copied to a
   * second key, with `ckFlag` and `ckReference` left behind under the
   * first. That would be harmless if nothing preferred the twin — and
   * everything prefers the twin. `BLOOD_METRICS` in profile.passport.ts
   * is headed by `creatineKinase`, `REPORT_FIELD_SPECS` in
   * export/export-source.ts keys the CK Observation on it, and the app's
   * own lists start there too, because it is the readable name.
   *
   * So on a synthetic 心肌酶谱 whose CK row printed 「693 ↑ 50-310」, the
   * clinical passport, the share page a clinician opens from a link, the
   * markdown export, the referral pack and the FHIR bundle all printed
   * 「CK 693U/L」 — while the LDH one row down, which has no twin, printed
   * 「LDH 319U/L（偏高，参考区间 120-250）」 off the very same payload. The
   * one enzyme this disease is monitored by was the one the laboratory's
   * own verdict could not reach.
   *
   * `writeReading` off the READING and not off `fields[from]`: an alias
   * of a reading is the whole reading or it is a misrepresentation of
   * one.
   *
   * OUTSIDE THE `lab_panel` GUARD, for the same reason
   * `canonicaliseGeneticCells` is outside the `genetic_summary` one: the
   * twins are about the SPELLING of a cell, not about which branch of
   * the parse produced it. Standing inside the guard, they were minted
   * only for a report whose parse also yielded a normalised panel — so a
   * 心肌酶谱 read out as structured fields alone published no
   * `creatineKinase` at all, and every reader whose alias list is headed
   * by that name fell through to the parser's own key by luck.
   */
  for (const { from, to } of LEGACY_ANALYTE_TWINS) {
    const reading = readings.get(from);
    if (reading) {
      writeReading(fields, readings, to, reading);
    }
  }

  fields.reviewRecommendedCount = String(reviewQueue.length);
  fields.fieldCount = String(structuredFields.length);
  if (!normalizedExtractedText) {
    fields.ocrIssue = 'No text was extracted from the uploaded file';
  }

  return {
    fields,
    confidence:
      typeof fshd?.report_type_confidence === 'number' ? fshd.report_type_confidence : undefined,
  };
};

export class EmbeddedReportOcrProvider implements OcrProvider {
  readonly disclosure = ON_PREMISE_OCR;
  private readonly pythonBin: string;
  private readonly timeoutMs: number;
  private readonly scriptPath: string;

  constructor(config: EmbeddedReportOcrConfig = {}) {
    this.pythonBin = config.pythonBin?.trim() || 'python3';
    this.timeoutMs = config.timeoutMs ?? 120_000;
    this.scriptPath = resolveScriptPath(config.scriptPath);
  }

  async parse(input: {
    buffer: Buffer;
    mimeType: string | null;
    documentType: string;
    userId?: string | number;
    fileName?: string;
    reportName?: string;
  }): Promise<OcrResult> {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'openrd-report-'));
    const extension = resolveExtension(input.mimeType, input.fileName);
    const tempFile = path.join(tempDir, `input${extension}`);

    try {
      await writeFile(tempFile, input.buffer);

      const { stdout, stderr } = await execFileAsync(
        this.pythonBin,
        [
          this.scriptPath,
          '--file-path',
          tempFile,
          '--mime-type',
          input.mimeType ?? 'application/octet-stream',
          '--document-type-hint',
          input.documentType,
          '--report-name',
          input.reportName ?? input.fileName ?? `document-${input.documentType}`,
        ],
        {
          cwd: process.cwd(),
          timeout: this.timeoutMs,
          maxBuffer: 10 * 1024 * 1024,
          env: {
            ...process.env,
            // PaddleX pings its model hosts on every start to see if a
            // newer checkpoint exists — the log line is「Checking
            // connectivity to the model hosters, this may take a
            // while」and it is not idle chatter: measured on this
            // machine it costs ~17s of a ~103s parse, on every single
            // document, to re-confirm files we already have on disk
            // and would not auto-update anyway.
            //
            // That mattered because the whole parse was landing within
            // a few seconds of OCR_PARSER_TIMEOUT_MS. It also means a
            // patient on a slow or captive network pays the check's
            // full timeout before OCR even begins.
            PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: 'True',
          },
        },
      );

      const trimmed = stdout.trim();
      if (!trimmed) {
        throw new AppError(
          `Embedded report parser returned empty stdout${stderr ? `: ${stderr}` : ''}`,
          502,
        );
      }

      let payload: EmbeddedParsePayload;
      try {
        payload = JSON.parse(trimmed) as EmbeddedParsePayload;
      } catch (error) {
        throw new AppError(`Embedded report parser returned invalid JSON: ${String(error)}`, 502);
      }

      if (payload.error) {
        throw new AppError(
          `Embedded report parser failed: ${payload.detail ?? payload.error}`,
          502,
        );
      }

      const analysis = toRecord(payload.analysis);
      if (!analysis) {
        throw new AppError('Embedded report parser returned empty analysis payload', 502);
      }

      const mapped = buildFields(analysis, input.documentType, payload.extracted_text ?? '');

      return {
        provider: payload.provider ?? 'embedded_report_pipeline_v1',
        // The parse is a local child process over a file in our own
        // tmpdir — this is the mode 隐私政策 §3(三) describes, and the
        // only one for which that sentence is true as written.
        disclosure: ON_PREMISE_OCR,
        extractedText: payload.extracted_text ?? '',
        fields: mapped.fields,
        confidence: mapped.confidence,
        aiExtraction: analysis,
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new AppError(`Embedded report OCR failed: ${message}`, 502);
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
