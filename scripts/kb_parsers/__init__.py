"""Per-format source parsers used by `scripts/kb-ingest.py`.

Each parser converts one source file into a `ParseResult` (a list of
`ParsedSection`s + file-level metadata). The ingester then chunks each
section, embeds the chunks, and upserts them via the configured
VectorBackend.

Adding a new format is two steps:
  1. Drop a module here that exports a `Parser` subclass and lists its
     extensions in `EXTENSIONS`.
  2. Register it in `ALL_PARSERS` below.

We deliberately keep the surface synchronous + pure: a parser takes a
filesystem path, returns plain data, and never touches the DB or the
embedder. Tests can run on a handful of fixtures with no network.
"""

from __future__ import annotations

from pathlib import Path
from typing import List, Optional

from .base import Parser, ParseError, ParseResult, ParsedSection
from .docx_parser import DocxParser
from .html_parser import HtmlParser
from .image_parser import ImageParser
from .markdown_parser import MarkdownParser
from .pdf_parser import PdfParser

ALL_PARSERS: List[Parser] = [
    MarkdownParser(),
    PdfParser(),
    DocxParser(),
    ImageParser(),
    HtmlParser(),
]


def get_parser_for(path: Path) -> Optional[Parser]:
    """Return the first registered parser whose extensions include
    `path`'s suffix, or None when no parser handles this format."""
    suffix = path.suffix.lower()
    for parser in ALL_PARSERS:
        if suffix in parser.extensions:
            return parser
    return None


__all__ = [
    "ALL_PARSERS",
    "DocxParser",
    "HtmlParser",
    "ImageParser",
    "MarkdownParser",
    "ParseError",
    "ParseResult",
    "ParsedSection",
    "Parser",
    "PdfParser",
    "get_parser_for",
]
