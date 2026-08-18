/**
 * Integration tests for the privacy boundary fix landed in PR #23
 * review.
 *
 * These tests compose a real `PatientProfileRetriever` /
 * `PatientReportsRetriever` (with a mocked pool) and run their output
 * through `renderChunkForPrompt`, then assert that strict-mode prompt
 * text cannot contain raw patient values. This is the **regression
 * fence** for the "raw values land in the prompt via chunk.content"
 * bug that the reviewer flagged.
 */

import type { Pool, QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { renderChunkForPrompt } from './render.js';
import type { RetrieveContext, RetrievedChunk } from '../retrievers/base.js';
import { PatientFollowupRetriever } from '../retrievers/patient-followups.js';
import { PatientProfileRetriever } from '../retrievers/patient-profile.js';
import { PatientReportsRetriever } from '../retrievers/patient-reports.js';

const silentLogger = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child() {
    return silentLogger;
  },
};

const makeCtx = (overrides: Partial<RetrieveContext> = {}): RetrieveContext => ({
  userId: 'user-1',
  consentLevel: 'basic',
  requestId: 'req-1',
  logger: silentLogger as unknown as RetrieveContext['logger'],
  ...overrides,
});

const fakePool = (rows: unknown[]) =>
  ({
    query: vi.fn().mockResolvedValue({
      rows,
      rowCount: rows.length,
    } as unknown as QueryResult),
  }) as unknown as Pool;

/** The followup retriever issues two queries — the metric UNION first,
 *  then the event tally — so it needs an ordered pool rather than the
 *  single-answer one the other two retrievers get. */
const sequencedPool = (
  seriesRows: unknown[],
  eventRows: unknown[] = [],
  unableRows: unknown[] = [],
) => {
  const answer = (rows: unknown[]) => ({ rows, rowCount: rows.length }) as unknown as QueryResult;
  return {
    query: vi
      .fn()
      .mockResolvedValueOnce(answer(seriesRows))
      .mockResolvedValueOnce(answer(eventRows))
      // Third query: 「做不到」 counts (migration 017). Defaulting to
      // empty keeps the existing fences describing a plain series.
      .mockResolvedValueOnce(answer(unableRows)),
  } as unknown as Pool;
};

const daysAgoIso = (days: number) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

const PROFILE_ROW = {
  id: 'profile-1',
  full_name: '张三',
  date_of_birth: '1990-04-15',
  gender: 'female',
  diagnosis_stage: 'confirmed',
  diagnosis_date: '2023-06-01',
  genetic_mutation: 'FSHD1 inferred from D4Z4 contraction at 4q35',
  region_province: '北京',
  region_city: '北京',
  region_district: '海淀',
  baseline_payload: {
    foundation: { diagnosisYear: 2023, regionLabel: '北京 / 海淀' },
    diseaseBackground: {
      diagnosisType: 'FSHD1',
      d4z4: '3/22',
      haplotype: '4qA',
      methylation: '12%',
      onsetRegion: '肩胛带',
      familyHistory: '母亲疑似',
    },
    currentStatus: {
      independentlyAmbulatory: 'unable',
      assistiveDevices: ['AFO'],
    },
  },
  notes: '私人备注：联系医生李四，电话 13812345678',
};

/** The same profile with the walking state swapped, for the cases where
 *  the state itself is what is under test. */
const ambulationRow = (state: string) => ({
  ...PROFILE_ROW,
  baseline_payload: {
    ...PROFILE_ROW.baseline_payload,
    currentStatus: {
      ...PROFILE_ROW.baseline_payload.currentStatus,
      independentlyAmbulatory: state,
    },
  },
});

const ASSISTED_PROFILE_ROW = ambulationRow('assisted');

/** The one prompt line the model reads the walking state off. */
const ambulationLine = (content: string): string | undefined =>
  content.split('\n').find((line) => line.startsWith('行走能力:'));

