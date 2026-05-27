/**
 * Tool registry.
 *
 * Holds the set of tools the planner can call, indexed by name.
 * `availableFor(consentLevel)` returns the subset the planner is
 * allowed to advertise given the user's consent — patient tools are
 * filtered out when consent is `none`, even though the underlying
 * retriever would also refuse. Filtering at the registry level keeps
 * the planner from even seeing tools it can't legitimately use.
 *
 * The registry is intentionally small + synchronous. The orchestrator
 * constructs one per request (or once per process, depending on
 * future caching needs) so swapping a tool implementation for tests
 * is a one-line `register(new FakeTool())`.
 */

import type { ITool } from './base.js';
import type { ConsentLevel } from '../retrievers/base.js';

const CONSENT_RANK: Record<ConsentLevel, number> = {
  none: 0,
  basic: 1,
  precise: 2,
};

const meetsConsent = (have: ConsentLevel, need: ConsentLevel | undefined): boolean => {
  if (!need) return true;
  return CONSENT_RANK[have] >= CONSENT_RANK[need];
};

export class ToolRegistry {
  private readonly tools = new Map<string, ITool>();

  register(tool: ITool): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  get(name: string): ITool | undefined {
    return this.tools.get(name);
  }

  /** Every registered tool, regardless of consent. Use for diagnostics. */
  all(): ITool[] {
    return [...this.tools.values()];
  }

  /** Tools the planner may advertise at the given consent level. */
  availableFor(consentLevel: ConsentLevel): ITool[] {
    return this.all().filter((tool) => meetsConsent(consentLevel, tool.minConsent));
  }
}
