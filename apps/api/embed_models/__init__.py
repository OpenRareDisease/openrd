"""Embedding models used by the FSHD KB.

The Embedder interface is intentionally minimal so backends remain
storage-only and embedding swaps are independent of vector storage.
"""

from .base import Embedder
from .factory import create_embedder

__all__ = ["Embedder", "create_embedder"]
