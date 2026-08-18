/**
 * WHAT A TOOL DESCRIPTION MAY NAME.
 *
 * A description is an instruction: the model asserts what it was told
 * the result carries. `get_my_profile` opened on an age band and closed
 * on symptom categories and the pipeline could produce neither — the
 * birthday is hard-deleted before anything could band it, and no
 * retriever writes a symptom field at all. Both were listed on
 * PROMPT_ALLOWLIST and both had a label in SCOPE_LABELS, which is how
 * they reached the sentence: those two lists read as an inventory of
 * what a result carries, and whoever wrote the sentence read them.
 *
 * Nothing here reasons about a path. Each check runs the real retriever
 * over a maximally populated row and the real redactor over what comes
 * out, in both modes, and asks what is left:
 *
 *   - every key on either allowlist survives for some real input, so
 *     the inventory cannot advertise a field no result can carry;
 *   - every label in SCOPE_LABELS names such a key, for the same
 *     reason;
 *   - every promise a description makes is written down here beside the
 *     key that has to carry it, and that key is one of those.
 *
 * The last one fails two ways on purpose. Delete the plumbing and the
 * key stops being reachable; reword the description and the phrase
 * stops matching, which sends whoever reworded it back through the
 * reachability question rather than around it.
 */

import type { Pool, QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { ITool } from './base.js';
import { GetMyProfileTool } from './get-my-profile.js';
import { GetMyRecordsTool } from './get-my-records.js';
import { GetMyReportsTool } from './get-my-reports.js';
import { ListClinicalTrialsTool } from './list-clinical-trials.js';
import type { TrialRecord, TrialSourceStatus } from '../../trials/trials.service.js';
import type { RetrieveContext, RetrieveResult } from '../retrievers/base.js';
import { ClinicalTrialsRetriever } from '../retrievers/clinical-trials.js';
import { PatientFollowupRetriever } from '../retrievers/patient-followups.js';
import { PatientProfileRetriever } from '../retrievers/patient-profile.js';
import { PatientReportsRetriever } from '../retrievers/patient-reports.js';
import type { RedactionMode, RedactionScope } from '../security/allowlist.js';
import { PROMPT_ALLOWLIST } from '../security/allowlist.js';
import { GENETIC_READING_REFUSALS, redactFields } from '../security/pii-redactor.js';
import { SCOPE_LABELS, renderChunkForPrompt } from '../security/render.js';

const snapshotMock = vi.fn();

vi.mock('../../trials/trials.service.js', async () => {
  const actual = await vi.importActual<typeof import('../../trials/trials.service.js')>(
    '../../trials/trials.service.js',
  );
  return { ...actual, readTrialSnapshot: (...args: unknown[]) => snapshotMock(...args) };
});

const silentLogger = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child: () => silentLogger,
} as unknown as RetrieveContext['logger'];

const ctx: RetrieveContext = {
  userId: 'user-1',
  consentLevel: 'precise',
  requestId: 'req-1',
  logger: silentLogger,
};

const MODES: readonly RedactionMode[] = ['strict', 'precise'];

const daysAgoIso = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

const poolReturning = (...resultsInOrder: unknown[][]) => {
  const query = vi.fn();
  for (const rows of resultsInOrder) {
    query.mockResolvedValueOnce({ rows, rowCount: rows.length } as unknown as QueryResult);
  }
  return { query } as unknown as Pool;
};

/**
 * A profile with every cell the retriever knows how to read filled in.
 * Same shape as the fixture in patient-profile.test.ts.
 */
const PROFILE_ROW = {
  id: 'profile-1',
  full_name: '张三',
  date_of_birth: '1990-04-15',
  gender: 'female',
  diagnosis_stage: 'confirmed',
  diagnosis_date: '2023-06-01',
  genetic_mutation: 'FSHD1',
  region_province: '北京',
  region_city: '北京',
  region_district: '海淀',
  baseline_payload: {
    foundation: { diagnosisYear: 2023 },
    diseaseBackground: {
      diagnosisType: 'FSHD1',
      d4z4: '3/22',
      haplotype: '4qA',
      methylation: '12%',
      onsetRegion: '肩胛带',
      familyHistory: '母亲疑似',
    },
    currentStatus: {
      independentlyAmbulatory: 'assisted',
      assistiveDevices: ['踝足矫形器'],
    },
  },
  notes: '门诊记录',
};

