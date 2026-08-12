"""docker-compose.yml's kb-service `environment:` block must list every
variable the kb-service import graph reads.

That block carries no `env_file:` on purpose — the container used to
receive the whole platform credential set (JWT_SECRET, OTP_HASH_SECRET,
AI_API_KEY, the SMS keys) for a process whose only job is vector search.
Removing the catch-all made the block the ONLY delivery path, and the
comment above it instructs the next author to add a line here whenever
they add an `os.getenv()` over there. That instruction was followed by
hand and it failed the first time it was tested: KB_RELEVANCE_FLOOR — the
documented escape hatch for an operator whose corpus the 0.40 floor was
never measured against — shipped with no line in the block, so setting it
in .env changed nothing.

This file replaces the hand-check. It walks the four things Dockerfile.kb
copies into the image (knowledge.py, knowledge_service.py, kb_backends/,
embed_models/), collects every environment variable name they read, and
requires each one to appear in the block. A missed line is now a red test
instead of a dial that silently does nothing on the deploy host.
"""

from __future__ import annotations

import ast
from pathlib import Path
from typing import Dict, Iterable, List, Set, Tuple

import pytest
import yaml

_HERE = Path(__file__).resolve().parent
_REPO_ROOT = _HERE.parent.parent
_APPS_API = _REPO_ROOT / "apps" / "api"

#: Exactly what apps/api/Dockerfile.kb COPYs. Anything outside this set is
#: not in the container, so its getenv calls are irrelevant here — and
#: anything added to that COPY list has to be added here too.
_IMAGE_SOURCES = ("knowledge.py", "knowledge_service.py", "kb_backends", "embed_models")

#: Read by the huggingface / sentence-transformers stack rather than by
#: any line of our own code, so the AST scan below cannot see them. They
#: point the model cache at the kb-model-cache volume; without them a
#: container restart re-downloads ~2 GB of bge-m3 weights.
_LIBRARY_OWNED_KEYS = frozenset({"HF_HOME", "SENTENCE_TRANSFORMERS_HOME"})


def _iter_python_files() -> Iterable[Path]:
    for entry in _IMAGE_SOURCES:
        target = _APPS_API / entry
        assert target.exists(), f"{target} is COPYed by Dockerfile.kb but missing"
        if target.is_dir():
            yield from sorted(target.rglob("*.py"))
        else:
            yield target


def _callee_path(func: ast.AST) -> Tuple[str, ...]:
    """Flatten `os.environ.get` into `("os", "environ", "get")`."""
    parts: List[str] = []
    node = func
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
    else:
        return ()
    return tuple(reversed(parts))


_DIRECT_READERS = {
    ("os", "getenv"),
    ("os", "environ", "get"),
    ("os", "environ", "setdefault"),
    ("environ", "get"),
    ("environ", "setdefault"),
    ("getenv",),
}


