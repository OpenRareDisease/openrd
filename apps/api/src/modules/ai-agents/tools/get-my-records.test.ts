/**
 * Tests for the followup-records tool.
 *
 * Two of these are regression fences rather than ordinary coverage:
 *
 *  - **The advertised keys must be keys the retriever can match.** An
 *    earlier revision advertised `grip_strength` / `arm_raise` /
 *    `walk_6min`, none of which can exist in the database, so a patient
 *    asking「我抬臂是不是变弱了」was told they had never recorded it.
 *    Nothing failed at the time because the tool's JSON Schema and the
 *    retriever's `METRIC_LABELS` were only related by convention.
 *  - **An unknown key must throw, not filter to nothing.** The
 *    orchestrator runs a fixed two rounds with no retry, so a silently
 *    empty retrieval is terminal — the model confidently reports "you
 *    have not recorded this" about data that exists.
 */

import { describe, expect, it, vi } from 'vitest';

import type { ToolContext } from './base.js';
import { ToolValidationError, meetsConsent } from './base.js';
import { GetMyRecordsTool } from './get-my-records.js';
import { ToolRegistry } from './registry.js';
import type { RetrieveContext, RetrieveResult } from '../retrievers/base.js';
import type { PatientFollowupRetriever } from '../retrievers/patient-followups.js';

const silentLogger = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child: () => silentLogger,
} as unknown as RetrieveContext['logger'];

const ctx: ToolContext = {
  userId: 'user-1',
  consentLevel: 'basic',
  requestId: 'req-1',
  logger: silentLogger as unknown as ToolContext['logger'],
};

const stubRetriever = (result?: RetrieveResult) =>
  ({
    search: vi.fn().mockResolvedValue(
      result ?? {
        retrieverId: 'patient_followups',
        chunks: [],
        citations: [],
        metadata: { reason: 'no_followups_found' },
      },
    ),
  }) as unknown as PatientFollowupRetriever & { search: ReturnType<typeof vi.fn> };

const chunks = (count: number): RetrieveResult => ({
  retrieverId: 'patient_followups',
  chunks: Array.from({ length: count }, (_, i) => ({
    id: `c${i}`,
    source: 'patient_followups',
    content: '',
    metadata: { fields: {} },
    distance: null,
  })),
  citations: [],
  metadata: {},
});

/**
 * The keys the record can actually contain, mirrored from
 * `METRIC_LABELS` in patient-followups.ts. Hard-coded rather than
 * imported so that renaming a key on the retriever side surfaces here
 * as a failure instead of silently re-deriving the same (wrong) list on
 * both sides of the assertion.
 */
const FUNCTION_TEST_KEYS = [
  'stair_climb',
  'ten_meter_walk',
  'sit_to_stand',
  'six_minute_walk',
  'timed_up_and_go',
  'custom',
];
const SYMPTOM_KEYS = ['fatigue', 'pain', 'dyspnea', 'sleep_quality', 'anxiety_about_progression'];
const MUSCLE_GROUPS = [
  'deltoid',
  'biceps',
  'triceps',
  'tibialis',
  'quadriceps',
  'hamstrings',
  'gluteus',
];

describe('GetMyRecordsTool — contract', () => {
  const tool = new GetMyRecordsTool(stubRetriever());

  it('is named get_my_records and requires at least basic consent', () => {
    expect(tool.name).toBe('get_my_records');
    expect(tool.minConsent).toBe('basic');
  });

  it('is hidden from the planner at consent=none and visible from basic up', () => {
    const registry = new ToolRegistry().register(tool);
    expect(registry.availableFor('none').map((t) => t.name)).not.toContain('get_my_records');
    for (const level of ['basic', 'precise'] as const) {
      expect(registry.availableFor(level).map((t) => t.name)).toContain('get_my_records');
    }
    // The registry filter and the executor's defence-in-depth check
    // must agree; a divergence would advertise a tool that then refuses.
    expect(meetsConsent('none', tool.minConsent)).toBe(false);
    expect(meetsConsent('basic', tool.minConsent)).toBe(true);
  });

  it('advertises windowDays with the same bounds parseArgs enforces', () => {
    const props = (
      tool.parametersSchema as { properties: Record<string, { [k: string]: unknown }> }
    ).properties;
    expect(props.windowDays.minimum).toBe(1);
    expect(props.windowDays.maximum).toBe(730);
    expect(tool.parametersSchema.additionalProperties).toBe(false);
  });
});

