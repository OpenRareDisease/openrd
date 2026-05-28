"""Markdown parser.

Preserves the existing kb-ingest behaviour: optional YAML frontmatter
becomes file-level metadata; the body becomes one `ParsedSection` and
is chunked heading-aware by the ingester.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, Tuple

from .base import Parser, ParseResult, ParsedSection


def parse_frontmatter(text: str) -> Tuple[Dict[str, Any], str]:
    """Return (frontmatter_dict, body_text).

    Frontmatter is the YAML block at the very top of the file delimited
    by `---` lines. Files without frontmatter return ({}, full_text).
    """
    if not text.startswith("---"):
        return {}, text

    after_open = text.split("\n", 1)
    if len(after_open) < 2 or after_open[0].strip() != "---":
        return {}, text
    rest = after_open[1]

    end_match = re.search(r"^---\s*$", rest, flags=re.MULTILINE)
    if not end_match:
        return {}, text

    yaml_block = rest[: end_match.start()]
    body = rest[end_match.end() :].lstrip("\n")

    try:
        import yaml  # type: ignore

        parsed = yaml.safe_load(yaml_block) or {}
        if not isinstance(parsed, dict):
            parsed = {}
        return parsed, body
    except ImportError:
        return _simple_yaml_parse(yaml_block), body


def _simple_yaml_parse(text: str) -> Dict[str, Any]:
    """Minimal fallback when PyYAML is not installed.

    Handles `key: value` and `key: [a, b, c]`. Quoted values are
    unwrapped. Anything fancier (nested maps, multi-line strings) is
    silently skipped — install PyYAML for full support.
    """
    result: Dict[str, Any] = {}
    for raw_line in text.split("\n"):
        line = raw_line.rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        match = re.match(r"^([^:]+):\s*(.*)$", line)
        if not match:
            continue
        key = match.group(1).strip()
        value: Any = match.group(2).strip()

        if isinstance(value, str) and value:
            if (value[0] == value[-1] == '"') or (value[0] == value[-1] == "'"):
                value = value[1:-1]
            elif value.startswith("[") and value.endswith("]"):
                inner = value[1:-1]
                items = [
                    item.strip().strip("\"'")
                    for item in inner.split(",")
                    if item.strip()
                ]
                value = items
        result[key] = value
    return result


class MarkdownParser(Parser):
    extensions = (".md", ".markdown")
    parser_name = "markdown"

    def parse(self, path: Path) -> ParseResult:
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            # Fall back to latin-1 then ignore-errors so a single
            # broken file doesn't sink the batch.
            text = path.read_text(encoding="utf-8", errors="ignore")

        frontmatter, body = parse_frontmatter(text)

        section = ParsedSection(
            text=body,
            label="",
            extra={"is_markdown": True},
        )
        metadata: Dict[str, Any] = {
            "parser": self.parser_name,
            **frontmatter,
        }
        return ParseResult(sections=[section] if body.strip() else [], metadata=metadata)