/**
 * The same profile with the methylation cell in its other shape. The
 * cell reaches a different key per shape and neither is optional: a
 * measurement is withheld under `methylation_withheld`, the
 * laboratory's own word survives strict mode as `methylation`. One row
 * can only ever demonstrate one of them, and「reachable for some real
 * input」is the claim this file checks.
 */
const PROFILE_ROW_QUALITATIVE_METHYLATION = {
  ...PROFILE_ROW,
  baseline_payload: {
    ...PROFILE_ROW.baseline_payload,
    diseaseBackground: {
      ...PROFILE_ROW.baseline_payload.diseaseBackground,
      methylation: '未检出',
    },
  },
};

/**
 * The profile whose archived genetics cells this platform DID read off
 * the laboratory's own report — the autofill's ordinary outcome, and
 * the state in which `d4z4_clinical` and `haplotype_clinical` hold a
 * reading rather than a refusal.
 *
 * Reachability is the claim this file checks, and with the laboratory
 * gate hardcoded `false` these two keys were reachable holding exactly
 * one value — `not_read_off_a_laboratory_report` — while their labels
 * said 临床分级. A row with no evidence document can never demonstrate
 * the other half.
 */
const PROFILE_ROW_FROM_REPORT = {
  ...PROFILE_ROW,
  baseline_payload: {
    ...PROFILE_ROW.baseline_payload,
    diseaseBackground: {
      ...PROFILE_ROW.baseline_payload.diseaseBackground,
      d4z4: '9',
      haplotype: '4qA',
    },
  },
};

/** The genetics report those two cells were autofilled out of. */
const GENETIC_DOCUMENT_ROWS = [
  {
    id: 'doc-genetics',
    document_type: 'genetic_report',
    status: 'parsed',
    uploaded_at: '2026-01-05T00:00:00Z',
    ocr_payload: {
      fields: { classifiedType: 'genetic_report', d4z4Repeats: '9', haplotype: '4qA' },
    },
  },
];

/**
 * A methylation cell holding something that is not a value.
 *
 * `formatScalar` would have joined it into 「甲基化值: 35、40」 and
 * published it as this patient's result; it takes the withheld channel
 * in both modes instead, which is what makes `methylation_withheld`
 * reachable under precise consent at all.
 */
const PROFILE_ROW_ARRAY_METHYLATION = {
  ...PROFILE_ROW,
  baseline_payload: {
    ...PROFILE_ROW.baseline_payload,
    diseaseBackground: {
      ...PROFILE_ROW.baseline_payload.diseaseBackground,
      methylation: ['35', '40'],
    },
  },
};

/** A report whose OCR payload carries genetics cells, a lab value and a
 *  narrative the findings vocabulary recognises. */
const REPORT_ROW = {
  id: 'doc-1',
  document_type: 'genetic_report',
  title: '张三的基因检测报告',
  uploaded_at: '2026-04-01T08:00:00Z',
  status: 'processed',
  classified_type: 'genetic_report',
  ocr_payload: {
    fields: {
      classifiedType: 'genetic_report',
      d4z4Repeats: '3/22',
      haplotype: '4qA',
      methylationValue: '12%',
      ck: '320',
      reportImpression: '双侧大腿肌肉脂肪浸润',
      patientName: '张三',
    },
  },
};

/**
 * The same report with the laboratory's own date on it.
 *
 * Two rows for the same reason the profile needs two: 报告年份 and
 * 上传年份 are different cells and one row can only ever demonstrate
 * one of them. A row whose OCR carries `reportTime` reaches
 * `reportDate_year`; the row above, which carries none, reaches
 * `uploadYear`. Before they were separated, one key held both and the
 * prompt dated a 2019 report to the year it was uploaded.
 */
const REPORT_ROW_WITH_REPORT_DATE = {
  ...REPORT_ROW,
  id: 'doc-2',
  ocr_payload: {
    fields: { ...REPORT_ROW.ocr_payload.fields, reportTime: '2019-03-14' },
  },
};

