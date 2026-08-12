"""The ingest reuses a stored vector when a chunk's text has not changed.

This is what makes bumping PIPELINE_VERSION affordable. The version
string is how a chunker fix reaches corpora that are ALREADY ingested —
without a bump, every existing deployment silently keeps the old chunks
and the fix reaches nobody. But the bump invalidates every file's source
fingerprint, so before this the ingest re-embedded the whole corpus to
change one document. Measured on a 16 GB laptop, re-embedding ~11,800
chunks to fix 64 drove the machine into 12 GB of swap and took a single
batch from 3.8 seconds to 50 minutes.

Re-parsing and re-chunking every file stays, and is now most of the
cost of a bump: 299 s over the 235-file corpus, 84 pages of it
rasterised at 300 DPI and run through tesseract (30 of the 84 come back
with usable text — that smaller number is `pages_via_ocr`, not the
rasterise count). Re-embedding text that did not change was the waste,
and these tests pin that it no longer happens — and, just as
importantly, that it never happens when the text DID change or when the
model is different.

What a bump costs in embedding is therefore whatever text really did
move. On the corpus stored today that is 1,046 of the 11,110 chunks
the 211 indexed files produce — 890 of them in files that were only
partly ingested to begin with, the rest in files whose stored text
predates a parser fix; see PIPELINE_VERSION in scripts/kb-ingest.py.
The tests below run on a synthetic corpus where nothing moves, so they
pin the zero-embedding floor, not that figure.

Scope, because one test below used to carry a name that promised more
than anything here can deliver: every test in this file drives a
`FakeBackend` that re-implements the cache read in Python, so what they
pin is the INGEST's half of the contract — which fingerprints it
offers, which model name it forwards, what it does with what comes
back. The SQL that actually enforces the
model match and the NULL-embedding skip lives in
`PgVectorBackend.reusable_embeddings`, and is tested against a real
Postgres in test_pgvector_reusable_embeddings.py. Deleting either guard
from that SQL leaves every test in THIS file green.
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


def test_the_ingest_forwards_its_model_name_and_re_embeds_on_a_miss(
    ingest_mod, tmp_path: Path
) -> None:
    """Two models produce two incompatible geometries, so the model has
    to match exactly — but the match itself is the backend's job, and
    this fake performs it. What this test can prove is the ingest side:
    it passes `embedder.model_name` down rather than some other string
    or nothing, and when the backend answers with nothing it embeds
    every chunk instead of upserting vectorless ones.

    The exact match in the shipped SQL is pinned in
    test_pgvector_reusable_embeddings.py::test_a_different_embed_model_is_not_reused.
    """
    root = _corpus(tmp_path, BODY)
    probe_backend, probe_embedder = FakeBackend(), FakeEmbedder()
    _run(ingest_mod, root, probe_backend, probe_embedder)
    stored = {c.fingerprint: [1.0] * DIM for c in probe_backend.upserted}

    backend = FakeBackend(stored, model="some-other-model")
    embedder = FakeEmbedder()
    stats = _run(ingest_mod, root, backend, embedder)

    assert stats.chunks_reused == 0
    assert len(embedder.seen) == stats.chunks_upserted
    # The forwarded string is the embedder's own model name, and every
    # pending fingerprint went with it — the two inputs the SQL guard
    # then has to match on.
    assert [model for _, model in backend.reuse_calls] == [FakeEmbedder.model_name]
    offered = set(backend.reuse_calls[0][0])
    assert offered == {c.fingerprint for c in backend.upserted}
    assert all(c.embedding == [9.0] * DIM for c in backend.upserted)


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


class PersistingFakeBackend(FakeBackend):
    """A FakeBackend that also remembers what an earlier pass stored, so
    the unchanged-file check has something to answer with. The plain
    FakeBackend reports no source fingerprints at all, which makes every
    file look new and hides the case below."""

    def __init__(self, source_fps: Dict[str, Set[str]] | None = None, **kwargs):
        super().__init__(**kwargs)
        self.source_fps = source_fps or {}

    def list_source_fingerprints(self, source_files: List[str]) -> Dict[str, Set[str]]:
        wanted = set(source_files)
        return {key: fps for key, fps in self.source_fps.items() if key in wanted}


def test_a_pipeline_version_bump_re_chunks_every_file_and_re_embeds_none(
    ingest_mod, tmp_path: Path, monkeypatch
) -> None:
    """The claim the PIPELINE_VERSION comment and
    `backfill_authority`'s docstring both make about the same lever:
    a bump costs a full re-read/re-parse/re-chunk of every file, and
    costs no embedding at all for text that did not move.

    Both halves have to hold together. The first is why the bump is not
    free (299 s of parsing on the FSHD corpus); the second is why it is
    affordable, and it holds only because `chunk_fingerprint` excludes
    PIPELINE_VERSION. Fold the version into that hash and this test is
    the one that notices.
    """
    root = _corpus(tmp_path, BODY)

    first, first_embedder = PersistingFakeBackend(), FakeEmbedder()
    stats = _run(ingest_mod, root, first, first_embedder)
    assert stats.files_new == 2
    assert len(first_embedder.seen) == stats.chunks_upserted

    source_fps = {c.source_file: {c.source_fingerprint} for c in first.upserted}
    stored = {c.fingerprint: [7.0] * DIM for c in first.upserted}

    # Control: no bump, nothing on disk changed. Every file reports
    # unchanged, so nothing is even parsed.
    same = PersistingFakeBackend(source_fps, stored=stored)
    same_embedder = FakeEmbedder()
    unchanged = _run(ingest_mod, root, same, same_embedder)
    assert unchanged.files_unchanged == 2
    assert unchanged.chunks_upserted == 0
    assert same_embedder.seen == []

    monkeypatch.setattr(ingest_mod, "PIPELINE_VERSION", "v4.test-bump")
    bumped = PersistingFakeBackend(source_fps, stored=stored)
    bumped_embedder = FakeEmbedder()
    after = _run(ingest_mod, root, bumped, bumped_embedder)

    # Every file was re-read, re-parsed, re-chunked and re-upserted...
    assert after.files_unchanged == 0
    assert after.files_updated == 2
    assert after.chunks_upserted == len(stored)
    # ...and not one chunk was handed to the embedder.
    assert after.chunks_reused == len(stored)
    assert bumped_embedder.seen == []
    assert {c.fingerprint: c.embedding for c in bumped.upserted} == stored
