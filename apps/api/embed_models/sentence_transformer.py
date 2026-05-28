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

#: Models the embedder is allowed to load. `KB_EMBED_MODEL` is
#: validated against this set so a misconfigured deploy (or a leaked
#: env / poisoned Helm chart) can't swap in an attacker-controlled HF
#: repo. SentenceTransformers can auto-execute modeling code from
#: certain HF models depending on version; this is a hard fence around
#: that surface.
_ALLOWED_MODELS = frozenset(_KNOWN_DIMENSIONS.keys())


class SentenceTransformerEmbedder(Embedder):
    def __init__(
        self,
        model_name: Optional[str] = None,
        local_files_only: Optional[bool] = None,
    ) -> None:
        resolved = (model_name or os.getenv("KB_EMBED_MODEL", "BAAI/bge-m3")).strip()
        if resolved not in _ALLOWED_MODELS:
            raise RuntimeError(
                f"Embedding model '{resolved}' is not on the allowlist "
                f"{sorted(_ALLOWED_MODELS)}. Refusing to load arbitrary "
                f"models from KB_EMBED_MODEL — extend _ALLOWED_MODELS "
                f"and _KNOWN_DIMENSIONS in this file to add a new one."
            )
        self.model_name = resolved
        self.dimension = _KNOWN_DIMENSIONS.get(resolved, 0)

        local_only_env = (
            local_files_only
            if local_files_only is not None
            else os.getenv("KB_LOCAL_FILES_ONLY", "").strip() == "1"
        )

        logger.info("Loading embedding model: %s (local_files_only=%s)", resolved, local_only_env)
        try:
            # `trust_remote_code` defaults to False on recent
            # transformers / sentence-transformers releases but pin it
            # explicitly so a future SDK change can't silently flip
            # to True for one of the allowed models. Older SDK
            # versions reject the kwarg → fall back to the kwarg-less
            # form, which still defaults to False there.
            try:
                self._model = SentenceTransformer(
                    resolved,
                    local_files_only=local_only_env,
                    trust_remote_code=False,
                )
            except TypeError:
                self._model = SentenceTransformer(
                    resolved, local_files_only=local_only_env,
                )
        except Exception as load_error:
            # The previous implementation retried with local_files_only=True
            # whenever the online load failed, but that retry direction is
            # wrong (the model isn't cached locally either if the download
            # just failed) and the synthetic "please pre-download" error
            # message hid the real cause -- network, HF rate limit, disk
            # full, model rename, etc. Surface the original error.
            mode = "local cache" if local_only_env else "download / cache"
            raise RuntimeError(
                f"Failed to load embedding model '{resolved}' from {mode}: {load_error}"
            ) from load_error

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
        # Normalize so cosine distance (<=>) is well-defined and bounded
        # to [0, 2] regardless of the underlying model. Without this,
        # bge-m3 returns un-normalised vectors and any distance threshold
        # (e.g. "ignore hits with distance > 0.3") becomes model-specific
        # and unstable across batches.
        return self._model.encode(texts, normalize_embeddings=True).tolist()