/** One series with readings, one metric whose only rows are 「做不到」,
 *  and a fall — between them every followup field the retriever can
 *  write. */
const SERIES_ROWS = [
  { metric_key: 'stair_climb', unit: 'sec', value: '12', recorded_at: daysAgoIso(14) },
  { metric_key: 'stair_climb', unit: 'sec', value: '16', recorded_at: daysAgoIso(0) },
];
const EVENT_ROWS = [{ event_type: 'fall', severity: 'mild', occurred_at: daysAgoIso(3) }];
const UNABLE_ROWS = [{ metric_key: 'stair_climb', unable_count: 2, most_recent_days: 5 }];

/**
 * Every chunk this test reasons over: one retriever run per fixture,
 * with the second query each retriever makes stubbed alongside the
 * first.
 *
 * The profile scope needs four rows because four different cells can
 * only ever be demonstrated one at a time — a measured methylation
 * value, the laboratory's own word for one, a genetics cell this
 * platform DID read off a laboratory report, and a methylation cell
 * holding something that is not a value at all.
 */
const chunksByScope = async (): Promise<Record<RedactionScope, RetrieveResult['chunks']>> => {
  const profileChunks = async (
    row: unknown,
    documents: unknown[],
  ): Promise<RetrieveResult['chunks']> =>
    (
      await new PatientProfileRetriever(poolReturning([row], documents)).search(
        { question: '' },
        ctx,
      )
    ).chunks;
  const reportChunks = async (row: unknown): Promise<RetrieveResult['chunks']> =>
    (await new PatientReportsRetriever(poolReturning([row])).search({ question: '' }, ctx)).chunks;

  return {
    profile: [
      ...(await profileChunks(PROFILE_ROW, [])),
      ...(await profileChunks(PROFILE_ROW_QUALITATIVE_METHYLATION, [])),
      ...(await profileChunks(PROFILE_ROW_FROM_REPORT, GENETIC_DOCUMENT_ROWS)),
      ...(await profileChunks(PROFILE_ROW_ARRAY_METHYLATION, [])),
    ],
    reports: [
      ...(await reportChunks(REPORT_ROW)),
      ...(await reportChunks(REPORT_ROW_WITH_REPORT_DATE)),
    ],
    followups: (
      await new PatientFollowupRetriever(
        poolReturning(SERIES_ROWS, EVENT_ROWS, UNABLE_ROWS),
      ).search({ question: '' }, ctx)
    ).chunks,
  };
};

/**
 * Every field key that survives redaction for a maximally populated
 * patient, per scope and mode. Because layer 3 drops anything off the
 * allowlist, this is exactly the intersection of what a retriever can
 * write with what the mode permits — which is what a description is
 * allowed to name.
 */
const reachableFields = async (): Promise<
  Record<RedactionScope, Record<RedactionMode, Set<string>>>
> => {
  const chunks = await chunksByScope();
  const out = {} as Record<RedactionScope, Record<RedactionMode, Set<string>>>;
  for (const scope of Object.keys(chunks) as RedactionScope[]) {
    out[scope] = { strict: new Set<string>(), precise: new Set<string>() };
    for (const chunk of chunks[scope]) {
      const raw = chunk.metadata?.fields;
      if (!raw || typeof raw !== 'object') continue;
      for (const mode of MODES) {
        const { fields } = redactFields(raw as Record<string, unknown>, { scope, mode });
        for (const key of Object.keys(fields)) out[scope][mode].add(key);
      }
    }
  }
  return out;
};

/**
 * Every VALUE each key is reachable holding, across both modes.
 *
 * The keys alone answer 「can a result carry this field」. They cannot
 * answer 「does this field ever hold what its label says it holds」,
 * which is the question `PROFILE_FIELD_LABELS` got wrong twice:
 * 甲基化临床分级 was deleted after it turned out to hold a consent
 * statement, and 「D4Z4 临床分级」 / 「单倍型临床分级」 survived over two
 * keys that — with the laboratory gate hardcoded false — could hold
 * nothing but `not_read_off_a_laboratory_report`.
 */
