/**
 * Platform docs retriever — placeholder.
 *
 * Phase 1.4 (curated platform / product docs ingested into pgvector
 * under a separate namespace) is deferred until there is real content
 * to index. This stub satisfies the `IRetriever` shape so the
 * orchestrator can wire the retriever up today and start returning
 * results the moment the ingest pipeline lands, without further
 * code changes.
 *
 * When real content arrives:
 *   1. Pick a namespace convention (e.g. `metadata.kind = 'platform_doc'`).
 *   2. Either reuse `MedicalKbRetriever` with a namespace filter, or
 *      switch this class to call the KB service with that filter.
 *   3. Remove the `not_implemented` sentinel.
 */

import type { IRetriever, RetrieveContext, RetrieveInput, RetrieveResult } from './base.js';
import { emptyResult } from './base.js';

export class PlatformDocsRetriever implements IRetriever {
  readonly id = 'platform_docs';
  readonly kind = 'vector' as const;

  async search(input: RetrieveInput, ctx: RetrieveContext): Promise<RetrieveResult> {
    // Stub today; once the platform-docs ingest pipeline lands these
    // inputs will drive a real namespace-filtered KB query. Reference
    // them explicitly so the lint pass doesn't flag the signature.
    void input;
    void ctx;
    return emptyResult(this.id, 'not_implemented', {
      hint: 'Phase 1.4 deferred; add platform-docs ingest pipeline before enabling.',
    });
  }
}
