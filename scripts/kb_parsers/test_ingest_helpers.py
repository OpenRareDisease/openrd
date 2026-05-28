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