const reachableValues = async (): Promise<Record<RedactionScope, Map<string, Set<string>>>> => {
  const chunks = await chunksByScope();
  const out = {} as Record<RedactionScope, Map<string, Set<string>>>;
  for (const scope of Object.keys(chunks) as RedactionScope[]) {
    out[scope] = new Map<string, Set<string>>();
    for (const chunk of chunks[scope]) {
      const raw = chunk.metadata?.fields;
      if (!raw || typeof raw !== 'object') continue;
      for (const mode of MODES) {
        const { fields } = redactFields(raw as Record<string, unknown>, { scope, mode });
        for (const [key, value] of Object.entries(fields)) {
          const seen = out[scope].get(key) ?? new Set<string>();
          seen.add(String(value));
          out[scope].set(key, seen);
        }
      }
    }
  }
  return out;
};

const bothModes = (reachable: Record<RedactionMode, Set<string>>): Set<string> =>
  new Set([...reachable.strict, ...reachable.precise]);

/**
 * What each description claims, and the keys that have to carry it.
 * `says` is matched against the description verbatim.
 */
interface Promised {
  says: string;
  carriedBy: readonly string[];
  /**
   * THE MODES THIS CLAUSE SAYS ITS KEYS APPEAR IN — and, taken with
   * every other clause naming the same key, the ONLY modes they may
   * appear in.
   *
   * The reachability question used to be asked of `bothModes(...)` — a
   * UNION — for every clause alike, and a union cannot falsify a claim
   * about one mode. `get_my_profile` said a methylation measurement is
   * 「withheld without precise-value consent」 while the handler renders
   * `methylation_withheld` under precise consent too, for any cell it
   * cannot read as a single value (the redactor documents that refusal
   * as deliberate). The key is reachable in strict, the union contained
   * it, and the sentence passed — leaving the model, which obeys the
   * sentence, to read a precise-consent 「value_withheld」 as a value
   * hidden from it rather than one this platform could not read.
   *
   * So reachability alone is not the test. The declared modes for a key
   * must EQUAL the modes it is reachable in: a clause that says
   * 「without precise-value consent」 and nothing else claims the key is
   * a strict-mode thing, and a key that also turns up under precise
   * consent falsifies it. Two clauses may share a key — that is how one
   * sentence states a consent rule and its exception — and it is their
   * union that has to match.
   *
   * Absent, the plain union check stands, and that is the right
   * question for a clause naming no level: 「the raw value, or both,
   * depending on consent」 asserts nothing about WHICH mode carries
   * which, so demanding the raw cell in strict would fail an honest
   * sentence. Naming a level is what moves a clause onto this check.
   */
  inModes?: readonly RedactionMode[];
}

const profileTool = new GetMyProfileTool({} as unknown as PatientProfileRetriever);
const recordsTool = new GetMyRecordsTool({} as unknown as PatientFollowupRetriever);
const reportsTool = new GetMyReportsTool({} as unknown as PatientReportsRetriever);