const REPORT_ROWS = [
  {
    id: 'doc-1',
    document_type: 'genetic_report',
    title: '张三的基因检测报告 - 2023年6月',
    uploaded_at: '2026-04-01T08:00:00Z',
    status: 'processed',
    ocr_payload: {
      fields: {
        classifiedType: 'genetic_report',
        diagnosisType: 'FSHD1',
        d4z4Repeats: '3/22',
        haplotype: '4qA',
        methylationValue: '12%',
        patientName: '张三',
        patientId: '11010119900520XXXX',
        reportIssueDate: '2023-06-01',
        rawFreeText: '患者张三，男，身份证 110101199005203XXX，电话 138-1234-5678',
      },
    },
    classified_type: 'genetic_report',
  },
  {
    id: 'doc-2',
    document_type: 'mri',
    title: '大腿 MRI - 张三',
    uploaded_at: '2026-03-15T10:00:00Z',
    status: 'processed',
    ocr_payload: {
      fields: {
        classifiedType: 'mri',
        findings:
          '受检者张三，右大腿后群 STIR 信号显著增高，左大腿后群轻度增高。患者电话 13812345678。',
      },
    },
    classified_type: 'mri',
  },
];

const RAW_LEAK_PROBES = [
  '张三', // patient name
  '3/22', // raw D4Z4 repeat count
  '12%', // raw methylation percentage
  '4qA', // raw haplotype
  '2023-06-01', // raw exact date
  '1990-04-15', // raw DOB
  '13812345678', // phone number
  '110101199005203', // ID card prefix
  '110101199005203XXX', // ID card
  'STIR', // free-text OCR finding excerpt
  '海淀', // district-level address
  '李四', // free-text inside notes
  '张三的基因检测报告', // user-named report title
  'FSHD1 inferred from D4Z4 contraction at 4q35', // free-text genetic_mutation
];

const assertNoLeak = (text: string): void => {
  for (const probe of RAW_LEAK_PROBES) {
    expect(text).not.toContain(probe);
  }
};

