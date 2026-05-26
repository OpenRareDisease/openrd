"""Vector storage backends for the FSHD medical knowledge base.

The KB_BACKEND env variable selects an implementation. See
docs/proposals/local-rag-migration.md for the broader plan.
"""

from .base import VectorBackend, BackendChunk, QueryHit
from .factory import create_backend

__all__ = ["VectorBackend", "BackendChunk", "QueryHit", "create_backend"]
