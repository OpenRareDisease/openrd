"""Embedder contract."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import List


class Embedder(ABC):
    """Turns text into vectors.

    All implementations are expected to produce the same dimensionality
    regardless of input. Dimensionality must match the column type in
    `kb_chunks.embedding` (currently 1024 for bge-m3, 384 for MiniLM).
    """

    #: Human-readable identifier used in logs and stored on each chunk
    #: so we can detect model mismatches during ingest.
    model_name: str = "base"

    #: Output vector dimensionality. Backends use it to sanity-check.
    dimension: int = 0

    @abstractmethod
    def embed_texts(self, texts: List[str]) -> List[List[float]]:
        """Embed a batch of strings. Order must match the input."""

    def embed_one(self, text: str) -> List[float]:
        """Convenience wrapper around `embed_texts`."""
        return self.embed_texts([text])[0]
