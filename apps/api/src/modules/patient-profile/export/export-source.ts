import { createHash } from 'node:crypto';

import type { ExportFieldOrigin, ExportOmission } from './envelope.js';
import { baselineFieldLabelZh, listBaselineFieldOrigins } from '../baseline-provenance.js';
import { resolveOccurrenceDate, type OccurrenceDate } from './occurrence-date.js';
import { decodeFirstYear, type YearAnswer } from './year-value.js';
import type { PatientDocumentDTO, PatientProfileDTO } from '../profile.service.js';

/**
 * One reading of the profile, shared by all three serialisers.
 *
 * The three formats disagree about almost everything — sections vs
 * protobuf messages vs resource graph — but they agree on WHAT is
 * true about the patient. Reading the baseline JSONB three times, in
 * three files, with three sets of key aliases, is how they would
 * start to disagree about that too. So the reading happens once here
 * and the serialisers only ever see the normalised result.
 */

export interface ExportOptions {
  /**
   * Whether the local-only block may be rendered.
   *
   * Two separate reasons live behind this one flag, and both point
   * the same way:
   *
   *   - Direct identifiers (name, the diagnosing physician's name)
   *     are, by the FSHD core dataset's own rules, held at the
   *     collecting registry and not shipped onward.
   *   - Family history is a statement about the patient's RELATIVES.
   *     Those people are a second data subject who never consented to
   *     anything here. What we hold is not their medical record; it
   *     is 「患者对自身家族史的陈述」, and it is recorded and labelled
   *     as exactly that.
   *
   * Default OFF. A share link must never carry this block: the
   * patient chose to show a clinician their own record, which is not
   * consent on their sibling's behalf.
   */
  readonly includeLocalOnly: boolean;
  /** Injected so goldens are deterministic and so does not drift per call. */
  readonly generatedAt: string;
}

export type FshdDiagnosisType = 'FSHD1' | 'FSHD2' | 'unspecified';

export interface MilestoneEvent {
  readonly kind: 'wheelchair' | 'niv' | 'afo';
  readonly labelZh: string;
  readonly eventId: string;
  readonly occurrence: OccurrenceDate;
  readonly descriptionZh: string | null;
}

/**
 * A follow-up event that is not one of the three milestones — a fall,
 * a first foot drop, a first breathing symptom.
 *
 * Carried separately rather than folded into `milestones` because the
 * milestones answer 「what assistive step has this person reached」
 * and these answer 「what has been happening to them」. They share the
 * same date-precision limitation, so they carry the same
 * `OccurrenceDate`.
 */
export interface FollowupEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly occurrence: OccurrenceDate;
  readonly severity: string | null;
  readonly descriptionZh: string | null;
}

export interface ReportField {
  readonly key: string;
  readonly labelZh: string;
  readonly value: string;
  readonly documentId: string;
  readonly documentType: string;
  /**
   * The best timestamp available for this reading — the report's own
   * stated time when OCR read one, otherwise the upload time. Safe to
   * ORDER BY; not safe to publish as the observation time without
   * checking `observedAtIsUploadTime` first.
   */
  readonly observedAt: string;
  /**
   * True when OCR found no date on the report and `observedAt` is
   * therefore only the moment the patient photographed it.
   *
   * `reportTime` is genuinely often absent, so this is not an edge
   * case: a pulmonary function report printed in 2019 and uploaded
   * this week would otherwise be exported as an FVC%pred measured
   * this week, and a clinician reading a current-looking number
   * defers the reassessment that number was supposed to trigger.
   * Serialisers must either label the date or leave it out.
   */
  readonly observedAtIsUploadTime: boolean;
  readonly category: 'laboratory' | 'exam' | 'imaging';
  /**
   * The ledger key a coding WOULD be looked up under. Null where no
   * candidate exists at all. Never a code — see codings.ts.
   */
  readonly codingKey: string | null;
}