const PROMISES: readonly { tool: ITool; scope: RedactionScope; promises: Promised[] }[] = [
  {
    tool: profileTool,
    scope: 'profile',
    promises: [
      { says: 'gender', carriedBy: ['gender'] },
      {
        says: 'diagnosis stage / year / type',
        carriedBy: ['diagnosisStage', 'diagnosisYear', 'diagnosisType'],
      },
      {
        says: "D4Z4 / haplotype (this platform's reading of the cell, the raw value, or both, depending on consent)",
        carriedBy: ['d4z4', 'd4z4_clinical', 'haplotype', 'haplotype_clinical'],
      },
      {
        says:
          'methylation (the cell as recorded, never graded — this platform states no ' +
          'methylation boundary;',
        carriedBy: ['methylation'],
      },
      // The two halves of the withholding rule, each checked against
      // the mode it names. Together they are the sentence; apart they
      // are two claims, and the second one is the one the union hid.
      {
        says: 'a measurement is withheld without precise-value consent',
        carriedBy: ['methylation_withheld'],
        inModes: ['strict'],
      },
      {
        says:
          'a cell this platform cannot read as a single value is withheld whatever ' +
          'the consent',
        carriedBy: ['methylation_withheld'],
        inModes: ['strict', 'precise'],
      },
      { says: 'onset region', carriedBy: ['onsetRegion'] },
      { says: 'family history', carriedBy: ['familyHistory'] },
      { says: 'ambulatory status', carriedBy: ['independentlyAmbulatory'] },
      { says: 'assistive devices', carriedBy: ['assistiveDevices'] },
    ],
  },
  {
    tool: recordsTool,
    scope: 'followups',
    promises: [
      {
        says: 'tracked metrics such as stair climb and sleep quality',
        carriedBy: ['metricKey', 'metricLabel'],
      },
      { says: 'how many readings', carriedBy: ['count'] },
      { says: 'over how many days', carriedBy: ['spanDays'] },
      { says: 'which direction they moved', carriedBy: ['changeDirection'] },
      {
        says: 'a tally of logged events such as falls',
        carriedBy: ['eventSummary', 'eventCount'],
      },
    ],
  },
  {
    tool: reportsTool,
    scope: 'reports',
    promises: [
      { says: 'a classified type', carriedBy: ['classifiedType'] },
      { says: 'document type', carriedBy: ['documentType'] },
      {
        says: 'the report year when the report itself states one — otherwise the year it was uploaded, which is not the same thing',
        carriedBy: ['reportDate_year', 'uploadYear'],
      },
      { says: 'structured OCR fields', carriedBy: ['fields', 'fields_clinical'] },
    ],
  },
];

