"""The ingest reuses a stored vector when a chunk's text has not changed.

This is what makes bumping PIPELINE_VERSION affordable. The version
string is how a chunker fix reaches corpora that are ALREADY ingested —
without a bump, every existing deployment silently keeps the old chunks
and the fix reaches nobody. But the bump invalidates every file's source
fingerprint, so before this the ingest re-embedded the whole corpus to
change one document. Measured on a 16 GB laptop, re-embedding ~11,800
chunks to fix 64 drove the machine into 12 GB of swap and took a single
batch from 3.8 seconds to 50 minutes.

Re-parsing and re-chunking every file is cheap and stays. Re-embedding
text that did not change was the waste, and these tests pin that it no
longer happens — and, just as importantly, that it never happens when
the text DID change or when the model is different.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Dict, List, Set

import pytest

_HERE = Path(__file__).resolve().parent
_SCRIPT = _HERE.parent / "kb-ingest.py"


@pytest.fixture(scope="module")
def ingest_mod():
    repo_root = _HERE.parent.parent
    for path in (repo_root / "apps" / "api", _HERE.parent):
        if str(path) not in sys.path:
            sys.path.insert(0, str(path))
    spec = importlib.util.spec_from_file_location("kb_ingest_reuse_under_test", _SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


DIM = 4


class FakeEmbedder:
    """Records exactly which texts it was asked to embed. The whole
    point of the feature is that this list stays short."""

    model_name = "fake-model-v1"

    def __init__(self) -> None:
        self.seen: List[str] = []

    def embed_texts(self, texts: List[str]) -> List[List[float]]:
        self.seen.extend(texts)
        # A distinguishable vector per call so a reused one and a fresh
        # one can never be confused in an assertion.
        return [[9.0] * DIM for _ in texts]


class FakeBackend:
    id = "fake"

    def __init__(self, stored: Dict[str, List[float]] | None = None, model: str = "fake-model-v1"):
        self.stored = stored or {}
        self.model = model
        self.upserted: List[object] = []
        self.reuse_calls: List[tuple] = []

    # -- the two methods the ingest actually calls on a fresh corpus --
    def list_source_fingerprints(self, source_files: List[str]) -> Dict[str, Set[str]]:
        return {}

    def reusable_embeddings(self, fingerprints: List[str], embed_model: str):
        self.reuse_calls.append((tuple(fingerprints), embed_model))
        if embed_model != self.model:
            return {}
        return {fp: vec for fp, vec in self.stored.items() if fp in set(fingerprints)}

    def upsert(self, chunks) -> None:
        self.upserted.extend(chunks)

    def delete_by_source_other_fingerprints(self, source_file: str, keep: str) -> int:
        return 0


def _corpus(tmp_path: Path, body: str) -> Path:
    root = tmp_path / "source"
    (root / "01.cat").mkdir(parents=True)
    (root / "01.cat" / "doc.md").write_text(body, encoding="utf-8")
    (root / "02.cat").mkdir(parents=True)
    (root / "02.cat" / "other.md").write_text(
        "# 另一篇\n\n" + "第二篇文档的正文内容，足够长以便产生一个分块。" * 3,
        encoding="utf-8",
    )
    return root


BODY = "# 标题\n\n" + "这是一段足够长的中文正文，用来保证切块器至少产出一个分块。" * 3


def _run(ingest_mod, root: Path, backend: FakeBackend, embedder: FakeEmbedder):
    return ingest_mod.ingest(
        content_root=root,
        backend=backend,
        embedder=embedder,
        batch_size=2,
    )


def test_nothing_stored_means_everything_is_embedded(ingest_mod, tmp_path: Path) -> None:
    root = _corpus(tmp_path, BODY)
    backend, embedder = FakeBackend(), FakeEmbedder()
    stats = _run(ingest_mod, root, backend, embedder)

    assert stats.chunks_upserted > 0
    assert stats.chunks_reused == 0
    assert len(embedder.seen) == stats.chunks_upserted


def test_stored_vectors_are_reused_and_never_re_embedded(ingest_mod, tmp_path: Path) -> None:
    root = _corpus(tmp_path, BODY)

    # First pass with an empty backend to learn the real fingerprints.
    probe_backend, probe_embedder = FakeBackend(), FakeEmbedder()
    _run(ingest_mod, root, probe_backend, probe_embedder)
    fingerprints = [c.fingerprint for c in probe_backend.upserted]
    assert len(fingerprints) >= 2, "need at least two chunks for this to mean anything"

    # Second pass: the backend already holds a vector for every chunk.
    stored = {fp: [float(i)] * DIM for i, fp in enumerate(fingerprints)}
    backend, embedder = FakeBackend(stored), FakeEmbedder()
    stats = _run(ingest_mod, root, backend, embedder)

    assert stats.chunks_reused == len(fingerprints)
    assert embedder.seen == [], "the embedder must not be called at all"
    # Every chunk still reaches the backend, carrying its ORIGINAL vector
    # and not the 9.0 marker the fake embedder would have produced.
    assert len(backend.upserted) == len(fingerprints)
    by_fp = {c.fingerprint: c.embedding for c in backend.upserted}
    assert by_fp == stored


def test_changed_text_is_re_embedded_even_when_its_neighbours_are_not(
    ingest_mod, tmp_path: Path
) -> None:
    """The failure that would matter: a chunk whose content changed
    keeping a vector for the OLD text. Retrieval would then rank it by
    words it no longer contains, and nothing downstream could detect
    it."""
    root = _corpus(tmp_path, BODY)
    probe_backend, probe_embedder = FakeBackend(), FakeEmbedder()
    _run(ingest_mod, root, probe_backend, probe_embedder)
    stored = {c.fingerprint: [1.0] * DIM for c in probe_backend.upserted}

    # Rewrite one of the two documents. Its fingerprints change; the
    # other document's do not.
    (root / "01.cat" / "doc.md").write_text(
        "# 改过的标题\n\n" + "完全不同的正文内容，长度也足够产生一个分块。" * 3,
        encoding="utf-8",
    )
    backend, embedder = FakeBackend(stored), FakeEmbedder()
    stats = _run(ingest_mod, root, backend, embedder)

    assert stats.chunks_reused > 0, "the untouched document should still be reused"
    assert embedder.seen, "the rewritten document must be re-embedded"
    assert all("改过的标题" in text or "完全不同的正文" in text for text in embedder.seen)
    # And every upserted chunk has a vector — reused or fresh, never empty.
    assert all(c.embedding for c in backend.upserted)


def test_a_different_embed_model_is_never_reused(ingest_mod, tmp_path: Path) -> None:
    """Two models produce two incompatible geometries. A distance
    computed across them is meaningless in a way no assertion
    downstream could catch, so the model has to match exactly."""
    root = _corpus(tmp_path, BODY)
    probe_backend, probe_embedder = FakeBackend(), FakeEmbedder()
    _run(ingest_mod, root, probe_backend, probe_embedder)
    stored = {c.fingerprint: [1.0] * DIM for c in probe_backend.upserted}

    backend = FakeBackend(stored, model="some-other-model")
    embedder = FakeEmbedder()
    stats = _run(ingest_mod, root, backend, embedder)

    assert stats.chunks_reused == 0
    assert len(embedder.seen) == stats.chunks_upserted


def test_a_backend_without_the_method_still_works(ingest_mod, tmp_path: Path) -> None:
    """`reusable_embeddings` has a default on the base class that
    returns nothing, so a backend that never implements it pays the old
    cost rather than crashing. chroma_cloud is exactly that backend."""
    from kb_backends.base import VectorBackend

    root = _corpus(tmp_path, BODY)

    class Minimal(FakeBackend):
        reusable_embeddings = VectorBackend.reusable_embeddings

    backend, embedder = Minimal(), FakeEmbedder()
    stats = _run(ingest_mod, root, backend, embedder)
    assert stats.chunks_reused == 0
    assert len(embedder.seen) == stats.chunks_upserted