export interface NormalisedSource {
  readonly profile: PatientProfileDTO;
  readonly options: ExportOptions;
  readonly diagnosisType: FshdDiagnosisType;
  readonly diagnosisTypeRawZh: string | null;
  readonly diagnosisYear: YearAnswer;
  readonly birthYear: YearAnswer;
  readonly geneticEvidence: {
    readonly d4z4: string | null;
    readonly haplotype: string | null;
    readonly methylation: string | null;
    readonly hasGeneticReport: boolean;
  };
  readonly familyHistoryStatement: string | null;
  readonly currentStatus: {
    readonly ambulation: string | null;
    readonly armRaiseDifficulty: boolean | null;
    readonly facialWeakness: boolean | null;
    readonly footDrop: boolean | null;
    readonly breathingSymptoms: boolean | null;
    readonly assistiveDevices: readonly string[];
  };
  readonly challenges: ReadonlyArray<{ key: string; labelZh: string; score: number }>;
  readonly milestones: readonly MilestoneEvent[];
  readonly followupEvents: readonly FollowupEvent[];
  readonly reportFields: readonly ReportField[];
  /**
   * Contract §B3: which baseline fields somebody other than the patient
   * entered. Read ONCE here, like everything else in this file, so the
   * three serialisers cannot disagree about who typed a value.
   *
   * Empty for the overwhelming majority of profiles, and empty is a
   * claim — see PortableExportEnvelope.fieldOrigins.
   */
  readonly fieldOrigins: readonly ExportFieldOrigin[];
}

/**
 * The one sentence a serialiser appends beside a value that somebody
 * other than the patient typed, or `null` when the patient typed it.
 *
 * Takes the baseline PATH rather than an item key, because the path is
 * what the provenance block is keyed by; a serialiser that invented its
 * own key would be free to get the mapping wrong in the one direction
 * that matters.
 */
export const originNoteZh = (source: NormalisedSource, fieldPath: string): string | null => {
  const origin = source.fieldOrigins.find((entry) => entry.path === fieldPath);
  if (!origin) return null;
  return origin.state === 'admin_entered'
    ? `；此项由本平台管理员于 ${origin.at ?? '未记录时间'} 代患者录入，不是患者本人填写，患者可能未核对过`
    : `；此项的来源记录读不出来（${origin.detail ?? '原因未记录'}），只能确定不是患者本人填写`;
};

/**
 * `originNoteZh` folded onto a provenance string, so every call site
 * reads the same and none of them can forget the separator.
 *
 * `whenMarkedZh` exists because concatenation alone can produce a
 * self-contradicting sentence: a `provenanceZh` that CLAIMS THE PATIENT
 * TYPED THE VALUE (「患者本人填写」, 「患者自述」) followed by the marker's
 * 「不是患者本人填写」 says both things in one field, and a receiver has
 * no way to tell which half is current. A call site whose base sentence
 * makes that claim passes the sentence to use instead when the field
 * carries a marker; one whose base sentence says only WHERE the value
 * sits (「基线问卷」, 「基因报告结构化解析」) stays true either way and
 * omits it.
 */
export const withOriginNote = (
  source: NormalisedSource,
  fieldPath: string,
  provenanceZh: string,
  whenMarkedZh?: string,
): string => {
  const note = originNoteZh(source, fieldPath);
  if (!note) return provenanceZh;
  return `${whenMarkedZh ?? provenanceZh}${note}`;
};

/**
 * What an EMPTY `fieldOrigins` is allowed to claim, in one sentence the
 * three serialisers share.
 *
 * The claim is about the marker block and nothing else.
 * `fieldProvenance` records administrator writes
 * (baseline-provenance.ts), so a baseline field without an entry is not
 * thereby the patient's own: values reach the baseline along paths that
 * neither the patient typed into that field nor this block marks. The
 * sentence therefore says what is absent from the record and claims
 * nothing about who authored the rest.
 *
 * Shared rather than copied into three files: three copies of one claim
 * are three chances for one of them to be the stronger one.
 */
export const NO_ADMIN_FIELD_ORIGIN_NOTE_ZH = '本次导出的基线字段没有本平台工作人员代填的记录。';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const section = (baseline: Record<string, unknown> | null, key: string) => {
  const raw = baseline?.[key];
  return isRecord(raw) ? raw : null;
};

const text = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const bool = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);

/**
 * FSHD1 vs FSHD2 vs 「说不上是哪一型」.
 *
 * `unspecified` is a real answer here, not a fallback for missing
 * data. A large share of this population carries a clinical diagnosis
 * with no genetic subtype ever established, and the export has to be
 * able to say that rather than silently defaulting to FSHD1, which is
 * the common form and therefore the plausible-looking wrong answer.
 */
export const classifyDiagnosisType = (raw: string | null): FshdDiagnosisType => {
  if (!raw) return 'unspecified';
  const normalised = raw.replace(/\s|-|_/g, '').toUpperCase();
  // Check FSHD2 first: 「FSHD2」 contains 「FSHD」 and a naive FSHD1
  // test on a 2 would have to be ordered by luck.
  if (/FSHD2|2型|TYPE2|II型/.test(normalised) || normalised === '2') return 'FSHD2';
  if (/FSHD1|1型|TYPE1|I型/.test(normalised) || normalised === '1') return 'FSHD1';
  return 'unspecified';
};