describe('renderChunkForPrompt — patient profile, strict mode (regression fence)', () => {
  it('strips raw D4Z4 / methylation / haplotype / dates / names from prompt text', async () => {
    const retriever = new PatientProfileRetriever(fakePool([PROFILE_ROW]));
    const result = await retriever.search({ question: 'tell me about me' }, makeCtx());
    const rendered = renderChunkForPrompt(result.chunks[0], { mode: 'strict' });

    assertNoLeak(rendered.content);

    // Clinicalised forms should be present so the LLM still has
    // something clinical to talk about. What each one may claim is
    // pii-redactor.test.ts's subject; this scope's genetics cells are
    // the registration form's own boxes, so neither of them is banded.
    expect(rendered.content).toContain('not_read_off_a_laboratory_report');
    expect(rendered.content).toContain('value_withheld');
    expect(rendered.content).toContain('2023'); // diagnosisYear from foundation is allowed.

    // fieldsUsed feeds the audit log; sanity check it does not name
    // any hard-deleted key.
    expect(rendered.fieldsUsed).not.toContain('fullName');
    expect(rendered.fieldsUsed).not.toContain('regionDistrict');
    expect(rendered.fieldsUsed).not.toContain('notes');
    expect(rendered.fieldsUsed).not.toContain('d4z4');
    expect(rendered.fieldsUsed).toContain('d4z4_clinical');
  });

  // End to end from the row on disk to the prompt line, because the
  // gap this covers opened between the two: migration 022 made the
  // stored value a string and the retriever's guard still tested for a
  // boolean, so the field left the prompt with nothing failing.
  it('carries the ambulation state through to the prompt in readable Chinese', async () => {
    const retriever = new PatientProfileRetriever(fakePool([PROFILE_ROW]));
    const result = await retriever.search({ question: '我适合做哪些家庭训练' }, makeCtx());
    const rendered = renderChunkForPrompt(result.chunks[0], { mode: 'strict' });

    expect(rendered.fieldsUsed).toContain('independentlyAmbulatory');
    expect(rendered.content).toContain('无法行走');
    // The enum itself is not something to make the model interpret.
    expect(rendered.content).not.toContain('unable');
  });

  // Migration 022 turned every historical boolean `false` into
  // `assisted`, and before 022 that was the only answer available to a
  // patient who cannot walk at all — so a stored `assisted` licenses
  // 「非独立行走」 and nothing more. Nothing can date the value, so the
  // prompt must never state the affirmative version. What is asserted
  // below is the reading the model is handed, not the shape of the fix.
  it('never tells the model an `assisted` patient can walk with aids', async () => {
    const retriever = new PatientProfileRetriever(fakePool([ASSISTED_PROFILE_ROW]));
    const result = await retriever.search({ question: '我适合做哪些家庭训练' }, makeCtx());
    const rendered = renderChunkForPrompt(result.chunks[0], { mode: 'strict' });

    const line = ambulationLine(rendered.content);
    expect(line).toBeDefined();
    expect(line).not.toContain('assisted');

    // The reading the model is handed, taken apart from any caveat that
    // follows it: on its own it must claim no more than non-independence.
    const [reading] = line!.split('注意：');
    expect(reading).toContain('非独立行走');
    expect(reading).not.toMatch(/(才|仍|尚)能行走|可以行走|能够行走/);

    // And the caveat has to actually be there — saying less is not the
    // same as saying why the value cannot be sharpened.
    expect(line).toContain('迁移');
    expect(line).toContain('不能据此认为患者借助器具仍能行走');

    // The allowlist passes this field in precise mode too, and precise
    // mode is where a patient has opted into MORE detail — not into a
    // sharper reading of a value that has none.
    const precise = await new PatientProfileRetriever(fakePool([ASSISTED_PROFILE_ROW])).search(
      { question: '我适合做哪些家庭训练' },
      makeCtx({ consentLevel: 'precise' }),
    );
    const preciseLine = ambulationLine(
      renderChunkForPrompt(precise.chunks[0], { mode: 'precise' }).content,
    );
    expect(preciseLine).toBe(line);
  });

  // The caveat exists because `assisted` is ambiguous. The other two
  // states are not: a historical `true` reproduced the label the
  // patient tapped, and `unable` can only have been written after 022.
  // Attaching the warning to them would be noise in a prompt the model
  // has to reason from.
  it('does not attach the 022 caveat to the two unambiguous states', async () => {
    for (const state of ['independent', 'unable']) {
      const retriever = new PatientProfileRetriever(fakePool([ambulationRow(state)]));
      const result = await retriever.search({ question: '我适合做哪些家庭训练' }, makeCtx());
      const rendered = renderChunkForPrompt(result.chunks[0], { mode: 'strict' });

      expect(ambulationLine(rendered.content)).not.toContain('迁移');
    }
  });

  it('keeps raw values when the user has opted into precise mode', async () => {
    const retriever = new PatientProfileRetriever(fakePool([PROFILE_ROW]));
    const result = await retriever.search(
      { question: 'detail' },
      makeCtx({ consentLevel: 'precise' }),
    );
    const rendered = renderChunkForPrompt(result.chunks[0], { mode: 'precise' });

    expect(rendered.content).toContain('3/22');
    expect(rendered.content).toContain('12%');
    expect(rendered.content).toContain('4qA');
    // Hard-delete keys still gone even in precise mode.
    expect(rendered.content).not.toContain('张三');
    expect(rendered.content).not.toContain('13812345678');
    expect(rendered.content).not.toContain('海淀');
  });
});