def _env_reads(tree: ast.AST) -> Tuple[Set[str], Set[Tuple[str, int]]]:
    """Names read directly, plus (helper, argument index) pairs.

    The indirection matters: `kb_backends/pgvector.py` reads
    KB_PG_POOL_MIN / KB_PG_POOL_MAX through a local `_env_int(name,
    default)` wrapper, so a scan that only looked at literal arguments to
    `os.getenv` would miss two of the block's own entries and would go on
    missing the next wrapper someone writes.
    """
    literals: Set[str] = set()
    helpers: Set[Tuple[str, int]] = set()

    for node in ast.walk(tree):
        # os.environ['X'] — a read as much as os.environ.get('X').
        if isinstance(node, ast.Subscript):
            if _callee_path(node.value) in {("os", "environ"), ("environ",)} and isinstance(
                node.slice, ast.Constant
            ):
                literals.add(str(node.slice.value))
            continue
        if not isinstance(node, ast.Call):
            continue
        if _callee_path(node.func) not in _DIRECT_READERS or not node.args:
            continue
        first = node.args[0]
        if isinstance(first, ast.Constant) and isinstance(first.value, str):
            literals.add(first.value)
            continue
        # Non-literal: the enclosing function is a wrapper. Record which
        # of its parameters carries the name so its call sites can be
        # resolved below.
        if isinstance(first, ast.Name):
            for enclosing in ast.walk(tree):
                if not isinstance(enclosing, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                if node not in set(ast.walk(enclosing)):
                    continue
                params = [a.arg for a in enclosing.args.args]
                if first.id in params:
                    helpers.add((enclosing.name, params.index(first.id)))
    return literals, helpers


def _resolve_helpers(tree: ast.AST, helpers: Set[Tuple[str, int]]) -> Set[str]:
    found: Set[str] = set()
    by_name: Dict[str, int] = {name: index for name, index in helpers}
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        path = _callee_path(node.func)
        if not path:
            continue
        index = by_name.get(path[-1])
        if index is None or len(node.args) <= index:
            continue
        arg = node.args[index]
        if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
            found.add(arg.value)
    return found


def env_names_read_by_kb_service() -> Set[str]:
    names: Set[str] = set()
    for path in _iter_python_files():
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        literals, helpers = _env_reads(tree)
        names |= literals
        names |= _resolve_helpers(tree, helpers)
    return names


@pytest.fixture(scope="module")
def kb_service_compose() -> dict:
    compose = yaml.safe_load((_REPO_ROOT / "docker-compose.yml").read_text(encoding="utf-8"))
    return compose["services"]["kb-service"]


def test_the_scan_finds_the_known_readers() -> None:
    """Guard the guard.

    Every assertion below is only as good as the scan, and a scan that
    silently stopped resolving anything would make the contract tests
    pass by finding nothing. These four are load-bearing shapes:
    a plain `os.getenv` literal, a wrapper-resolved name, an
    `os.environ.setdefault`, and a name read from a subpackage.
    """
    names = env_names_read_by_kb_service()
    assert "KB_FINAL_N" in names  # os.getenv literal, knowledge.py
    assert "KB_PG_POOL_MAX" in names  # via _env_int, kb_backends/pgvector.py
    assert "HF_ENDPOINT" in names  # os.environ.setdefault, knowledge_service.py
    assert "KB_EMBED_MODEL" in names  # embed_models/
    assert len(names) >= 20, sorted(names)


def test_kb_service_has_no_env_file(kb_service_compose: dict) -> None:
    """The premise of everything else here. If someone re-adds
    `env_file: - .env` the exhaustiveness rule stops mattering — and the
    credential set this container was deliberately cut off from comes
    back with it."""
    assert "env_file" not in kb_service_compose


def test_every_env_var_the_kb_service_reads_is_in_the_compose_block(
    kb_service_compose: dict,
) -> None:
    declared = set(kb_service_compose["environment"].keys())
    missing = sorted(env_names_read_by_kb_service() - declared)
    assert not missing, (
        "read by the kb-service import graph but absent from the kb-service "
        "`environment:` block in docker-compose.yml, so the container can never "
        f"receive them: {missing}"
    )


def test_every_interpolation_in_the_block_has_a_line_in_env_example(
    kb_service_compose: dict,
) -> None:
    """Third link in the same chain.

    `KB_RELEVANCE_FLOOR: ${KB_RELEVANCE_FLOOR:-}` only delivers anything
    if the operator knows the name exists, and `.env` is not in the repo —
    .env.example is where they find out. A `${VAR}` with no line there is
    a dial documented only in the compose file the operator is not
    editing. KB_LOCAL_FILES_ONLY and CHROMA_TENANT were in exactly that
    state alongside KB_RELEVANCE_FLOOR.
    """
    import re

    example = (_REPO_ROOT / ".env.example").read_text(encoding="utf-8")
    documented = set(re.findall(r"(?m)^#?\s*([A-Z][A-Z0-9_]*)=", example))
    interpolated: Set[str] = set()
    for value in kb_service_compose["environment"].values():
        if isinstance(value, str):
            interpolated |= set(re.findall(r"\$\{([A-Za-z_][A-Za-z0-9_]*)", value))
    missing = sorted(interpolated - documented)
    assert not missing, (
        "interpolated by the kb-service `environment:` block but named nowhere "
        f"in .env.example, so an operator has no way to know it exists: {missing}"
    )


def test_the_compose_block_declares_nothing_the_kb_service_ignores(
    kb_service_compose: dict,
) -> None:
    """The other direction. A key left behind after its reader was
    deleted is a dial an operator can turn with no effect — the same
    failure as a missing line, arrived at from the opposite side."""
    declared = set(kb_service_compose["environment"].keys())
    unread = sorted(declared - env_names_read_by_kb_service() - _LIBRARY_OWNED_KEYS)
    assert not unread, (
        "declared in the kb-service `environment:` block but read by nothing "
        "the image contains; either delete the line or add it to "
        f"_LIBRARY_OWNED_KEYS with the reason: {unread}"
    )