describe('tool descriptions name only fields the result can carry', () => {
  it('PROMPT_ALLOWLIST advertises no field a retriever cannot produce', async () => {
    const reachable = await reachableFields();
    const dead: string[] = [];
    for (const scope of Object.keys(PROMPT_ALLOWLIST) as RedactionScope[]) {
      for (const mode of MODES) {
        for (const key of PROMPT_ALLOWLIST[scope][mode]) {
          if (!reachable[scope][mode].has(key)) dead.push(`${scope}.${mode}.${key}`);
        }
      }
    }
    // A key here is one a description can be written from and no
    // patient can ever satisfy — `ageGroup` and `symptomCategories`
    // were both, and both reached get_my_profile's description.
    expect(dead).toEqual([]);
  });

  /**
   * THE REVERSE OF THE CHECK BELOW, WHICH IS THE ONE THAT WAS MISSING.
   *
   * 「every label names a reachable key」 and 「every reachable key has a
   * label」 are two claims, and only the first was asked. So
   * `methylation_origin` went onto both profile allowlists, became
   * reachable in both modes, and had no entry in `PROFILE_FIELD_LABELS`
   * — and `renderFieldsByScope` falls back to the raw key, so an
   * otherwise fully-labelled Chinese block printed
   *「methylation_origin: not_read_off_a_laboratory_report」. The row
   * carrying this platform's refusal to attribute the FSHD2
   * discriminator read as engineering leftover rather than as a caveat.
   *
   * `fields` and `fields_clinical` are the two exemptions and they are
   * exempt structurally, not by fiat: `renderFieldsByScope` gives the
   * OCR blob a block of its own under 「OCR 字段」 and never looks either
   * key up in the label table. That is asserted here rather than
   * assumed, so the exemption cannot outlive the rendering it describes.
   */
  const RENDERED_AS_THEIR_OWN_BLOCK: ReadonlySet<string> = new Set(['fields', 'fields_clinical']);

  it('SCOPE_LABELS labels every field a result can carry', async () => {
    const reachable = await reachableFields();
    const unlabelled: string[] = [];
    for (const scope of Object.keys(SCOPE_LABELS) as RedactionScope[]) {
      for (const key of bothModes(reachable[scope])) {
        if (RENDERED_AS_THEIR_OWN_BLOCK.has(key)) continue;
        if (!SCOPE_LABELS[scope][key]) unlabelled.push(`${scope}.${key}`);
      }
    }
    expect(unlabelled).toEqual([]);
  });

  it('renders the exempt keys as a block of their own rather than by label', async () => {
    const chunks = await chunksByScope();
    for (const mode of MODES) {
      const rendered = renderChunkForPrompt(chunks.reports[0], { mode });
      expect(rendered.content).toContain('OCR 字段');
      // The key itself is never printed — which is what makes it exempt
      // from needing a label, and is false the moment that changes.
      for (const key of RENDERED_AS_THEIR_OWN_BLOCK) {
        expect(rendered.content).not.toContain(`${key}:`);
      }
    }
  });

  it('SCOPE_LABELS has a label for no field a retriever cannot produce', async () => {
    const reachable = await reachableFields();
    const dead: string[] = [];
    for (const scope of Object.keys(SCOPE_LABELS) as RedactionScope[]) {
      const usable = bothModes(reachable[scope]);
      for (const key of Object.keys(SCOPE_LABELS[scope])) {
        if (!usable.has(key)) dead.push(`${scope}.${key}`);
      }
    }
    expect(dead).toEqual([]);
  });

  /**
   * A LABEL THAT CLAIMS A GRADE MUST NAME A KEY THAT CAN HOLD ONE.
   *
   * This is the check that stops the next 甲基化临床分级. That label was
   * deleted after the band behind it was — the key survived holding
   * `value_withheld` and the laboratory's own qualitative word, both
   * printed to the model as this platform's grading of the FSHD2
   * discriminator. The same table then kept 「D4Z4 临床分级」 and
   * 「单倍型临床分级」 over two keys which, with the laboratory gate
   * hardcoded false, could only ever hold
   * `not_read_off_a_laboratory_report`.
   *
   * The question is asked of the VALUES, not of the plumbing: a key
   * whose every reachable value is one of the redactor's own refusals
   * (`GENETIC_READING_REFUSALS`) grades nothing, whatever its label
   * says.
   */
  it('no label claims a 分级 for a key whose values are all refusals', async () => {
    const values = await reachableValues();
    const overclaimed: string[] = [];
    for (const scope of Object.keys(SCOPE_LABELS) as RedactionScope[]) {
      for (const [key, label] of Object.entries(SCOPE_LABELS[scope])) {
        if (!label.includes('分级')) continue;
        const seen = values[scope].get(key) ?? new Set<string>();
        const gradesSomething = [...seen].some((value) => !GENETIC_READING_REFUSALS.has(value));
        if (!gradesSomething) overclaimed.push(`${scope}.${key} 「${label}」`);
      }
    }
    expect(overclaimed).toEqual([]);
  });

  it('the genetics readings are labelled as readings and not as grades', async () => {
    // The finding above, pinned from the other side: both keys DO
    // reach a real reading now (the laboratory gate is asked rather
    // than hardcoded), and both also reach a refusal — so neither
    // label may say 分级 over a cell this platform declined to read.
    const values = await reachableValues();
    for (const key of ['d4z4_clinical', 'haplotype_clinical']) {
      const seen = values.profile.get(key) ?? new Set<string>();
      expect([...seen].some((value) => GENETIC_READING_REFUSALS.has(value))).toBe(true);
      expect([...seen].some((value) => !GENETIC_READING_REFUSALS.has(value))).toBe(true);
      expect(SCOPE_LABELS.profile[key]).not.toContain('分级');
    }
  });

  it('every promise in a description is spelled out and reachable', async () => {
    const reachable = await reachableFields();
    const broken: string[] = [];
    for (const { tool, scope, promises } of PROMISES) {
      const usable = bothModes(reachable[scope]);
      /** Every mode any clause on this tool claims a key appears in.
       *  Checked as a set against the modes the key is really
       *  reachable in — see `Promised.inModes`. */
      const declaredModes = new Map<string, Set<RedactionMode>>();
      for (const { says, carriedBy, inModes } of promises) {
        if (!tool.description.includes(says)) {
          broken.push(`${tool.name}: description no longer says 「${says}」`);
          continue;
        }
        for (const key of carriedBy) {
          if (inModes) {
            const declared = declaredModes.get(key) ?? new Set<RedactionMode>();
            for (const mode of inModes) declared.add(mode);
            declaredModes.set(key, declared);
            continue;
          }
          if (!usable.has(key)) broken.push(`${tool.name}: 「${says}」 needs ${key}`);
        }
      }
      for (const [key, declared] of declaredModes) {
        for (const mode of MODES) {
          const claimed = declared.has(mode);
          const real = reachable[scope][mode].has(key);
          if (claimed && !real) {
            broken.push(`${tool.name}: description claims ${key} in ${mode} mode; unreachable`);
          }
          if (!claimed && real) {
            // The direction the union could not see. A sentence that
            // conditions a key on one consent level, over a key the
            // handler also emits under the other, is an instruction
            // the handler does not follow.
            broken.push(`${tool.name}: ${key} is reachable in ${mode} mode; description omits it`);
          }
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('the profile description promises neither an age band nor symptoms', () => {
    // The two the pipeline cannot produce. Named here as well as caught
    // structurally above, because this is the sentence a model obeys.
    expect(profileTool.description).not.toMatch(/age band|年龄段/);
    expect(profileTool.description).not.toMatch(/symptom|症状/);
  });

  it('the reports description promises no date beyond the year', () => {
    // `clinicalise` drops `reportDate` in both modes; the year is the
    // only form either allowlist carries.
    expect(reportsTool.description).not.toMatch(/full date/);
  });
});

describe('list_clinical_trials names only what a rendered record carries', () => {
  const TRIAL: TrialRecord = {
    source: 'ctgov',
    sourceId: 'NCT01000001',
    title: 'A study of losmapimod in FSHD',
    statusRaw: 'RECRUITING',
    statusZh: '招募中',
    phase: 'PHASE2',
    sponsor: 'Fulcrum Therapeutics',
    countries: ['United States'],
    url: 'https://clinicaltrials.gov/study/NCT01000001',
    sourceUpdatedAt: '2026-08-01',
    fetchedAt: '2026-08-14T04:00:07Z',
  };

  const SOURCES: TrialSourceStatus[] = [
    {
      source: 'ctgov',
      recordCount: 1,
      fetchedAt: '2026-08-14T04:00:07Z',
      lastRun: { startedAt: '2026-08-14T04:00:00Z', finishedAt: '2026-08-14T04:00:09Z', ok: true },
      lastSuccessAt: '2026-08-14T04:00:09Z',
    },
    {
      source: 'chinadrugtrials',
      recordCount: 0,
      fetchedAt: null,
      lastRun: null,
      lastSuccessAt: null,
    },
  ];

  it('renders every item the description promises', async () => {
    snapshotMock.mockResolvedValue({ trials: [TRIAL], sources: SOURCES });
    const tool = new ListClinicalTrialsTool(
      new ClinicalTrialsRetriever({} as unknown as Pool),
    ) as ITool;
    const result = await tool.execute(tool.parseArgs('{}'), {
      userId: 'user-1',
      consentLevel: 'basic',
      logger: silentLogger,
    });

    const rendered = result.retrieval.chunks[0].content;
    // The description's list on the left, the line `renderTrial` writes
    // on the right. A record that stops carrying one of these is a
    // sentence the model will assert anyway.
    const promisedLines: readonly [string, string][] = [
      ['每条都写明来自哪个登记库', '登记库：'],
      ['登记号', '登记号：'],
      ['状态', '状态（登记库原词）：'],
      ['期别', '期别：'],
      ['申办方', '申办方：'],
      ['国家', '国家/地区：'],
      ['登记库最后更新日期', '登记库最后更新：'],
      ['本平台读取时间', '本平台读取时间：'],
      ['链接', '链接：'],
    ];
    for (const [says, line] of promisedLines) {
      expect(tool.description).toContain(says);
      expect(rendered).toContain(line);
    }
  });

  it('renders no eligibility criteria and no result, as the description says it will not', async () => {
    snapshotMock.mockResolvedValue({ trials: [TRIAL], sources: SOURCES });
    const tool = new ListClinicalTrialsTool(
      new ClinicalTrialsRetriever({} as unknown as Pool),
    ) as ITool;
    const result = await tool.execute(tool.parseArgs('{}'), {
      userId: 'user-1',
      consentLevel: 'basic',
      logger: silentLogger,
    });

    expect(tool.description).toContain('本工具不提供入组标准，也不提供试验结果或疗效结论');
    expect(result.retrieval.chunks[0].content).not.toMatch(/入组|排除标准|疗效|结论/);
  });
});