describe('GetMyRecordsTool.parseArgs — metricKey', () => {
  const tool = new GetMyRecordsTool(stubRetriever());

  it('accepts absent / empty arguments', () => {
    expect(tool.parseArgs('')).toEqual({});
    expect(tool.parseArgs('{}')).toEqual({});
  });

  it('rejects non-object and non-JSON payloads', () => {
    expect(() => tool.parseArgs('"stair_climb"')).toThrow(ToolValidationError);
    expect(() => tool.parseArgs('[]')).toThrow(ToolValidationError);
    expect(() => tool.parseArgs('{oops')).toThrow(ToolValidationError);
  });

  it('rejects a non-string or blank metricKey', () => {
    expect(() => tool.parseArgs('{"metricKey":123}')).toThrow(/metricKey/);
    expect(() => tool.parseArgs('{"metricKey":""}')).toThrow(/metricKey/);
    expect(() => tool.parseArgs('{"metricKey":"   "}')).toThrow(/metricKey/);
  });

  it('accepts every metric key the retriever can actually match', () => {
    for (const key of [...FUNCTION_TEST_KEYS, ...SYMPTOM_KEYS]) {
      expect(tool.parseArgs(JSON.stringify({ metricKey: key }))).toEqual({ metricKey: key });
    }
    for (const group of MUSCLE_GROUPS) {
      // Sided variants are produced by the measurement branch of the
      // UNION (`muscle_deltoid_left`), so they have to parse too.
      for (const key of [`muscle_${group}`, `muscle_${group}_left`, `muscle_${group}_right`]) {
        expect(tool.parseArgs(JSON.stringify({ metricKey: key }))).toEqual({ metricKey: key });
      }
    }
  });

  it('names those same keys in the schema the model reads', () => {
    // The bug this fences: the schema advertised keys the retriever
    // could never match, so the model dutifully passed them and got an
    // empty series back. Schema text and retriever table must not drift.
    const schemaText = JSON.stringify(tool.parametersSchema);
    for (const key of [...FUNCTION_TEST_KEYS, ...SYMPTOM_KEYS]) {
      expect(schemaText).toContain(key);
    }
    for (const group of MUSCLE_GROUPS) {
      expect(schemaText).toContain(group);
    }
  });

  it('throws on an unknown metricKey rather than silently retrieving nothing', () => {
    // The three keys an earlier revision invented. Each one produced a
    // confident "you have not recorded this yet" about real data.
    for (const key of ['grip_strength', 'arm_raise', 'walk_6min']) {
      expect(() => tool.parseArgs(JSON.stringify({ metricKey: key }))).toThrow(ToolValidationError);
      expect(() => tool.parseArgs(JSON.stringify({ metricKey: key }))).toThrow(/Unknown metricKey/);
    }
    // A plausible-looking near-miss on a real key must fail too.
    expect(() => tool.parseArgs('{"metricKey":"muscle_deltoid_middle"}')).toThrow(
      ToolValidationError,
    );
    expect(() => tool.parseArgs('{"metricKey":"muscle_pectoralis"}')).toThrow(ToolValidationError);
    // A bare side suffix is not a metric.
    expect(() => tool.parseArgs('{"metricKey":"_left"}')).toThrow(ToolValidationError);
    // The message has to tell the model how to recover, since a failed
    // tool call is all it gets back.
    expect(() => tool.parseArgs('{"metricKey":"grip_strength"}')).toThrow(/Omit metricKey/);
  });

  it('trims surrounding whitespace before validating', () => {
    expect(tool.parseArgs('{"metricKey":"  stair_climb  "}')).toEqual({ metricKey: 'stair_climb' });
  });

  it('drops arguments the schema does not declare', () => {
    expect(tool.parseArgs('{"userId":"someone-else","limit":9}')).toEqual({});
  });
});

