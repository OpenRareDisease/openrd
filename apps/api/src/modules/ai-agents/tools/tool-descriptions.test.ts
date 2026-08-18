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
import { redactFields } from '../security/pii-redactor.js';
import { SCOPE_LABELS } from '../security/render.js';

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
 * Every field key that survives redaction for a maximally populated
 * patient, per scope and mode. Because layer 3 drops anything off the
 * allowlist, this is exactly the intersection of what a retriever can
 * write with what the mode permits — which is what a description is
 * allowed to name.
 */
const reachableFields = async (): Promise<
  Record<RedactionScope, Record<RedactionMode, Set<string>>>
> => {
  const chunksByScope: Record<RedactionScope, RetrieveResult['chunks']> = {
    profile: [
      ...(
        await new PatientProfileRetriever(poolReturning([PROFILE_ROW])).search(
          { question: '' },
          ctx,
        )
      ).chunks,
      ...(
        await new PatientProfileRetriever(
          poolReturning([PROFILE_ROW_QUALITATIVE_METHYLATION]),
        ).search({ question: '' }, ctx)
      ).chunks,
    ],
    reports: (
      await new PatientReportsRetriever(poolReturning([REPORT_ROW])).search({ question: '' }, ctx)
    ).chunks,
    followups: (
      await new PatientFollowupRetriever(
        poolReturning(SERIES_ROWS, EVENT_ROWS, UNABLE_ROWS),
      ).search({ question: '' }, ctx)
    ).chunks,
  };

  const out = {} as Record<RedactionScope, Record<RedactionMode, Set<string>>>;
  for (const scope of Object.keys(chunksByScope) as RedactionScope[]) {
    out[scope] = { strict: new Set<string>(), precise: new Set<string>() };
    for (const chunk of chunksByScope[scope]) {
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

const bothModes = (reachable: Record<RedactionMode, Set<string>>): Set<string> =>
  new Set([...reachable.strict, ...reachable.precise]);

/**
 * What each description claims, and the keys that have to carry it.
 * `says` is matched against the description verbatim.
 */
interface Promised {
  says: string;
  carriedBy: readonly string[];
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
        says: 'methylation (the cell as recorded, never graded — this platform states no methylation boundary; a numeric result is withheld without precise-value consent)',
        carriedBy: ['methylation', 'methylation_withheld'],
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
      { says: 'report year', carriedBy: ['reportDate_year'] },
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

  it('every promise in a description is spelled out and reachable', async () => {
    const reachable = await reachableFields();
    const broken: string[] = [];
    for (const { tool, scope, promises } of PROMISES) {
      const usable = bothModes(reachable[scope]);
      for (const { says, carriedBy } of promises) {
        if (!tool.description.includes(says)) {
          broken.push(`${tool.name}: description no longer says 「${says}」`);
          continue;
        }
        for (const key of carriedBy) {
          if (!usable.has(key)) broken.push(`${tool.name}: 「${says}」 needs ${key}`);
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