describe('renderChunkForPrompt — patient reports, strict mode (regression fence)', () => {
  it('strips raw OCR values, user-named titles, and exact dates from every chunk', async () => {
    const retriever = new PatientReportsRetriever(fakePool(REPORT_ROWS));
    const result = await retriever.search({ question: 'recent reports' }, makeCtx());
    expect(result.chunks).toHaveLength(2);

    for (const chunk of result.chunks) {
      const rendered = renderChunkForPrompt(chunk, { mode: 'strict' });
      assertNoLeak(rendered.content);
      // Strict mode must drop the raw OCR `fields` blob entirely.
      expect(rendered.content).not.toContain('rawFreeText');
      expect(rendered.content).not.toContain('patientName');
      expect(rendered.fieldsUsed).not.toContain('title');
      expect(rendered.fieldsUsed).not.toContain('fields');
    }
  });

  it('keeps clinically useful raw OCR values in precise mode', async () => {
    const retriever = new PatientReportsRetriever(fakePool([REPORT_ROWS[0]]));
    const result = await retriever.search(
      { question: 'reports' },
      makeCtx({ consentLevel: 'precise' }),
    );
    const rendered = renderChunkForPrompt(result.chunks[0], { mode: 'precise' });

    expect(rendered.content).toContain('3/22');
    expect(rendered.content).toContain('4qA');
    expect(rendered.content).toContain('12%');
    // PR #23 follow-up: title is no longer in the precise allowlist
    // because it is user-supplied free text and routinely contains
    // the patient's name. The clinical report type still passes.
    expect(rendered.content).not.toContain('张三的基因检测报告');
    expect(rendered.content).toContain('genetic_report');
  });

  // Regression for the bot's PR #23 follow-up review:
  // precise mode must scrub identifier-like keys nested inside the
  // OCR `fields` blob, and reject free-form OCR keys whose values
  // routinely carry PII.
  it('precise mode strips nested identifier keys and free-form OCR fields', async () => {
    const retriever = new PatientReportsRetriever(fakePool(REPORT_ROWS));
    const result = await retriever.search(
      { question: 'reports' },
      makeCtx({ consentLevel: 'precise' }),
    );

    for (const chunk of result.chunks) {
      const rendered = renderChunkForPrompt(chunk, { mode: 'precise' });

      // Nested hard-delete key NAMES must be gone.
      expect(rendered.content).not.toContain('patientName');
      expect(rendered.content).not.toContain('patientId');

      // And their VALUES must not survive via any other path.
      expect(rendered.content).not.toContain('张三'); // also catches rawFreeText leak
      expect(rendered.content).not.toContain('11010119900520XXXX');
      expect(rendered.content).not.toContain('110101199005203XXX');
      expect(rendered.content).not.toContain('13812345678');
      expect(rendered.content).not.toContain('138-1234-5678');

      // Free-form OCR keys with prose values must be dropped entirely
      // — including the MRI `findings` and the catch-all rawFreeText.
      expect(rendered.content).not.toContain('rawFreeText');
      expect(rendered.content).not.toContain('受检者');
      expect(rendered.content).not.toContain('STIR');
    }

    // Clinically useful raw values still come through for the
    // genetic report so precise mode is not gutted.
    const genetic = renderChunkForPrompt(result.chunks[0], { mode: 'precise' });
    expect(genetic.content).toContain('3/22'); // d4z4Repeats raw
    expect(genetic.content).toContain('4qA'); // haplotype raw
    expect(genetic.content).toContain('12%'); // methylationValue raw
    expect(genetic.content).toContain('FSHD1'); // diagnosisType raw label
    // Exact issue date is also stripped to year-only.
    expect(genetic.content).not.toContain('2023-06-01');
    expect(genetic.content).toContain('2023');
  });
});

/**
 * The `followups` scope had no fence at all, unlike `profile` and
 * `reports`. Two mutations proved it: adding `latestValue` / `series`
 * to `PROMPT_ALLOWLIST.followups.strict` left the whole suite green,
 * and deleting `case 'patient_followups'` from `scopeForSource` also
 * left it green — the chunk fell through to `passthrough`, which for a
 * patient source renders `chunk.content`, and that is always `''`. A
 * followup chunk silently contributed nothing to the prompt and no
 * assertion noticed.
 *
 * So the tests below pin both directions: strict must strip the raw
 * numbers and must still render the scope's own header and bands.
 */
