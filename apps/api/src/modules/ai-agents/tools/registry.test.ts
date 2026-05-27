import { describe, expect, it } from 'vitest';

import type { ITool, ToolExecutionResult } from './base.js';
import { ToolRegistry } from './registry.js';
import type { ConsentLevel } from '../retrievers/base.js';

const makeTool = (name: string, minConsent?: ConsentLevel): ITool => ({
  name,
  description: `${name} test stub`,
  parametersSchema: { type: 'object', properties: {} },
  minConsent,
  parseArgs: () => ({}),
  execute: async (): Promise<ToolExecutionResult> => ({
    retrieval: { retrieverId: name, chunks: [], citations: [], metadata: {} },
    display: `${name}: 0`,
  }),
});

describe('ToolRegistry', () => {
  it('registers and retrieves tools by name', () => {
    const registry = new ToolRegistry();
    const a = makeTool('a');
    registry.register(a);
    expect(registry.get('a')).toBe(a);
    expect(registry.get('missing')).toBeUndefined();
    expect(registry.all()).toEqual([a]);
  });

  it('refuses duplicate registrations', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('dup'));
    expect(() => registry.register(makeTool('dup'))).toThrow(/already registered/);
  });

  it('filters tools by consent level using minConsent', () => {
    const registry = new ToolRegistry();
    const open = makeTool('search_medical_kb');
    const basic = makeTool('get_my_profile', 'basic');
    const precise = makeTool('precise_only', 'precise');
    registry.register(open).register(basic).register(precise);

    expect(registry.availableFor('none').map((t) => t.name)).toEqual(['search_medical_kb']);
    expect(registry.availableFor('basic').map((t) => t.name)).toEqual([
      'search_medical_kb',
      'get_my_profile',
    ]);
    expect(registry.availableFor('precise').map((t) => t.name)).toEqual([
      'search_medical_kb',
      'get_my_profile',
      'precise_only',
    ]);
  });
});
