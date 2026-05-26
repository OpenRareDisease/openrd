"""Backend factory: pick an implementation from env."""

from __future__ import annotations

import logging
import os
from typing import Optional

from .base import VectorBackend

logger = logging.getLogger("fshd_kb.factory")


def create_backend(name: Optional[str] = None) -> VectorBackend:
    """Build a VectorBackend instance.

    The name comes from the explicit argument first, then the
    KB_BACKEND env, then a safe default of 'chroma_cloud' (preserving
    the legacy behaviour during rollout).
    """

    resolved = (name or os.getenv("KB_BACKEND", "chroma_cloud")).strip().lower()
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