describe('renderChunkForPrompt — patient followups, strict mode (regression fence)', () => {
  // Values chosen to be unmistakable in a haystack: `16.75` cannot be
  // confused with `count` or `spanDays`, and 「天前」 appears only in
  // `series` on a metric chunk.
  const SERIES_ROWS = [
    // `unit` is a patient-writable column that was free text for most
    // of this table's life, so it belongs in the leak probes alongside
    // report titles and notes.
    { metric_key: 'stair_climb', unit: '张三的秒表', value: '12.5', recorded_at: daysAgoIso(14) },
    { metric_key: 'stair_climb', unit: '张三的秒表', value: '14.25', recorded_at: daysAgoIso(7) },
    { metric_key: 'stair_climb', unit: '张三的秒表', value: '16.75', recorded_at: daysAgoIso(0) },
  ];

  it('strips latestValue / series / unit and keeps only the coarse trend', async () => {
    const retriever = new PatientFollowupRetriever(sequencedPool(SERIES_ROWS));
    const result = await retriever.search({ question: '' }, makeCtx());
    expect(result.chunks).toHaveLength(1);

    const rendered = renderChunkForPrompt(result.chunks[0], { mode: 'strict' });

    // The renderer has to recognise `patient_followups` as a patient
    // scope. If it ever falls through to passthrough, `content` is ''
    // and this is the assertion that says so.
    expect(rendered.content).toContain('【患者随访记录】');

    // What strict mode is allowed to say.
    expect(rendered.content).toContain('指标: 上楼计时');
    expect(rendered.content).toContain('记录次数: 3');
    expect(rendered.content).toContain('跨度(天): 14');
    expect(rendered.content).toContain('变化方向: up');
    expect(rendered.content).toContain('最近变化: 较前升高');

    // What it must not. `latestValue` and `series` are precise-mode
    // fields; leaking either would put self-reported raw numbers in
    // front of a model the user only granted basic consent to.
    expect(rendered.content).not.toContain('16.75');
    expect(rendered.content).not.toContain('14.25');
    expect(rendered.content).not.toContain('12.5');
    expect(rendered.content).not.toContain('天前'); // series point formatting
    expect(rendered.content).not.toContain('最近数值');
    expect(rendered.content).not.toContain('历次记录');
    expect(rendered.content).not.toContain('单位');

    // Same probe set the other two scopes use: nothing the patient
    // typed reaches the prompt, no matter which column it rode in on.
    assertNoLeak(rendered.content);

    // `fieldsUsed` is what the audit row records, so pin it exactly —
    // an addition to the strict allowlist has to show up here.
    expect(rendered.fieldsUsed).toEqual([
      'metricKey',
      'metricLabel',
      'count',
      'countAtCap',
      'spanDays',
      'changeDirection',
      'latestBand',
    ]);
    expect(rendered.stats).not.toBeNull();
    expect(rendered.stats?.notAllowed).toEqual(
      expect.arrayContaining(['unit', 'latestValue', 'series']),
    );
  });

  it('keeps the raw series once the user opted into precise mode', async () => {
    // The mirror of the test above: strict must not be "fixed" by
    // deleting the precise fields from the retriever altogether.
    //
    // The fixture keeps its「张三的秒表」unit rather than being mapped
    // to 'sec' first. Precise is the ONLY mode where `unit` is on the
    // allowlist, so rewriting the fixture washed out the one probe that
    // could ever catch the thing the alias table was added for — the
    // assertion passed identically before and after that work existed.
    const retriever = new PatientFollowupRetriever(sequencedPool(SERIES_ROWS));
    const result = await retriever.search({ question: '' }, makeCtx({ consentLevel: 'precise' }));
    const rendered = renderChunkForPrompt(result.chunks[0], { mode: 'precise' });

    // An unrecognised unit is dropped by UNIT_ALIASES on the way out,
    // so precise mode renders the values without one rather than
    // forwarding whatever the patient typed into the box.
    expect(rendered.content).not.toContain('张三');
    const fields = result.chunks[0].metadata.fields as Record<string, unknown>;
    expect(fields.unit).toBeNull();
    expect(String(fields.series)).not.toContain('张三');

    expect(rendered.content).toContain('【患者随访记录】');
    expect(rendered.content).toContain('16.75');
    expect(rendered.content).toContain('天前');
    // `latestBand` rides both modes now. On a series it duplicates the
    // direction, which is harmless; on a metric whose every row is
    // 「做不到」 it is the only string that explains the chunk, and it
    // was reaching strict-consent readers only. See the allowlist note.
    expect(rendered.fieldsUsed).toEqual([
      'metricKey',
      'metricLabel',
      'count',
      'countAtCap',
      'spanDays',
      'changeDirection',
      'latestBand',
      // Present but null: the allowlist filter keys off the field name,
      // not the value, so a dropped unit still shows up here. What
      // matters is the assertions above — the value is null and the
      // patient's text reaches neither `unit` nor `series`.
      'unit',
      'latestValue',
      'series',
    ]);
    assertNoLeak(rendered.content);
  });

  it('renders the event tally in strict mode without the patient description', async () => {
    const retriever = new PatientFollowupRetriever(
      sequencedPool([], [{ event_type: 'fall', severity: 'mild', occurred_at: daysAgoIso(3) }]),
    );
    const result = await retriever.search({ question: '' }, makeCtx());
    const rendered = renderChunkForPrompt(result.chunks[0], { mode: 'strict' });

    expect(rendered.content).toContain('【患者随访记录】');
    expect(rendered.content).toContain('病程事件: 跌倒（轻）×1，最近 3 天前');
    expect(rendered.content).toContain('事件条数: 1');
    expect(rendered.fieldsUsed).toEqual(['eventSummary', 'eventCount']);
    assertNoLeak(rendered.content);
  });
});

