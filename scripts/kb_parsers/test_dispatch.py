"""Tests for the parser dispatch shape.

We don't exercise the parsers' actual file IO here — that lives in
the per-format test modules. This file pins:

  - every parser exposes a unique non-empty `parser_name`
  - every parser declares at least one extension
  - extensions don't collide across parsers (one path -> one parser)
  - `get_parser_for` returns the registered parser for known
    extensions and None for unknown
"""

from __future__ import annotations

from pathlib import Path

from kb_parsers import ALL_PARSERS, get_parser_for


def test_each_parser_has_unique_name() -> None:
    names = [p.parser_name for p in ALL_PARSERS]
    assert len(names) == len(set(names)), f"duplicate parser names: {names}"
    assert "" not in names


def test_each_parser_has_extensions() -> None:
    for p in ALL_PARSERS:
        assert p.extensions, f"{p.parser_name} declares no extensions"
        for ext in p.extensions:
            assert ext.startswith("."), f"{p.parser_name}: {ext!r} missing leading dot"
            assert ext == ext.lower(), f"{p.parser_name}: {ext!r} must be lowercase"


def test_extensions_do_not_collide() -> None:
    seen: dict[str, str] = {}
    for p in ALL_PARSERS:
        for ext in p.extensions:
            assert ext not in seen, (
                f"extension {ext!r} claimed by both "
                f"{seen[ext]} and {p.parser_name}"
            )
            seen[ext] = p.parser_name


def test_get_parser_for_dispatches_by_extension() -> None:
    assert get_parser_for(Path("a.pdf")).parser_name == "pdf"
    assert get_parser_for(Path("a.PDF")).parser_name == "pdf"  # case-insensitive
    assert get_parser_for(Path("a.docx")).parser_name == "docx"
    assert get_parser_for(Path("a.md")).parser_name == "markdown"
    assert get_parser_for(Path("a.png")).parser_name == "image"
    assert get_parser_for(Path("a.html")).parser_name == "html"


def test_get_parser_for_returns_none_when_unknown() -> None:
    assert get_parser_for(Path("a.exe")) is None
    assert get_parser_for(Path("a")) is None
    assert get_parser_for(Path("a.")) is None
