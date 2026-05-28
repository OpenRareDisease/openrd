"""Backend factory: pick an implementation from env."""

from __future__ import annotations

import logging
import os
from typing import Optional

from .base import VectorBackend

logger = logging.getLogger("fshd_kb.factory")


def create_backend(name: Optional[str] = None) -> VectorBackend:
    """Build a VectorBackend instance.

    Resolution order: explicit `name` argument, then KB_BACKEND env,
    then `pgvector` as the safe default. The Phase 1.4 ingest (PR #30)
    landed 12352 chunks in local pgvector and the runtime stack
    (kb-service + ingest + dev-grant-consent + docker compose) was
    rolled over to it in follow-up PRs; making `pgvector` the implicit
    default closes issue #21 and means a forgotten env now hits the
    local KB instead of falling back to Chroma cloud (which carries
    the legacy 7309-chunk corpus we no longer write to). Explicit
    `KB_BACKEND=chroma_cloud` is still the documented emergency
    rollback path.
    """

    resolved = (name or os.getenv("KB_BACKEND", "pgvector")).strip().lower()
    logger.info("Initializing KB backend: %s", resolved)

    if resolved in ("pgvector", "postgres", "pg"):
        from .pgvector import PgVectorBackend

        return PgVectorBackend()

    if resolved in ("chroma_cloud", "chroma", "cloud"):
        from .chroma_cloud import ChromaCloudBackend

        return ChromaCloudBackend()

    raise RuntimeError(
        f"Unknown KB_BACKEND={resolved!r}. Expected 'pgvector' or 'chroma_cloud'."
    )