describe('renderChunkForPrompt — non-patient sources', () => {
  it('passes medical_kb chunks through unchanged in both modes', () => {
    const kbChunk: RetrievedChunk = {
      id: 'k-1',
      source: 'medical_kb',
      content: 'FSHD1 由 4 号染色体 D4Z4 重复减少导致 DUX4 表达失调。',
      metadata: {},
      distance: 0.1,
      sourceFile: 'fshd/02-genetics-d4z4.md',
      chunkIndex: 0,
    };
    for (const mode of ['strict', 'precise'] as const) {
      const rendered = renderChunkForPrompt(kbChunk, { mode });
      expect(rendered.content).toBe(kbChunk.content);
      expect(rendered.fieldsUsed).toEqual([]);
      expect(rendered.stats).toBeNull();
    }
  });

  it('returns empty content for stub platform_docs chunks (none expected)', () => {
    const stubChunk: RetrievedChunk = {
      id: 'p-1',
      source: 'platform_docs',
      content: '',
      metadata: {},
      distance: null,
      sourceFile: null,
      chunkIndex: null,
    };
    const rendered = renderChunkForPrompt(stubChunk, { mode: 'strict' });
    expect(rendered.content).toBe('');
    expect(rendered.fieldsUsed).toEqual([]);
  });
});

/**
 * EVERY ROW IN A PATIENT-FACING BLOCK IS LABELLED IN CHINESE.
 *
 * `renderFieldsByScope` falls back to the raw key when
 * `PROFILE_FIELD_LABELS` has no entry, and `methylation_origin` had
 * none — so an otherwise fully-labelled block printed
 *「methylation_origin: not_read_off_a_laboratory_report」, the one
 * snake_case row on the projection, and the row carrying this
 * platform's refusal to attribute the FSHD2 discriminator at that. A
 * caveat that reads as engineering leftover is a caveat the model
 * discounts.
 *
 * Asked of the rendered bytes rather than of the label table, because
 * the table is what was already checked: tool-descriptions.test.ts asks
 * whether every LABEL has a reachable key, and the reverse — a
 * reachable key with no label — is what landed here.
 */
describe('the profile block prints no bare field key', () => {
  const HAN = /\p{Script=Han}/u;

  it.each(['strict', 'precise'] as const)('labels every row in %s mode', async (mode) => {
    const retriever = new PatientProfileRetriever(fakePool([PROFILE_ROW]));
    const result = await retriever.search(
      { question: '' },
      makeCtx({ consentLevel: mode === 'precise' ? 'precise' : 'basic' }),
    );
    const rendered = renderChunkForPrompt(result.chunks[0], { mode });

    const [header, ...rows] = rendered.content.split('\n');
    expect(header).toBe('【患者基础档案】');
    expect(rows.length).toBeGreaterThan(0);
    const unlabelled = rows
      .map((row) => row.slice(0, row.indexOf(':')))
      .filter((label) => !HAN.test(label));
    expect(unlabelled).toEqual([]);
  });

  // The row this was found on, pinned by the bytes a reader gets.
  it('prints the methylation origin under a Chinese label that grades nothing', async () => {
    const retriever = new PatientProfileRetriever(fakePool([PROFILE_ROW]));
    const result = await retriever.search({ question: '' }, makeCtx());
    const rendered = renderChunkForPrompt(result.chunks[0], { mode: 'strict' });

    expect(rendered.content).toContain('甲基化值来源: not_read_off_a_laboratory_report');
    expect(rendered.content).not.toContain('methylation_origin');
    // 来源, never 分级: this repo states no methylation boundary.
    expect(rendered.content).not.toContain('甲基化临床分级');
  });
});

