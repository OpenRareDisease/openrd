"""Tests for the HTML parser."""

from __future__ import annotations

from pathlib import Path

from kb_parsers.html_parser import HtmlParser


def test_html_parser_strips_script_and_style(tmp_path: Path) -> None:
    f = tmp_path / "a.html"
    f.write_text(
        """
        <html><head><title>Hi</title>
          <style>body{color:red}</style>
        </head><body>
          <nav>menu</nav>
          <p>real content here</p>
          <script>console.log('nope')</script>
        </body></html>
        """,
        encoding="utf-8",
    )
    result = HtmlParser().parse(f)
    assert len(result.sections) == 1
    text = result.sections[0].text
    assert "real content here" in text
    assert "console.log" not in text
    assert "menu" not in text  # <nav> is dropped
    assert "color:red" not in text
    assert result.metadata["html_title"] == "Hi"


def test_html_parser_empty_body_returns_no_sections(tmp_path: Path) -> None:
    f = tmp_path / "a.html"
    f.write_text("<html><head></head><body></body></html>", encoding="utf-8")
    result = HtmlParser().parse(f)
    assert result.sections == []
    assert result.metadata.get("empty_body") is True
