"""HTML / HTM parser via BeautifulSoup.

The corpus has a handful of `.htm` / `.html` files that are usually
saved-page exports of patient resources or vendor whitepapers. We
strip scripts / styles / navigation chrome and emit the visible body
text as a single `ParsedSection`.
"""

from __future__ import annotations

from pathlib import Path

from .base import Parser, ParseResult, ParsedSection

_DROP_TAGS = ("script", "style", "noscript", "nav", "header", "footer", "aside")


class HtmlParser(Parser):
    extensions = (".htm", ".html")
    parser_name = "html"

    def parse(self, path: Path) -> ParseResult:
        try:
            from bs4 import BeautifulSoup  # type: ignore
        except ImportError:
            return ParseResult(
                sections=[],
                metadata={
                    "parser": self.parser_name,
                    "parse_error": "beautifulsoup4 not installed",
                },
            )

        try:
            raw = path.read_bytes()
            soup = BeautifulSoup(raw, "html.parser")
        except Exception as exc:
            return ParseResult(
                sections=[],
                metadata={
                    "parser": self.parser_name,
                    "parse_error": f"BeautifulSoup failed: {exc}",
                },
            )

        for tag_name in _DROP_TAGS:
            for tag in soup.find_all(tag_name):
                tag.decompose()

        title_tag = soup.find("title")
        title = title_tag.get_text(strip=True) if title_tag else ""
        body_text = soup.get_text(separator="\n", strip=True)

        if not body_text:
            return ParseResult(
                sections=[],
                metadata={
                    "parser": self.parser_name,
                    "html_title": title,
                    "empty_body": True,
                },
            )

        return ParseResult(
            sections=[
                ParsedSection(
                    text=body_text,
                    label=title,
                    extra={"html_title": title},
                )
            ],
            metadata={
                "parser": self.parser_name,
                "html_title": title,
            },
        )
