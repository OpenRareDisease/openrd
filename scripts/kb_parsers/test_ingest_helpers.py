"""Tests for the small helpers exported by `scripts/kb-ingest.py`
that don't fit the per-format parser modules.

The script's filename uses a hyphen so it isn't importable via a
regular `from ... import ...`; we load it through importlib once and
re-use the module across tests. The helpers under test are pure
functions over `Path` / strings, so no DB or filesystem fixtures
beyond `tmp_path` are needed.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve().parent
_SCRIPT = _HERE.parent / "kb-ingest.py"


@pytest.fixture(scope="module")
def ingest_mod():
    # `scripts/` and `apps/api/` need to be on sys.path so the
    # script's own imports (`kb_backends`, `embed_models`, etc.)
    # resolve when the module body executes.
    repo_root = _HERE.parent.parent
    for path in (repo_root / "apps" / "api", _HERE.parent):
        if str(path) not in sys.path:
            sys.path.insert(0, str(path))
    spec = importlib.util.spec_from_file_location("kb_ingest_under_test", _SCRIPT)
    assert spec and spec.loader, "could not build spec for kb-ingest.py"
    module = importlib.util.module_from_spec(spec)
    # @dataclass classes defined inside the loaded module reflect on
    # `sys.modules[cls.__module__]` during their post-init; without
    # this entry that lookup returns None and crashes the import.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


# ----------------------------------------------- resolve_effective_root

def test_strips_single_subdir_wrapper(ingest_mod, tmp_path: Path) -> None:
    """The common case: unzipping FSHD_知识库.zip into source/
    leaves the real category folders one level deeper. Without
    stripping the wrapper, `category` ends up as the wrapper name
    instead of "01.疾病定义和科普" / etc."""
    root = tmp_path / "source"
    wrapper = root / "FSHD_知识库"
    (wrapper / "01.cat" / "doc.pdf").parent.mkdir(parents=True)
    (wrapper / "01.cat" / "doc.pdf").write_text("x")
    (wrapper / "02.cat" / "doc.pdf").parent.mkdir(parents=True)
    (wrapper / "02.cat" / "doc.pdf").write_text("y")
    assert ingest_mod.resolve_effective_root(root) == wrapper


def test_keeps_root_when_multiple_subdirs(ingest_mod, tmp_path: Path) -> None:
    """Two top-level dirs => no wrapper; the operator clearly meant
    the source root to BE the corpus root."""
    root = tmp_path / "source"
    (root / "01.cat").mkdir(parents=True)
    (root / "02.cat").mkdir(parents=True)
    assert ingest_mod.resolve_effective_root(root) == root


def test_keeps_root_when_files_alongside_subdir(ingest_mod, tmp_path: Path) -> None:
    """README.md or a stray PDF next to the wrapper means we should
    NOT descend -- the operator probably wants both ingested."""
    root = tmp_path / "source"
    (root / "FSHD_知识库" / "01.cat").mkdir(parents=True)
    (root / "loose-file.pdf").write_text("x")
    assert ingest_mod.resolve_effective_root(root) == root


def test_ignores_hidden_and_macosx(ingest_mod, tmp_path: Path) -> None:
    """`.DS_Store` and `__MACOSX/` should not count toward the
    one-and-only-one-subdir check."""
    root = tmp_path / "source"
    wrapper = root / "FSHD_知识库"
    wrapper.mkdir(parents=True)
    (root / "__MACOSX").mkdir()
    (root / ".DS_Store").write_text("")
    assert ingest_mod.resolve_effective_root(root) == wrapper


def test_no_op_when_root_is_missing_or_file(ingest_mod, tmp_path: Path) -> None:
    missing = tmp_path / "does-not-exist"
    assert ingest_mod.resolve_effective_root(missing) == missing
    file_root = tmp_path / "looks-like-root.txt"
    file_root.write_text("x")
    assert ingest_mod.resolve_effective_root(file_root) == file_root


# ----------------------------------------------- _derive_metadata_from_path

def test_category_comes_from_effective_root(ingest_mod) -> None:
    """When the ingester operates on the wrapper-stripped root, the
    relative path's first segment is the real category. Regression
    pin for the bot finding."""
    meta = ingest_mod._derive_metadata_from_path("01.疾病定义和科普/sub/doc.pdf")
    assert meta["category"] == "01.疾病定义和科普"
    assert meta["folder_path"] == "01.疾病定义和科普/sub"
    assert meta["source_file"] == "doc.pdf"


def test_category_empty_for_root_level_file(ingest_mod) -> None:
    meta = ingest_mod._derive_metadata_from_path("loose.pdf")
    assert meta["category"] == ""
    assert meta["folder_path"] == ""
    assert meta["source_file"] == "loose.pdf"


# ----------------------------------------------- defaults

def test_default_backend_is_pgvector(ingest_mod) -> None:
    """The ingest banner used to print 'pgvector' while the factory
    silently defaulted to chroma_cloud, so a fresh clone with no
    KB_BACKEND env hit Chroma. Pin the corrected default here."""
    assert ingest_mod.DEFAULT_BACKEND == "pgvector"


def test_default_content_root_points_at_source(ingest_mod) -> None:
    """Default root should match the path documented in proposal §4.3
    and gitignored in `.gitignore` -- not the parent."""
    assert ingest_mod.DEFAULT_CONTENT_ROOT.name == "source"
    assert ingest_mod.DEFAULT_CONTENT_ROOT.parent.name == "medical-kb"


# ----------------------------------------------- _prune_orphans

class _FakeBackend:
    """Minimal in-memory stand-in for VectorBackend used only by the
    prune tests. Records every delete_by_source call so the assertion
    surface stays small."""

    def __init__(self, source_files):
        self.source_files = list(source_files)
        self.deleted = []  # list of (source_key, count_returned)

    def list_all_source_files(self):
        return list(self.source_files)

    def delete_by_source(self, source_key):
        # Pretend each file had a deterministic chunk count for the
        # test assertions; reality differs but the helper only sums it.
        count = 5
        self.deleted.append((source_key, count))
        return count


def test_prune_deletes_orphans(ingest_mod, tmp_path):
    # On disk: one .md and one .pdf survive; in the backend we
    # claim three more source_files exist that have no on-disk
    # counterpart, so they should be pruned.
    (tmp_path / "alive.md").write_text("# alive", encoding="utf-8")
    (tmp_path / "alive.pdf").write_bytes(b"%PDF-1.4 dummy")

    backend = _FakeBackend(
        source_files=[
            "alive.md",
            "alive.pdf",
            "orphan-1.pdf",
            "orphan-2.docx",
            "subdir/orphan-3.md",
        ]
    )
    stats = ingest_mod.IngestStats()
    ingest_mod._prune_orphans(
        content_root=tmp_path,
        backend=backend,
        matched_source_keys={"alive.md", "alive.pdf"},
        dry_run=False,
        stats=stats,
        only_filter_active=False,
    )
    deleted_keys = sorted(k for k, _ in backend.deleted)
    assert deleted_keys == [
        "orphan-1.pdf",
        "orphan-2.docx",
        "subdir/orphan-3.md",
    ]
    assert stats.files_pruned == 3
    assert stats.chunks_pruned == 15  # 3 × 5 per fake


def test_prune_dry_run_does_not_delete(ingest_mod, tmp_path):
    (tmp_path / "alive.md").write_text("alive", encoding="utf-8")
    backend = _FakeBackend(source_files=["alive.md", "orphan.pdf"])
    stats = ingest_mod.IngestStats()
    ingest_mod._prune_orphans(
        content_root=tmp_path,
        backend=backend,
        matched_source_keys={"alive.md"},
        dry_run=True,
        stats=stats,
        only_filter_active=False,
    )
    assert backend.deleted == []
    assert stats.files_pruned == 1  # counted but not executed
    assert stats.chunks_pruned == 0
    assert any("would delete orphan.pdf" in a for a in stats.actions)


def test_prune_skipped_when_only_filter_active(ingest_mod, tmp_path):
    """--only narrows the on-disk walk to a single extension; pruning
    against that walk would mis-classify out-of-scope formats as
    orphans, so the helper must skip and log a clear warning."""
    backend = _FakeBackend(source_files=["a.md", "b.pdf"])
    stats = ingest_mod.IngestStats()
    ingest_mod._prune_orphans(
        content_root=tmp_path,
        backend=backend,
        matched_source_keys=set(),
        dry_run=False,
        stats=stats,
        only_filter_active=True,
    )
    assert backend.deleted == []
    assert stats.files_pruned == 0
    assert any("skipped (--only filter active" in a for a in stats.actions)


def test_prune_skipped_when_backend_lacks_support(ingest_mod, tmp_path):
    """When the backend (e.g. Chroma cloud) raises NotImplementedError
    on `list_all_source_files`, prune logs the reason and bails out
    instead of crashing the whole ingest."""

    class Unsupported:
        def list_all_source_files(self):
            raise NotImplementedError("chroma_cloud has no enumeration")

        def delete_by_source(self, _key):  # pragma: no cover
            raise AssertionError("should not be called")

    stats = ingest_mod.IngestStats()
    ingest_mod._prune_orphans(
        content_root=tmp_path,
        backend=Unsupported(),
        matched_source_keys=set(),
        dry_run=False,
        stats=stats,
        only_filter_active=False,
    )
    assert stats.files_pruned == 0
    assert any("chroma_cloud has no enumeration" in a for a in stats.actions)


def test_prune_no_orphans_logs_clear_message(ingest_mod, tmp_path):
    (tmp_path / "a.md").write_text("a", encoding="utf-8")
    backend = _FakeBackend(source_files=["a.md"])
    stats = ingest_mod.IngestStats()
    ingest_mod._prune_orphans(
        content_root=tmp_path,
        backend=backend,
        matched_source_keys={"a.md"},
        dry_run=False,
        stats=stats,
        only_filter_active=False,
    )
    assert backend.deleted == []
    assert stats.files_pruned == 0
    assert any("no orphans" in a for a in stats.actions)