const MILESTONE_EVENTS: Record<string, { kind: MilestoneEvent['kind']; labelZh: string }> = {
  started_wheelchair: { kind: 'wheelchair', labelZh: '开始使用轮椅' },
  started_niv: { kind: 'niv', labelZh: '开始使用无创通气（NIV）' },
  started_afo: { kind: 'afo', labelZh: '开始使用踝足矫形器（AFO）' },
};

const CHALLENGE_LABELS: Record<string, string> = {
  fatigue: '疲劳',
  pain: '疼痛',
  stairs: '上下楼梯',
  dressing: '穿衣',
  reachingUp: '上举手臂',
  walkingStability: '行走稳定性',
};

/**
 * OCR field aliases.
 *
 * These duplicate the alias tables in profile.passport.ts, and that
 * duplication is deliberate for now rather than accidental: this lane
 * may not edit passport, and importing its private `pickField` is not
 * possible because it is not exported. The tables should be pulled
 * into one module — noted in the handoff. What must NOT happen in the
 * meantime is this file quietly recognising a KEY that passport does
 * not, so that the anesthesia card and the registry export disagree
 * about the same report. Every alias below is copied from
 * profile.passport.ts, and nothing has been invented.
 */
const REPORT_FIELD_SPECS: ReadonlyArray<{
  keys: readonly string[];
  key: string;
  labelZh: string;
  category: ReportField['category'];
  codingKey: string | null;
}> = [
  {
    key: 'creatineKinase',
    keys: ['creatineKinase', 'creatine_kinase', 'CK', 'ck'],
    labelZh: '肌酸激酶（CK）',
    category: 'laboratory',
    codingKey: 'lab.creatineKinase',
  },
  {
    key: 'myoglobin',
    keys: ['myoglobin', 'Mb', 'mb'],
    labelZh: '肌红蛋白（Mb）',
    category: 'laboratory',
    codingKey: null,
  },
  {
    key: 'ldh',
    keys: ['LDH', 'ldh'],
    labelZh: '乳酸脱氢酶（LDH）',
    category: 'laboratory',
    codingKey: null,
  },
  {
    key: 'ckmb',
    keys: ['CKMB', 'ckmb'],
    labelZh: '肌酸激酶同工酶（CK-MB）',
    category: 'laboratory',
    codingKey: null,
  },
  {
    key: 'fvcPercentPredicted',
    keys: ['fvcPredPct', 'fvc_pred_pct'],
    labelZh: '用力肺活量占预计值百分比（FVC%pred）',
    category: 'laboratory',
    codingKey: 'pft.fvcPercentPredicted',
  },
  {
    key: 'tlcPercentPredicted',
    keys: ['tlcPredPct', 'tlc_pred_pct'],
    labelZh: '肺总量占预计值百分比（TLC%pred）',
    category: 'laboratory',
    codingKey: null,
  },
  {
    key: 'dlcoPercentPredicted',
    keys: ['dlcoPredPct', 'dlco_pred_pct'],
    labelZh: '一氧化碳弥散量占预计值百分比（DLCO%pred）',
    category: 'laboratory',
    codingKey: 'pft.dlco',
  },
  {
    key: 'lvef',
    keys: ['LVEF', 'lvef'],
    labelZh: '左心室射血分数（LVEF）',
    category: 'laboratory',
    codingKey: null,
  },
  {
    key: 'qtc',
    keys: ['QTc', 'qtc', 'qtcMs', 'qtc_ms'],
    labelZh: 'QTc 间期',
    category: 'laboratory',
    codingKey: null,
  },
  {
    key: 'serratusFatGrade',
    keys: ['serratusFatigueGrade', 'serratus_fatigue_grade'],
    labelZh: '前锯肌脂肪化等级',
    category: 'imaging',
    codingKey: null,
  },
  {
    key: 'd4z4Repeats',
    keys: ['d4z4Repeats', 'd4z4RepeatPathogenic', 'd4z4_repeat_pathogenic', 'd4z4_repeats'],
    labelZh: 'D4Z4 重复单元数',
    category: 'laboratory',
    codingKey: null,
  },
  {
    key: 'haplotype',
    keys: ['haplotype', 'haplotype4q', 'haplotype_4q'],
    labelZh: '4q 单倍型',
    category: 'laboratory',
    codingKey: null,
  },
];

