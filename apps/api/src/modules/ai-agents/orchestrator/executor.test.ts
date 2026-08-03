import { describe, expect, it, vi } from 'vitest';

import { Executor } from './executor.js';
import type { LlmToolCall } from '../llm/base.js';
import type { RetrieveContext, RetrieveResult } from '../retrievers/base.js';
import type { ITool, ToolContext, ToolExecutionResult } from '../tools/base.js';
import { ToolValidationError } from '../tools/base.js';
import { ToolRegistry } from '../tools/registry.js';

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
  userId: 'u1',
  consentLevel: 'basic',
  requestId: 'r1',
  logger: silentLogger as unknown as ToolContext['logger'],
};

const stub = (name: string): RetrieveResult => ({
  retrieverId: name,
  chunks: [{ id: 'c', source: name, content: 'x', metadata: {}, distance: null }],
  citations: [],
  metadata: {},
});

const passingTool = (name: string, delay = 0): ITool => ({
  name,
  description: '',
  parametersSchema: { type: 'object', properties: {} },
  parseArgs: () => ({}),
  execute: async (): Promise<ToolExecutionResult> => {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    return { retrieval: stub(name), display: `${name}: 1` };
  },
});

const call = (name: string, id: string, args = '{}'): LlmToolCall => ({
  id,
  name,
  argumentsJson: args,
});