describe('GetMyRecordsTool.parseArgs — windowDays', () => {
  const tool = new GetMyRecordsTool(stubRetriever());

  it('rejects non-numeric and non-finite windowDays', () => {
    expect(() => tool.parseArgs('{"windowDays":"30"}')).toThrow(/windowDays/);
    expect(() => tool.parseArgs('{"windowDays":true}')).toThrow(/windowDays/);
    // JSON.stringify turns Infinity into `null`, which is the shape a
    // model that overflowed its own arithmetic would actually send.
    expect(() => tool.parseArgs('{"windowDays":null}')).toThrow(/windowDays/);
  });

  it('clamps to [1, 730] and floors fractions', () => {
    expect(tool.parseArgs('{"windowDays":9999}')).toEqual({ windowDays: 730 });
    expect(tool.parseArgs('{"windowDays":730}')).toEqual({ windowDays: 730 });
    expect(tool.parseArgs('{"windowDays":731}')).toEqual({ windowDays: 730 });
    expect(tool.parseArgs('{"windowDays":0}')).toEqual({ windowDays: 1 });
    expect(tool.parseArgs('{"windowDays":-40}')).toEqual({ windowDays: 1 });
    expect(tool.parseArgs('{"windowDays":0.4}')).toEqual({ windowDays: 1 });
    expect(tool.parseArgs('{"windowDays":30.9}')).toEqual({ windowDays: 30 });
  });

  it('leaves a valid windowDays untouched', () => {
    expect(tool.parseArgs('{"windowDays":90}')).toEqual({ windowDays: 90 });
  });
});

describe('GetMyRecordsTool.execute', () => {
  it('omits the filter entirely when no args were given', async () => {
    const retriever = stubRetriever(chunks(3));
    const tool = new GetMyRecordsTool(retriever);

    await tool.execute({}, ctx);

    expect(retriever.search).toHaveBeenCalledWith(
      { question: '', filter: undefined },
      expect.objectContaining({ userId: 'user-1', consentLevel: 'basic', requestId: 'req-1' }),
    );
  });

  it('forwards metricKey and windowDays as retriever filters', async () => {
    const retriever = stubRetriever(chunks(2));
    const tool = new GetMyRecordsTool(retriever);

    const args = tool.parseArgs(
      JSON.stringify({ metricKey: 'muscle_deltoid_left', windowDays: 60 }),
    );
    const result = await tool.execute(args, ctx);

    expect(retriever.search).toHaveBeenCalledWith(
      { question: '', filter: { metricKey: 'muscle_deltoid_left', windowDays: 60 } },
      expect.objectContaining({ userId: 'user-1' }),
    );
    expect(result.display).toBe('patient_followups: 2 chunks');
  });

  it('forwards only the filter key that was supplied', async () => {
    const retriever = stubRetriever(chunks(1));
    const tool = new GetMyRecordsTool(retriever);

    await tool.execute({ metricKey: 'fatigue' }, ctx);
    expect(retriever.search).toHaveBeenCalledWith(
      { question: '', filter: { metricKey: 'fatigue' } },
      expect.anything(),
    );
  });

  it('forwards the caller consent level and abort signal unchanged', async () => {
    const retriever = stubRetriever(chunks(1));
    const tool = new GetMyRecordsTool(retriever);
    const controller = new AbortController();

    await tool.execute({}, { ...ctx, consentLevel: 'precise', signal: controller.signal });

    // Consent has to reach the retriever verbatim — the retriever, not
    // the tool, is what refuses at consent=none, and the redaction mode
    // downstream is derived from this same value.
    expect(retriever.search).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ consentLevel: 'precise', signal: controller.signal }),
    );
  });

  it('never runs the retriever with a userId it was not given', async () => {
    const retriever = stubRetriever(chunks(0));
    const tool = new GetMyRecordsTool(retriever);

    await tool.execute({}, { ...ctx, userId: null });

    expect(retriever.search).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: null }),
    );
  });

  it('surfaces the empty-result reason in the display string', async () => {
    const tool = new GetMyRecordsTool(stubRetriever());
    const result = await tool.execute({}, ctx);
    expect(result.display).toBe('patient_followups: empty (no_followups_found)');
    expect(result.retrieval.chunks).toHaveLength(0);
  });

  it('falls back to no_data when the retriever gave no reason', async () => {
    const tool = new GetMyRecordsTool(
      stubRetriever({
        retrieverId: 'patient_followups',
        chunks: [],
        citations: [],
        metadata: {},
      }),
    );
    const result = await tool.execute({}, ctx);
    expect(result.display).toBe('patient_followups: empty (no_data)');
  });

  it('returns the retriever result untouched', async () => {
    const retrieval = chunks(2);
    const tool = new GetMyRecordsTool(stubRetriever(retrieval));
    const result = await tool.execute({}, ctx);
    expect(result.retrieval).toBe(retrieval);
  });
});