const documentFields = (document: PatientDocumentDTO): Record<string, unknown> | null => {
  const payload = document.ocrPayload;
  if (!isRecord(payload)) return null;
  const fields = payload.fields;
  return isRecord(fields) ? fields : null;
};

const pickAlias = (fields: Record<string, unknown>, keys: readonly string[]): string | null => {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
};

const collectReportFields = (documents: readonly PatientDocumentDTO[]): ReportField[] => {
  const out: ReportField[] = [];
  // Newest first so a consumer taking the head of each key gets the
  // most recent reading; `documents` already arrives sorted by
  // uploaded_at DESC from getProfileByUserId, but this export must
  // not depend on a sibling query's ORDER BY staying put.
  const ordered = [...documents].sort(
    (a, b) => Date.parse(b.uploadedAt) - Date.parse(a.uploadedAt),
  );
  ordered.forEach((document) => {
    const fields = documentFields(document);
    if (!fields) return;
    const reportTime = pickAlias(fields, ['reportTime', 'report_time']);
    REPORT_FIELD_SPECS.forEach((spec) => {
      const value = pickAlias(fields, spec.keys);
      if (value === null) return;
      out.push({
        key: spec.key,
        labelZh: spec.labelZh,
        value,
        documentId: document.id,
        documentType: document.documentType,
        // The report's own stated time when OCR read one, else the
        // upload time — with the substitution recorded, not silent.
        // Every consumer of `observedAt` has to decide what to do
        // with the second case, and the flag is what lets it.
        observedAt: reportTime ?? document.uploadedAt,
        observedAtIsUploadTime: reportTime === null,
        category: spec.category,
        codingKey: spec.codingKey,
      });
    });
  });
  return out;
};

export const normaliseSource = (
  profile: PatientProfileDTO,
  options: ExportOptions,
): NormalisedSource => {
  const baseline = isRecord(profile.baseline) ? profile.baseline : null;
  const foundation = section(baseline, 'foundation');
  const disease = section(baseline, 'diseaseBackground');
  const status = section(baseline, 'currentStatus');
  const challenges = section(baseline, 'currentChallenges');

  const diagnosisTypeRaw = text(disease?.diagnosisType) ?? text(profile.geneticMutation);

  const assistiveDevices = Array.isArray(status?.assistiveDevices)
    ? status.assistiveDevices.filter(
        (item): item is string => typeof item === 'string' && !!item.trim(),
      )
    : [];

  const milestones: MilestoneEvent[] = profile.followupEvents
    .filter((event) => event.eventType in MILESTONE_EVENTS)
    .map((event) => {
      const spec = MILESTONE_EVENTS[event.eventType];
      return {
        kind: spec.kind,
        labelZh: spec.labelZh,
        eventId: event.id,
        occurrence: resolveOccurrenceDate(event.occurredAt),
        descriptionZh: text(event.description),
      };
    });

  return {
    profile,
    options,
    diagnosisType: classifyDiagnosisType(diagnosisTypeRaw),
    diagnosisTypeRawZh: diagnosisTypeRaw,
    // Explicit diagnosis YEAR first, then the year component of the
    // diagnosis DATE. The date is often back-filled from a report's
    // print date, so it is the weaker of the two.
    diagnosisYear: decodeFirstYear(foundation?.diagnosisYear, profile.diagnosisDate),
    birthYear: decodeFirstYear(foundation?.birthYear, profile.dateOfBirth),
    geneticEvidence: {
      d4z4: text(disease?.d4z4),
      haplotype: text(disease?.haplotype),
      methylation: text(disease?.methylation),
      hasGeneticReport: profile.documents.some(
        (document) => document.documentType === 'genetic_report',
      ),
    },
    familyHistoryStatement: text(disease?.familyHistory),
    currentStatus: {
      ambulation: text(status?.independentlyAmbulatory),
      armRaiseDifficulty: bool(status?.armRaiseDifficulty),
      facialWeakness: bool(status?.facialWeakness),
      footDrop: bool(status?.footDrop),
      breathingSymptoms: bool(status?.breathingSymptoms),
      assistiveDevices,
    },
    challenges: Object.entries(CHALLENGE_LABELS)
      .map(([key, labelZh]) => {
        const value = challenges?.[key];
        return typeof value === 'number' && Number.isFinite(value)
          ? { key, labelZh, score: value }
          : null;
      })
      .filter((entry): entry is { key: string; labelZh: string; score: number } => entry !== null),
    milestones,
    fieldOrigins: listBaselineFieldOrigins(baseline).map(({ path, origin }) => ({
      path,
      labelZh: baselineFieldLabelZh(path),
      state: origin.state === 'admin_entered' ? 'admin_entered' : 'unreadable',
      adminUserId: origin.state === 'admin_entered' ? origin.adminUserId : null,
      at: origin.state === 'admin_entered' ? origin.at : null,
      detail: origin.state === 'unreadable' ? origin.detail : null,
    })),
    followupEvents: profile.followupEvents
      .filter((event) => !(event.eventType in MILESTONE_EVENTS))
      .map((event) => ({
        eventId: event.id,
        eventType: event.eventType,
        occurrence: resolveOccurrenceDate(event.occurredAt),
        severity: text(event.severity),
        descriptionZh: text(event.description),
      })),
    reportFields: collectReportFields(profile.documents),
  };
};

