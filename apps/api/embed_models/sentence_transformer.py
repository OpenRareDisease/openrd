"""SentenceTransformers-backed embedder.

Covers both the legacy `all-MiniLM-L6-v2` model and `BAAI/bge-m3`. The
model is picked via the constructor (or KB_EMBED_MODEL env in the
factory).
"""

from __future__ import annotations

import logging
import os
from typing import List, Optional

from sentence_transformers import SentenceTransformer

from .base import Embedder

logger = logging.getLogger("fshd_kb.embed_models")

# Default dimensions for the models we ship with. Override if you add a
# new model whose dimension differs from these.
_KNOWN_DIMENSIONS = {
    "all-MiniLM-L6-v2": 384,
    "BAAI/bge-m3": 1024,
    "bge-m3": 1024,
}


class SentenceTransformerEmbedder(Embedder):
    def __init__(
        self,
        model_name: Optional[str] = None,
        local_files_only: Optional[bool] = None,
    ) -> None:
        resolved = (model_name or os.getenv("KB_EMBED_MODEL", "BAAI/bge-m3")).strip()
        self.model_name = resolved
        self.dimension = _KNOWN_DIMENSIONS.get(resolved, 0)

        local_only_env = (
            local_files_only
            if local_files_only is not None
            else os.getenv("KB_LOCAL_FILES_ONLY", "").strip() == "1"
        )

        logger.info("Loading embedding model: %s", resolved)
        try:
            self._model = SentenceTransformer(resolved, local_files_only=local_only_env)
        except Exception as first_error:
            if not local_only_env:
                logger.warning(
                    "Embedding model download failed, retrying with local_files_only=True: %s",
                    first_error,
                )
                try:
                    self._model = SentenceTransformer(resolved, local_files_only=True)
                except Exception as second_error:
                    raise RuntimeError(
                        "Failed to load embedding model. If you are offline, pre-download the "
                        "model and set KB_LOCAL_FILES_ONLY=1."
                    ) from second_error
            else:
                raise

        # Verify dimensionality once at load time so misconfiguration
        # surfaces early (and the dimension stays correct even for models
        # we haven't catalogued in _KNOWN_DIMENSIONS).
        probe = self._model.encode(["dimension probe"])
        try:
            self.dimension = len(probe[0])
        except Exception:
            pass
        logger.info("Embedding model ready: %s dim=%d", resolved, self.dimension)

    def embed_texts(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []
        return self._model.encode(texts).tolist()
