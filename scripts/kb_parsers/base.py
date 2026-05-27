"""Shared types for the multi-format parser package.

A `Parser` reads one file and emits a `ParseResult`: a sequence of
`ParsedSection`s (each carrying a chunk of human-readable text plus a
human-readable label like "page 3" / "幻灯片 2") and a dict of
file-level metadata that is propagated to every chunk by the ingester.

Parsers MUST NOT raise on missing or malformed input — surface the
problem by returning `ParseResult(sections=[], metadata={'parse_error':
…})` so the ingester records a per-file error without aborting the
whole batch. The `ParseError` class is only used when the format is
nominally supported but the input is unrecoverably broken (e.g. an
encrypted PDF without a key), so the caller can branch on it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Sequence


@dataclass
class ParsedSection:
    """One contiguous block of extracted text from a source file.

    `label` is a short, human-friendly tag the ingester appends to the
    chunk metadata so users can see "page 5" / "slide 3" / heading
    titles when the orchestrator cites a chunk. Optional; omit when the
    parser has nothing better than the filename to offer.
    """

    text: str
    label: str = ""
    extra: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ParseResult:
    """Whatever one parser invocation produced.

    `metadata` is the *file-level* shape — language detected for the
    document, parser identifier, page count, parse_error string when
    relevant. The ingester merges it onto every chunk before storage.
    """

    sections: List[ParsedSection] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)


class ParseError(Exception):
    """Raised when a file is in the right format but unrecoverable.
    Most failures should be returned via `ParseResult.metadata` instead;
    reserve this for truly fatal cases (encrypted PDF, corrupt zip)."""


class Parser:
    """Base class for per-format parsers. Subclasses override
    `extensions` and `parse`."""

    #: File extensions (including the dot, lowercase) this parser
    #: handles. The dispatcher iterates parsers in registration order
    #: and picks the first whose extension list contains the file's
    #: suffix, so put the most specific parser first.
    extensions: Sequence[str] = ()

    #: Short identifier embedded in chunk metadata for traceability.
    parser_name: str = "base"

    def parse(self, path: Path) -> ParseResult:  # pragma: no cover
        raise NotImplementedError
