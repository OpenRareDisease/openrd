import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CDT_KEYWORDS } from './chinadrugtrials.fetcher.js';
import type { RefreshSourceOutcome } from './refresh.js';

/**
 * What cron mails an operator.
 *
 * This file exists because the CLI's two lines ARE the ops interface:
 * nothing else tells the person who gets the mail whether the domestic
 * scrape came back with the registry's own zero or with nothing at all.
 * A sentence with no test is a sentence that drifts, and this one drifts
 * into a claim about what a government registry said.
 *
 * Everything below the process boundary is stubbed — `refreshTrials`,
 * `pg.Client`, the env and the logger — because none of it is what is
 * under test. What is under test is the wording, the stream each line
 * goes to, and the exit code.
 */

const stubs = vi.hoisted(() => {
  const connect = vi.fn(async () => {});
  const end = vi.fn(async () => {});
  const clientConfigs: unknown[] = [];
  class FakeClient {
    connect = connect;
    end = end;
    query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    constructor(config: unknown) {
      clientConfigs.push(config);
    }
  }
  return {
    refreshTrials: vi.fn(),
    connect,
    end,
    clientConfigs,
    FakeClient,
  };
});

vi.mock('pg', () => ({ Client: stubs.FakeClient }));
vi.mock('./refresh.js', () => ({ refreshTrials: stubs.refreshTrials }));
vi.mock('../../config/env.js', () => ({
  loadAppEnv: () => ({ DATABASE_URL: 'postgres://test/openrd' }),
}));
vi.mock('../../config/logger.js', () => ({
  createLogger: () => ({
    fatal: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(),
  }),
}));
vi.mock('../../db/pool.js', () => ({ resolvePgSsl: () => false }));

const { main } = await import('./refresh.cli.js');

const ok = (
  source: RefreshSourceOutcome['source'],
  sourceReportedTotal: number,
  recordsUpserted: number,
  recordsDeleted = 0,
): RefreshSourceOutcome => ({
  source,
  ok: true,
  runId: `run-${source}`,
  recordsUpserted,
  recordsDeleted,
  sourceReportedTotal,
  error: null,
});

let stdout: string[];
let stderr: string[];
let originalExitCode: number | string | null | undefined;

beforeEach(() => {
  stdout = [];
  stderr = [];
  originalExitCode = process.exitCode;
  stubs.refreshTrials.mockReset();
  stubs.connect.mockClear();
  stubs.end.mockClear();
  stubs.clientConfigs.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  // main() sets it on a failed source, and this process is the test
  // runner's.
  process.exitCode = originalExitCode;
});

describe('trials:refresh — the success line', () => {
  it('quotes ctgov own count as the registry own count', async () => {
    // One query, one `totalCount`: 92 is what clinicaltrials.gov says
    // matched, and there is nothing to qualify. (92 is the live number
    // the ctgov fixture was captured with.)
    stubs.refreshTrials.mockResolvedValue([ok('ctgov', 92, 92)]);

    await main();

    expect(stdout).toEqual([
      'trials:refresh ctgov: ok, registry reported 92 matching, 92 record(s) written, 0 removed\n',
    ]);
    expect(stderr).toEqual([]);
    expect(process.exitCode).toBeFalsy();
  });

  it('does not attribute the chinadrugtrials keyword sum to the registry', async () => {
    // These two numbers are the pair chinadrugtrials.fetcher.test.ts
    // pins in 「reports the registry own counts even when two keywords
    // return the same trials」: a results page answering 共 9 条记录 for
    // two of the three keywords produces sourceReportedTotal = 18 with
    // 9 records. It is reachable in production — a registration reading
    // 面肩肱型肌营养不良（FSHD）matches two CDT_KEYWORDS — so the first
    // domestic FSHD trial ever registered prints this line.
    //
    // 18 is our arithmetic. The registry reported 9, twice. Saying
    // 「registry reported 18 matching, 9 written」 both invents a
    // registry claim and reads to the operator as a scraper dropping
    // half its rows.
    stubs.refreshTrials.mockResolvedValue([ok('chinadrugtrials', 18, 9)]);

    await main();

    const line = stdout.join('');
    expect(line).not.toContain('registry reported 18');
    expect(line).toContain(
      `${CDT_KEYWORDS.length} keyword searches reported 18 matching between them ` +
        '(a trial matching two of them counts twice here and is written once)',
    );
    expect(line).toContain('9 record(s) written');
  });

  it('prints the registry own zero as the registry answering, not as an empty write', async () => {
    // Today's real state for this source: every keyword search renders
    // its results table and its own 共 0 条记录. 「0 record(s) written」
    // alone is what this whole column exists to stop being the only
    // thing the operator sees.
    stubs.refreshTrials.mockResolvedValue([ok('chinadrugtrials', 0, 0)]);

    await main();

    expect(stdout.join('')).toBe(
      `trials:refresh chinadrugtrials: ok, ${CDT_KEYWORDS.length} keyword searches reported 0 matching between them (a trial matching two of them counts twice here and is written once), 0 record(s) written, 0 removed\n`,
    );
  });
});

describe('trials:refresh — failure and exit code', () => {
  it('sends a failed source to stderr and exits 1 while the other source still prints', async () => {
    stubs.refreshTrials.mockResolvedValue([
      ok('ctgov', 92, 92),
      {
        source: 'chinadrugtrials',
        ok: false,
        runId: 'run-cdt',
        recordsUpserted: 0,
        recordsDeleted: 0,
        sourceReportedTotal: null,
        error: 'chinadrugtrials search page 1: no results table in the response (25564 bytes)',
      },
    ]);

    await main();

    expect(stdout).toEqual([
      'trials:refresh ctgov: ok, registry reported 92 matching, 92 record(s) written, 0 removed\n',
    ]);
    expect(stderr).toEqual([
      'trials:refresh chinadrugtrials: FAILED — chinadrugtrials search page 1: no results table in the response (25564 bytes)\n',
    ]);
    expect(process.exitCode).toBe(1);
  });

  it('closes the connection even when the refresh throws', async () => {
    // The `finally`. A one-shot process that leaks its connection is
    // survivable; one that leaks it hourly, from cron, is not.
    stubs.refreshTrials.mockRejectedValue(new Error('DATABASE_URL is unreachable'));

    await expect(main()).rejects.toThrow('DATABASE_URL is unreachable');

    expect(stubs.connect).toHaveBeenCalledTimes(1);
    expect(stubs.end).toHaveBeenCalledTimes(1);
  });
});
