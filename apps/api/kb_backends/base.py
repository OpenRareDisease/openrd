"""Abstract interface every vector backend implements.

The interface intentionally only covers storage + retrieval. Query
embedding is done by the caller (see embed_models/) so that backends
stay storage-only and can be swapped without touching embedding logic.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set


@dataclass
class BackendChunk:
    """A chunk as the backend stores it."""

    content: str
    fingerprint: str
    source_file: str
    source_fingerprint: str
    chunk_index: int
    embedding: List[float]
    metadata: Dict[str, Any] = field(default_factory=dict)
    embed_model: Optional[str] = None


@dataclass
class QueryHit:
    """A single retrieval result returned by query_multi.

    `distance` follows the underlying backend's convention: lower means
    more similar. For cosine distance the range is [0, 2].
    """

    content: str
    metadata: Dict[str, Any]
    distance: Optional[float]
    fingerprint: Optional[str] = None
    source_file: Optional[str] = None


class VectorBackend(ABC):
    """Storage + retrieval contract for the medical KB.

    Implementations are expected to be safe to use across requests; the
    KB service holds a single backend instance for the process lifetime.
    """

    #: Identifier used in logs and audit records.
    id: str = "base"

    @abstractmethod
    def query_multi(
        self,
        query_embeddings: List[List[float]],
        fetch_k: int,
        where: Optional[Dict[str, Any]] = None,
    ) -> List[List[QueryHit]]:
        """Run a batch of vector queries.

        Returns a list parallel to query_embeddings, each entry holding up
        to `fetch_k` hits ordered by similarity (closest first).
        """

    @abstractmethod
    def upsert(self, chunks: List[BackendChunk]) -> None:
        """Insert or replace chunks. Implementations must use the chunk
        fingerprint as the dedup key."""

    @abstractmethod
    def delete_fingerprints(self, fingerprints: List[str]) -> int:
        """Delete chunks by content fingerprint. Returns number removed."""

    @abstractmethod
    def list_source_fingerprints(self, source_files: List[str]) -> Dict[str, Set[str]]:
        """Return the recorded source_fingerprint values for each
        requested source file. The value is a set so callers can
        distinguish "clean state" (`{file_fp}`) from "duplicate
        fingerprints — likely the leftover of an interrupted cleanup"
        (`{old_fp, new_fp}`) and react accordingly. Files not present
        in the backend are omitted from the result rather than mapped
        to an empty set."""

    @abstractmethod
    def delete_by_source(self, source_file: str) -> int:
        """Remove every chunk associated with the given source file."""

    def delete_by_source_other_fingerprints(
        self, source_file: str, keep_fingerprint: str
    ) -> int:
        """Remove chunks for `source_file` whose `source_fingerprint`
        does not match `keep_fingerprint`.

        Used by kb-ingest to make per-file re-ingestion crash-safe:
        upsert the new chunks first (they carry the new
        source_fingerprint), then call this to drop the stale chunks
        from the previous fingerprint. If the process crashes after
        upsert but before this call, the next run sees BOTH fingerprints
        for the same source_file and treats it as changed (the
        list_source_fingerprints grouping will surface multiple
        fingerprints), triggering re-ingestion which cleans the
        duplicates up.

        Fails closed by default: a naïve fallback to `delete_by_source`
        would wipe the just-upserted batch on backends that don't
        override this method, recreating the zero-chunk failure mode
        this method exists to prevent. Backends must opt in to the
        scoped-delete semantics explicitly; the ingest script catches
        NotImplementedError and logs a clear "stale chunks will
        persist on this backend" warning instead.
        """
        raise NotImplementedError(
            f"{self.id} backend does not implement scoped fingerprint deletion; "
            f"falling back to delete_by_source would wipe the newly-upserted batch"
        )

    def list_all_source_files(self) -> List[str]:
        """Return every distinct source_file currently in the backend.

        Used by `kb-ingest --prune` to find chunks whose source file
        was deleted on disk. Default raises NotImplementedError so
        callers can branch cleanly on backends that don't support
        pruning (Chroma cloud currently doesn't expose a cheap
        enumeration).
        """
        raise NotImplementedError(
            f"{self.id} backend does not support listing all source files"
        )

    def health(self) -> Dict[str, Any]:
        """Best-effort liveness signal. Implementations may override."""
        return {"backend": self.id, "status": "ok"}

    def close(self) -> None:
        """Release any held resources. Default is a no-op."""
