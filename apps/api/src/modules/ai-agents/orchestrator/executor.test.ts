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
    const registry = new ToolRegistry()
      .register(passingTool('a', 30))
      .register(passingTool('b', 30));
    const executor = new Executor(registry);

    const start = Date.now();
    const results = await executor.executeAll([call('a', '1'), call('b', '2')], ctx);
    const elapsed = Date.now() - start;

    expect(results.map((r) => r.toolName)).toEqual(['a', 'b']);
    expect(elapsed).toBeLessThan(100); // serial would be ~60ms; parallel ~30ms
    expect(results.every((r) => !r.error)).toBe(true);
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
});
