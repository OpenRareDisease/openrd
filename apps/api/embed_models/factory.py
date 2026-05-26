"""Embedder factory: pick implementation from env."""

from __future__ import annotations

import logging
import os
from typing import Optional

from .base import Embedder

logger = logging.getLogger("fshd_kb.embed_models.factory")


def create_embedder(model_name: Optional[str] = None) -> Embedder:
    resolved = (model_name or os.getenv("KB_EMBED_MODEL", "all-MiniLM-L6-v2")).strip()
    logger.info("Creating embedder: %s", resolved)

    # All current implementations route through SentenceTransformers,
    # but the factory boundary keeps the door open for non-ST backends
    # (e.g. an external embedding service) later.
    from .sentence_transformer import SentenceTransformerEmbedder

    return SentenceTransformerEmbedder(model_name=resolved)