describe('Executor', () => {
  it('runs tool calls in parallel', async () => {
    // Asserts on the observed INTERLEAVING, not on wall-clock time.
    //
    // This used to time two 30ms tools and require the total under
    // 100ms — which proves parallelism only as long as the machine is
    // idle. Under load (a full CI runner, or this suite's own 50 files
    // across worker threads) two 30ms sleeps can legitimately take
    // longer than 100ms while still overlapping perfectly, so the test
    // failed for a reason that had nothing to do with the executor. A
    // timing test that reports a scheduling hiccup as a correctness
    // regression is worse than no test: it trains everyone to re-run
    // the suite instead of reading it.
    //
    // "b entered before a left" is the actual claim, it is exact, and
    // it is false for any serial implementation regardless of speed.
    const events: string[] = [];
    const traced = (name: string): ITool => ({
      ...passingTool(name),
      execute: async (): Promise<ToolExecutionResult> => {
        events.push(`${name}:enter`);
        await new Promise((r) => setTimeout(r, 10));
        events.push(`${name}:exit`);
        return { retrieval: stub(name), display: `${name}: 1` };
      },
    });

    const registry = new ToolRegistry().register(traced('a')).register(traced('b'));
    const results = await new Executor(registry).executeAll([call('a', '1'), call('b', '2')], ctx);

    expect(results.map((r) => r.toolName)).toEqual(['a', 'b']);
    expect(results.every((r) => !r.error)).toBe(true);
    // Serial execution can only ever produce a:enter,a:exit,b:enter,b:exit.
    expect(events.indexOf('b:enter')).toBeLessThan(events.indexOf('a:exit'));
  });

  it('captures ToolValidationError into the result instead of throwing', async () => {
    const bad: ITool = {
      name: 'bad',
      description: '',
      parametersSchema: { type: 'object', properties: {} },
      parseArgs: () => {
        throw new ToolValidationError('args bad');
      },
      execute: async () => ({
        retrieval: stub('bad'),
        display: 'unused',
      }),
    };
    const registry = new ToolRegistry().register(bad);
    const executor = new Executor(registry);

    const [r] = await executor.executeAll([call('bad', '1')], ctx);
    expect(r.error).toBe('args bad');
    expect(r.retrieval).toBeUndefined();
  });

  it('captures runtime errors into the result', async () => {
    const boom: ITool = {
      name: 'boom',
      description: '',
      parametersSchema: { type: 'object', properties: {} },
      parseArgs: () => ({}),
      execute: async () => {
        throw new Error('explode');
      },
    };
    const registry = new ToolRegistry().register(boom);
    const executor = new Executor(registry);

    const [r] = await executor.executeAll([call('boom', '1')], ctx);
    expect(r.error).toBe('explode');
  });

  it('returns an error result for unknown tools', async () => {
    const registry = new ToolRegistry();
    const executor = new Executor(registry);

    const [r] = await executor.executeAll([call('ghost', '1')], ctx);
    expect(r.error).toMatch(/Unknown tool/);
  });

  it('enforces per-tool timeout', async () => {
    const slow: ITool = {
      name: 'slow',
      description: '',
      parametersSchema: { type: 'object', properties: {} },
      parseArgs: () => ({}),
      execute: () => new Promise((r) => setTimeout(r, 1000)) as Promise<ToolExecutionResult>,
    };
    const registry = new ToolRegistry().register(slow);
    const executor = new Executor(registry);

    const [r] = await executor.executeAll([call('slow', '1')], ctx, { timeoutMs: 50 });
    expect(r.error).toMatch(/timed out/);
  });

  it('refuses a tool whose minConsent exceeds the caller consent (defence-in-depth)', async () => {
    const executeSpy = vi.fn();
    const preciseOnly: ITool = {
      name: 'precise_only',
      description: '',
      parametersSchema: { type: 'object', properties: {} },
      minConsent: 'precise',
      parseArgs: () => ({}),
      execute: async () => {
        executeSpy();
        return { retrieval: stub('precise_only'), display: 'should not happen' };
      },
    };
    const registry = new ToolRegistry().register(preciseOnly);
    const executor = new Executor(registry);

    const [r] = await executor.executeAll([call('precise_only', '1')], ctx);
    // ctx.consentLevel === 'basic', tool requires 'precise'
    expect(r.error).toMatch(/requires consent precise.*have basic/);
    expect(r.display).toBe('precise_only: consent_insufficient');
    expect(r.retrieval).toBeUndefined();
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('still runs a tool when minConsent is satisfied', async () => {
    const basicTool: ITool = {
      ...passingTool('ok_basic'),
      minConsent: 'basic',
    };
    const registry = new ToolRegistry().register(basicTool);
    const executor = new Executor(registry);

    const [r] = await executor.executeAll([call('ok_basic', '1')], ctx);
    expect(r.error).toBeUndefined();
    expect(r.retrieval?.chunks).toHaveLength(1);
  });

  it('aborts in-flight tool work when ctx.signal fires (PR-Sec-5 #5)', async () => {
    // The legacy withTimeout only raced against the per-tool wall-
    // clock timer. A dropped SSE client should cancel sooner; this
    // test pins that the executor settles with an error as soon as
    // the signal fires, not after the 30s timer.
    const slowTool: ITool = {
      name: 'slow',
      description: '',
      parametersSchema: { type: 'object', properties: {} },
      parseArgs: () => ({}),
      execute: async () => {
        // Never resolves on its own — only the abort race can end this.
        await new Promise(() => {});
        return { retrieval: stub('slow'), display: 'slow' };
      },
    };
    const registry = new ToolRegistry().register(slowTool);
    const executor = new Executor(registry);
    const controller = new AbortController();
    const abortingCtx: ToolContext = { ...ctx, signal: controller.signal };

    setTimeout(() => controller.abort(), 20);
    const [r] = await executor.executeAll([call('slow', '1')], abortingCtx, {
      timeoutMs: 5_000,
    });
    expect(r.error).toMatch(/aborted/);
    // Latency should reflect the abort, not the 5s timeout.
    expect(r.latencyMs ?? 0).toBeLessThan(500);
  });

  it('removes the abort listener when the promise wins the race (PR #51 review)', async () => {
    // Under the SSE streaming flow one AbortController lives across
    // many withTimeout calls. If the abort listener is left attached
    // after the wrapped promise resolves, a later signal.abort()
    // fires reject(new Error(...)) against a Promise nobody is
    // awaiting → unhandled rejection → Node 22+ exits the process.
    //
    // Test shape: run a fast-resolving tool many times under the
    // same controller, then fire abort, capture any unhandled
    // rejections — there should be none.
    const registry = new ToolRegistry().register(passingTool('fast', 0));
    const executor = new Executor(registry);
    const controller = new AbortController();
    const sharedCtx: ToolContext = { ...ctx, signal: controller.signal };

    const unhandled: unknown[] = [];
    const onRejection = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onRejection);

    try {
      // Burn a handful of tool calls under the shared signal.
      for (let i = 0; i < 5; i++) {
        await executor.executeAll([call('fast', String(i))], sharedCtx);
      }
      // Now fire the signal. With the listener leak this would emit
      // 5 unhandled rejections; with the cleanup it emits zero.
      controller.abort();
      // Let microtasks settle so any pending unhandled rejection lands.
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });
});
