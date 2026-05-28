"""Tests for the markdown parser.

Uses real on-disk fixtures via `tmp_path` rather than mocking the
file read so we exercise the actual file IO path the ingester uses.
"""

from __future__ import annotations

from pathlib import Path

from kb_parsers.markdown_parser import MarkdownParser, parse_frontmatter


def test_parse_frontmatter_returns_empty_when_absent() -> None:
    meta, body = parse_frontmatter("just some body text")
    assert meta == {}
    assert body == "just some body text"


def test_parse_frontmatter_extracts_yaml() -> None:
    src = "---\ntitle: hello\nauthor: jx\n---\nbody"
    meta, body = parse_frontmatter(src)
    assert meta == {"title": "hello", "author": "jx"}
    assert body == "body"


def test_parse_frontmatter_handles_no_closing_delimiter() -> None:
    src = "---\ntitle: oops\nbody never closed"
    meta, body = parse_frontmatter(src)
    assert meta == {}
    assert body == src


def test_markdown_parser_returns_body_as_single_section(tmp_path: Path) -> None:
    f = tmp_path / "a.md"
    f.write_text("# H\nbody body body", encoding="utf-8")
    result = MarkdownParser().parse(f)
    assert len(result.sections) == 1
    assert "body body body" in result.sections[0].text
    assert result.sections[0].extra.get("is_markdown") is True
    assert result.metadata.get("parser") == "markdown"


def test_markdown_parser_frontmatter_flows_into_file_metadata(tmp_path: Path) -> None:
    f = tmp_path / "a.md"
    f.write_text("---\ntitle: T\n---\nbody", encoding="utf-8")
    result = MarkdownParser().parse(f)
    assert result.metadata["title"] == "T"


def test_markdown_parser_empty_body_returns_no_sections(tmp_path: Path) -> None:
    f = tmp_path / "a.md"
    f.write_text("---\ntitle: T\n---\n   \n\n  ", encoding="utf-8")
    result = MarkdownParser().parse(f)
    assert result.sections == []


def test_simple_yaml_parse_warns_on_nested_keys(caplog) -> None:
    """The PyYAML-free fallback can only handle flat key:value lines.
    Earlier versions silently dropped nested children — now a warning
    surfaces the loss so an operator sees the partial parse instead
    of a clean-looking ingest with missing metadata.

    Run via the public `parse_frontmatter`; that path takes the
    fallback only when `import yaml` fails. We can't easily force the
    import to fail here, so we call the helper directly to exercise
    the warning path without depending on the dispatch."""
    from kb_parsers.markdown_parser import _simple_yaml_parse

    src = "title: T\nauthors:\n  - alice\n  - bob\n"
    with caplog.at_level("WARNING", logger="fshd_kb.markdown_parser"):
        result = _simple_yaml_parse(src)
    assert result == {"title": "T", "authors": ""}
    assert any("authors" in record.message for record in caplog.records)