/**
 * AN ARCHIVED 病历摘要 WHOSE UPLOADER ALSO PICKED 基因检测报告.
 *
 * The assistant path was the one surface without the document's page,
 * so `isLaboratoryGeneticReport` fell through to the uploader's
 * declaration and believed it — while the passport, the share page, the
 * referral pack and the exports all read the same row's 主诉 / 现病史 /
 * 查体 and refused. End to end here, from the row on disk to the prompt
 * line, because that is the gap: every piece worked and the page never
 * travelled.
 */
describe('renderChunkForPrompt — a transcription declared as a genetics report', () => {
  const DISCHARGE_PAGE =
    '出院小结\n主诉：双上肢抬举无力5年。现病史：患者2019年起病，外院查体见翼状肩胛。' +
    '诊疗经过：外院基因检测提示 FSHD1，D4Z4 3 个重复单元。患者张三，电话 13812345678。';

  const misclassifiedRow = (ocrPayload: Record<string, unknown>) => ({
    id: 'doc-9',
    document_type: 'genetic_report',
    title: '出院小结',
    uploaded_at: '2026-04-01T08:00:00Z',
    status: 'processed',
    classified_type: 'genetic_report',
    ocr_payload: ocrPayload,
  });

  const CELLS = {
    classifiedType: 'genetic_report',
    diagnosisType: 'FSHD1',
    d4z4Repeats: '3',
    haplotype: '4qA',
    methylationValue: '12%',
  };

  it.each(['strict', 'precise'] as const)('grades none of it in %s mode', async (mode) => {
    const retriever = new PatientReportsRetriever(
      fakePool([misclassifiedRow({ extractedText: DISCHARGE_PAGE, fields: CELLS })]),
    );
    const result = await retriever.search(
      { question: '' },
      makeCtx({ consentLevel: mode === 'precise' ? 'precise' : 'basic' }),
    );
    const rendered = renderChunkForPrompt(result.chunks[0], { mode });

    // Every genetics cell on the page says where it came from, and none
    // of them is banded.
    expect(rendered.content).toContain('d4z4Repeats_clinical: not_read_off_a_laboratory_report');
    expect(rendered.content).toContain('haplotype_clinical: not_read_off_a_laboratory_report');
    expect(rendered.content).toContain('methylationValue_origin: not_read_off_a_laboratory_report');
    expect(rendered.content).toContain('diagnosisType_origin: not_read_off_a_laboratory_report');
    expect(rendered.content).not.toContain('within_fshd1_repeat_range');
    expect(rendered.content).not.toContain('permissive_haplotype');

    // The page itself reaches no prompt: it is the OCR full-text dump,
    // and it carries the patient's name and phone number here.
    for (const fragment of ['出院小结', '主诉', '现病史', '查体', '诊疗经过', 'extractedText']) {
      expect(rendered.content).not.toContain(fragment);
    }
    // The strict-mode probe set is about the raw cells, which precise
    // consent buys; what neither mode buys is the page.
    if (mode === 'strict') assertNoLeak(rendered.content);
    expect(rendered.content).not.toContain('张三');
    expect(rendered.content).not.toContain('13812345678');
    expect(rendered.fieldsUsed).not.toContain('extractedText');
    expect(rendered.stats?.hardDeleted).toContain('extractedText');
  });

  it('still reads the laboratory’s own report off the same path', async () => {
    // The mirror: the gate must not be "fixed" by refusing everything.
    const retriever = new PatientReportsRetriever(
      fakePool([
        misclassifiedRow({
          extractedText: '基因检测报告\n检测方法：Southern blot\n检测结论：D4Z4 3 个重复单元。',
          fields: CELLS,
        }),
      ]),
    );
    const result = await retriever.search({ question: '' }, makeCtx());
    const rendered = renderChunkForPrompt(result.chunks[0], { mode: 'strict' });

    expect(rendered.content).toContain('d4z4Repeats_clinical: within_fshd1_repeat_range');
    expect(rendered.content).toContain('haplotype_clinical: permissive_haplotype');
    expect(rendered.content).not.toContain('not_read_off_a_laboratory_report');
    expect(rendered.content).not.toContain('检测方法');
  });
});