/**
 * Brooke and Vignos are collected and are not exported.
 *
 * The instruments module writes graded ordinal motor scales to
 * `instrument_administrations` and serves them at /me/instruments/*,
 * but they are not on `PatientProfileDTO`, which is the only thing
 * this normaliser reads — so no serialiser downstream can see them.
 * Of everything in a patient's record, these two are the measures a
 * registry can actually compare across patients, and the export was
 * shipping without them AND without saying so, which is the exact
 * state envelope.ts says `omissions` exists to prevent.
 *
 * Until the normaliser is given the administrations, every format
 * declares the gap. The paragraph below is shared so the three cannot
 * drift into describing the same hole differently.
 *
 * What is NOT shared is what each format does with the walking state a
 * Vignos sync writes into the baseline, because that is a fact about
 * one document rather than about the pipeline. It used to be the last
 * sentence of this constant, phrased for TREAT-NMD — so the FHIR
 * bundle and the Phenopacket, neither of which carries that baseline
 * state, were telling their receivers to look for one in a 运动功能
 * section neither of them has. Sharing a sentence that is only true of
 * one output is how the shared wording became the untrue part.
 *
 * 「Baseline state」 is the precise noun and each format's sentence has
 * to keep it precise. The FHIR bundle carries timed walk tests and a
 * 户外行走 self-rating; a sentence there claiming no ambulation data of
 * any kind would be false against its own Observations, and would send
 * a receiver back to the patient for something the document measured.
 */
export const INSTRUMENT_OMISSION_REASON_ZH =
  '本平台采集 Brooke 上肢功能分级与 Vignos 下肢功能分级（见 /me/instruments），但这两项尚未接入本导出所读取的档案结构，因此本次导出不含任何分级数值、施测时间或量表版本。这是导出管线的缺口，不表示患者没有做过分级——在本记录的全部内容里，这两项通常是唯一可跨患者比较的运动功能测量，需要时请直接向患者索取。';

/**
 * @param ambulationNoteZh What THIS format does with the walking state
 *   a Vignos sync writes into the baseline, stated in that format's
 *   own vocabulary (envelope.ts:24). Required rather than optional: a
 *   fourth serialiser must not be able to inherit another format's
 *   answer by leaving the argument out.
 */
export const instrumentOmission = (field: string, ambulationNoteZh: string): ExportOmission => ({
  field,
  reasonZh: `${INSTRUMENT_OMISSION_REASON_ZH}${ambulationNoteZh}`,
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A stable UUID for a resource that has no row of its own (the FHIR
 * Composition, the Bundle itself).
 *
 * Version nibble 8, variant 10 — RFC 9562 UUIDv8, which is the
 * version reserved for vendor-defined layouts. Deliberately NOT
 * version 4: a v4 UUID asserts randomness, and this one is a SHA-256
 * of its inputs and will repeat exactly for the same inputs. Claiming
 * v4 here would be a small lie told in a field nobody reads, which is
 * the kind that survives longest.
 */
export const deterministicUuid = (seed: string): string => {
  const hex = createHash('sha256').update(seed).digest('hex');
  const version = '8';
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    version + hex.slice(13, 16),
    variant + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join('-');
};

/** Row ids are already UUIDs in production; test doubles are not. */
export const resourceUuid = (id: string, kind: string): string =>
  UUID_RE.test(id) ? id.toLowerCase() : deterministicUuid(`${kind}:${id}`);
