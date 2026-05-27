/**
 * AI Agents module.
 *
 * The home for retrievers (Phase 2.1), PII redaction / consent / audit
 * primitives (Phase 2.3-2.4), the LLM provider abstraction (Phase 2.2)
 * and the orchestrator that ties them together (Phase 2.5). See
 * docs/proposals/local-rag-migration.md for the broader plan.
 */
export * as audit from './audit/index.js';
export * as retrievers from './retrievers/index.js';
export * as security from './security/index.js';
