"""Every corpus number written into a comment has to reproduce.

This branch exists because those numbers stopped reproducing. The
per-category census that `search_medical_kb` ships to the model inside
its `category` schema description, the chunk totals in
apps/api/knowledge.py, the label-carrying count in medical-kb.ts — all
were measured against a 9,594-chunk corpus that this branch's own
re-chunk replaced with a 10,241-chunk one, and nothing noticed for five
review rounds. A comment nobody can check is a comment that drifts.

So: read the numbers back out of the source files and run the query they
claim to have run.

REQUIRES A CORPUS. Skips when DATABASE_URL is unset or `kb_chunks` is
absent, which is what CI gets — the 547 MB corpus is gitignored and no
CI job has ever ingested it. That is a real coverage limit and not a
hidden one: these numbers can only be verified where the corpus lives,
which today is a developer machine. What the skip must never do is hide
a REWORD: every extraction below asserts that its pattern matched, so
deleting or rephrasing a claim fails the test rather than silently
retiring it.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from typing import Dict, List, Tuple

import pytest

_HERE = Path(__file__).resolve().parent
_REPO_ROOT = _HERE.parent.parent
_KNOWLEDGE_PY = _REPO_ROOT / "apps" / "api" / "knowledge.py"
_MEDICAL_KB_TS = (
    _REPO_ROOT
    / "apps"
    / "api"
    / "src"
    / "modules"
    / "ai-agents"
    / "retrievers"
    / "medical-kb.ts"
)
_SEARCH_TOOL_TS = (
    _REPO_ROOT / "apps" / "api" / "src" / "modules" / "ai-agents" / "tools" / "search-medical-kb.ts"
)


def _source(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _one(pattern: str, text: str, what: str) -> re.Match:
    """Find the single claim, or fail loudly.

    A claim that has been reworded out of existence is not a passing
    test; it is an untested claim.
    """
    match = re.search(pattern, text)
    assert match, f"{what}: no longer stated in the source — re-point this test or drop the claim"
    return match


def _num(raw: str) -> int:
    return int(raw.replace(",", "").replace("，", ""))


@pytest.fixture(scope="module")
def rows() -> List[Tuple[str, str, str]]:
    """(source_file, category, content) for the whole live corpus."""
    dsn = os.getenv("DATABASE_URL", "").strip()
    if not dsn:
        pytest.skip("no DATABASE_URL; the corpus numbers can only be checked against a corpus")
    psycopg = pytest.importorskip("psycopg")
    try:
        with psycopg.connect(dsn, connect_timeout=5) as conn, conn.cursor() as cur:
            cur.execute("select to_regclass('kb_chunks')")
            if cur.fetchone()[0] is None:
                pytest.skip("this database has no kb_chunks table")
            cur.execute(
                "select source_file, coalesce(metadata->>'category',''), content from kb_chunks"
            )
            return cur.fetchall()
    except psycopg.OperationalError as exc:  # pragma: no cover - environment dependent
        pytest.skip(f"cannot reach DATABASE_URL: {exc}")


@pytest.fixture(scope="module")
def kb():
    apps_api = _REPO_ROOT / "apps" / "api"
    if str(apps_api) not in sys.path:
        sys.path.insert(0, str(apps_api))
    import knowledge

    return knowledge


def _totals(rows) -> Tuple[int, int]:
    return len(rows), len({r[0] for r in rows})


def test_knowledge_py_authority_census_reproduces(rows):
    """knowledge.py's AUTHORITY_TIERS block, folder by folder."""
    source = _source(_KNOWLEDGE_PY)
    header = _one(
        r"the live corpus \(([\d,]+) chunks / (\d+) files, ([\d-]+)\)",
        source,
        "knowledge.py authority census header",
    )
    chunks, files = _totals(rows)
    assert (_num(header.group(1)), int(header.group(2))) == (chunks, files)

    by_category: Dict[str, int] = {}
    for _, category, _content in rows:
        by_category[category] = by_category.get(category, 0) + 1

    named = {
        "指南共识": r"指南共识/\s+([\d,]+) chunks",
        "文献": r"文献/\s+([\d,]+)",
        "": r"\(corpus root — papers, preprints, abstract books\)\s+([\d,]+)",
        "AFO": r"AFO/\s+([\d,]+)",
        "05.相关研究": r"05\.相关研究/\s+([\d,]+)",
        "11.病友经验": r"11\.病友经验/ \(including the 连载 subdirectory\)\s+([\d,]+)",
    }
    for category, pattern in named.items():
        claimed = _num(_one(pattern, source, f"knowledge.py census row for {category!r}").group(1))
        assert claimed == by_category.get(category, 0), category

    rest = _num(
        _one(
            r"everything else \(01/02/03/04/06/07/08/09/10/12/孕期\)\s*([\d,]+)",
            source,
            "knowledge.py census 'everything else' row",
        ).group(1)
    )
    assert rest == chunks - sum(by_category.get(c, 0) for c in named)


def test_knowledge_py_root_tier_census_reproduces(rows):
    """`_ROOT_TIER` rests on every root-level file being a paper."""
    match = _one(
        r"measured [\d-]+: (\d+) files, ([\d,]+) chunks",
        _source(_KNOWLEDGE_PY),
        "knowledge.py root-tier census",
    )
    root = [r for r in rows if not r[1]]
    assert (int(match.group(1)), _num(match.group(2))) == (len({r[0] for r in root}), len(root))


def test_guideline_filename_rule_hits_the_documented_count(rows, kb):
    """The filename promotion, over the population the comment names.

    The index and the directory on disk are two different populations —
    211 files against 235 — and the comment used to quote the count from
    one against the denominator of the other.
    """
    match = _one(
        r"(?s)over the (\d+)\s*\n#: source files IN THE INDEX.*?this hits exactly (\d+), and\n#: (\d+) are",
        _source(_KNOWLEDGE_PY),
        "knowledge.py guideline-filename census",
    )
    files = sorted({r[0] for r in rows})
    hits = [f for f in files if kb._GUIDELINE_FILENAME_RE.search(f.split("/")[-1])]
    assert int(match.group(1)) == len(files)
    assert int(match.group(2)) == len(hits)
    # "N are unambiguous guidelines" is a judgement about the hits, not a
    # count of them, so it only has to stay consistent with the total.
    assert int(match.group(3)) == len(hits) - 1


@pytest.mark.parametrize(
    "path,pattern,what",
    [
        (
            _KNOWLEDGE_PY,
            r"# ([\d]+) 块语料里有 ([\d]+) 块带着它",
            "knowledge.py ingest-label census",
        ),
        (
            _MEDICAL_KB_TS,
            r"\* ([\d,]+) of the corpus's ([\d,]+) chunks carry one",
            "medical-kb.ts ingest-label census",
        ),
    ],
)
def test_ingest_label_census_reproduces(rows, path, pattern, what):
    """How many chunks carry the pipeline's `[label]` line.

    Stated in two files in two languages and in opposite orders, which is
    exactly the shape that lets one of them be updated alone.
    """
    match = _one(pattern, _source(path), what)
    a, b = _num(match.group(1)), _num(match.group(2))
    total, labelled = max(a, b), min(a, b)
    label_re = re.compile(r"^\s*\[[^\]\n]{0,120}\]\s*\n?")
    assert total == len(rows)
    assert labelled == sum(1 for r in rows if label_re.match(r[2] or ""))


def test_search_tool_category_census_reproduces(rows):
    """The doc-comment census above KB_CATEGORIES.

    It is the only place these per-category counts are allowed to live —
    the model-facing description no longer carries them (see
    search-medical-kb.test.ts), precisely because a prompt string cannot
    be checked against the table.
    """
    source = _source(_SEARCH_TOOL_TS)
    header = _one(
        r"Measured ([\d-]+) over\n \* ([\d,]+) chunks / (\d+) source files",
        source,
        "search-medical-kb.ts census header",
    )
    chunks, files = _totals(rows)
    assert (_num(header.group(2)), int(header.group(3))) == (chunks, files)

    by_category: Dict[str, int] = {}
    for _, category, _content in rows:
        by_category[category] = by_category.get(category, 0) + 1

    table = _one(
        r"(?s)\n \*\n \*   文献.*?07\.项目活动\s+\d+\n",
        source,
        "search-medical-kb.ts census table",
    ).group(0)
    pairs = re.findall(r"(\(corpus root\)|[0-9A-Za-z一-鿿.]+)\s+([\d,]+)", table)
    assert len(pairs) == len(by_category), f"census lists {len(pairs)} categories, table has {len(by_category)}"
    for name, claimed in pairs:
        category = "" if name == "(corpus root)" else name
        assert _num(claimed) == by_category.get(category, -1), name


# --------------------------------------------------------------------------
# The bump-cost numbers.
#
# Everything above is a SQL query away. These are not: the four places
# that describe what a PIPELINE_VERSION bump costs quote how many pages
# the OCR fallback rasterises and how many chunks the embedder still
# sees, and both only come out of actually re-parsing all 235 files —
# about five minutes. So this one is opt-in. It is the measurement the
# comments claim, run verbatim; if you reword one of them, run
#
#     KB_PARSE_CENSUS=1 .venv/bin/python -m pytest \
#         scripts/kb_parsers/test_kb_corpus_census.py -q
#
# before you believe the new wording.

_INGEST_PY = _REPO_ROOT / "scripts" / "kb-ingest.py"
_BACKEND_BASE_PY = _REPO_ROOT / "apps" / "api" / "kb_backends" / "base.py"
_REUSE_TEST_PY = _HERE / "test_ingest_embedding_reuse.py"

#: The three files that state the cost of a bump — four sites, since
#: kb-ingest.py says it twice. They have drifted apart once already: all
#: four said "30 pages" went through the rasteriser, when 30 was the
#: count of pages OCR recovered TEXT from and 84 were rasterised.
_COST_CLAIM_FILES = (_INGEST_PY, _BACKEND_BASE_PY, _REUSE_TEST_PY)


def _flat(path: Path) -> str:
    """Source with comment markers stripped and runs of whitespace
    collapsed, so a claim can be matched without caring where the
    comment happened to wrap or which marker it wraps under."""
    stripped = [
        re.sub(r"^\s*(?:#:|#|//|\*)\s?", "", line)
        for line in _source(path).splitlines()
    ]
    return re.sub(r"\s+", " ", " ".join(stripped))


def _all(pattern: str, what: str, minimum: int) -> List[Tuple[str, ...]]:
    """Every statement of one claim across the files that make it.

    Returns the captures so the caller can assert they agree with the
    measurement — and with each other, which is the failure this whole
    file exists for.
    """
    hits: List[Tuple[str, ...]] = []
    for path in _COST_CLAIM_FILES:
        hits.extend(re.findall(pattern, _flat(path)))
    assert len(hits) >= minimum, (
        f"{what}: found {len(hits)} statements, expected at least {minimum} — "
        "a claim was reworded or deleted; re-point this test or drop the claim"
    )
    return hits


@pytest.fixture(scope="module")
def bump_cost(rows):
    """Re-parse and re-chunk the corpus, exactly as a bump would.

    Returns the measured cost of a bump: how many pages reach the 300
    DPI rasteriser, how many of those come back with usable text, and
    how many chunk fingerprints the backend would already hold.
    """
    if os.getenv("KB_PARSE_CENSUS", "").strip() not in {"1", "true", "yes"}:
        pytest.skip("set KB_PARSE_CENSUS=1 to re-parse the corpus (~5 minutes)")

    import importlib.util

    for extra in (_REPO_ROOT / "apps" / "api", _HERE.parent):
        if str(extra) not in sys.path:
            sys.path.insert(0, str(extra))
    spec = importlib.util.spec_from_file_location("kb_ingest_census", _INGEST_PY)
    ingest = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = ingest
    spec.loader.exec_module(ingest)

    from kb_parsers import pdf_parser

    root = _REPO_ROOT / "content" / "medical-kb" / "source"
    if not root.is_dir():
        pytest.skip(f"no corpus at {root}")
    files = sorted(p for p in root.rglob("*") if p.is_file() and not p.name.startswith("."))

    stored: Dict[str, set] = {}
    for source_file, _category, _content in rows:
        stored.setdefault(source_file, set())
    # The DB keys are relative to whichever --source the operator
    # ingested from, which is not necessarily the directory above.
    # Pick the ancestor whose relative keys actually match the index
    # rather than assuming; getting this wrong looks like a 100% cache
    # miss and would make the numbers below meaningless.
    candidates = [root] + [p for p in root.iterdir() if p.is_dir()]
    key_root = max(
        candidates,
        key=lambda base: sum(
            1
            for p in files
            if base in p.parents and ingest.relative_source_key(p, base) in stored
        ),
    )

    import psycopg

    with psycopg.connect(os.environ["DATABASE_URL"], connect_timeout=5) as conn:
        with conn.cursor() as cur:
            cur.execute("select source_file, fingerprint from kb_chunks")
            for source_file, fingerprint in cur.fetchall():
                stored.setdefault(source_file, set()).add(fingerprint)

    raster_pages = 0
    raster_files = set()
    real_ocr_page = pdf_parser._ocr_page

    def counting_ocr_page(path, page_index):
        nonlocal raster_pages
        if page_index >= 0:
            raster_pages += 1
            raster_files.add(str(path))
        return real_ocr_page(path, page_index)

    pdf_parser._ocr_page = counting_ocr_page
    try:
        parsed = 0
        recovered_pages = 0
        recovered_files = 0
        indexed_files = 0
        chunks = hits = misses = 0
        complete_misses = complete_files = partial_misses = partial_files = 0
        for path in files:
            parser = ingest.get_parser_for(path)
            if parser is None:
                continue
            parsed += 1
            result = parser.parse(path)
            via_ocr = result.metadata.get("pages_via_ocr", 0)
            recovered_pages += via_ocr
            recovered_files += 1 if via_ocr else 0

            if key_root not in path.parents:
                continue
            key = ingest.relative_source_key(path, key_root)
            if key not in stored:
                continue
            indexed_files += 1
            fingerprints = [
                ingest.chunk_fingerprint(key, c.chunk_index, c.content)
                for c in ingest._chunk_sections(result)
            ]
            chunks += len(fingerprints)
            hit = sum(1 for f in fingerprints if f in stored[key])
            hits += hit
            miss = len(fingerprints) - hit
            misses += miss
            if not miss:
                continue
            # A file whose stored row count matches what it chunks to
            # today was fully ingested; anything missing there is text
            # that MOVED, not text that was never written.
            if len(fingerprints) == len(stored[key]):
                complete_files += 1
                complete_misses += miss
            else:
                partial_files += 1
                partial_misses += miss
    finally:
        pdf_parser._ocr_page = real_ocr_page

    return {
        "files": parsed,
        "pdfs": sum(1 for p in files if p.suffix.lower() == ".pdf"),
        "raster_pages": raster_pages,
        "raster_files": len(raster_files),
        "recovered_pages": recovered_pages,
        "recovered_files": recovered_files,
        "indexed_files": indexed_files,
        "chunks": chunks,
        "hits": hits,
        "misses": misses,
        "complete_misses": complete_misses,
        "complete_files": complete_files,
        "partial_misses": partial_misses,
        "partial_files": partial_files,
    }


def test_the_ocr_fallback_page_counts_reproduce(bump_cost):
    """Rasterised pages and recovered pages are different numbers.

    `pages_via_ocr` counts only pages OCR pulled text out of. Three of
    these files used to print that number under the word "rasterised",
    which understated the work a bump does by more than half.
    """
    for pages, files in _all(
        r"([\d,]+) pages\b(?:[^.]{0,30}?across ([\d,]+))?[^.]{0,40}?rasterised at 300 DPI",
        "rasterised-page count",
        minimum=4,
    ):
        assert _num(pages) == bump_cost["raster_pages"]
        if files:
            assert _num(files) == bump_cost["raster_files"]

    for recovered in _all(
        r"([\d,]+) of (?:those|the)[^.]{0,40}?come back with",
        "OCR-recovered page count",
        minimum=3,
    ):
        assert _num(recovered) == bump_cost["recovered_pages"]

    for pages, files in _all(
        r"([\d,]+) of those, in ([\d,]+) files, come back with",
        "OCR-recovered page/file split",
        minimum=1,
    ):
        assert (_num(pages), _num(files)) == (
            bump_cost["recovered_pages"],
            bump_cost["recovered_files"],
        )


def test_the_corpus_size_a_bump_re_parses_reproduces(bump_cost):
    for files in _all(
        r"all ([\d,]+) files under content/medical-kb/source|re-chunks all ([\d,]+) files|([\d,]+) files in this corpus|over the ([\d,]+)-file",
        "file count a bump re-parses",
        minimum=4,
    ):
        stated = next(_num(f) for f in files if f)
        assert stated == bump_cost["files"]

    for pdfs in _all(r"corpus's ([\d,]+) PDFs", "PDF count", minimum=1):
        assert _num(pdfs) == bump_cost["pdfs"]


def test_what_a_bump_still_embeds_reproduces(bump_cost):
    """The claim that replaced "re-embedding is no longer part of it"."""
    for embedded, total in _all(
        r"([\d,]+) of (?:the )?([\d,]+) chunks",
        "chunks a bump embeds",
        minimum=3,
    ):
        assert (_num(embedded), _num(total)) == (
            bump_cost["misses"],
            bump_cost["chunks"],
        )

    indexed, total, reused, embedded = _one(
        r"the ([\d,]+) indexed files chunk to ([\d,]+) chunks, ([\d,]+) of which hit "
        r"a stored vector and cost no embedding, and ([\d,]+) of which are embedded",
        _flat(_INGEST_PY),
        "PIPELINE_VERSION reuse/embed split",
    ).groups()
    assert _num(indexed) == bump_cost["indexed_files"]
    assert _num(total) == bump_cost["chunks"]
    assert _num(reused) == bump_cost["hits"]
    assert _num(embedded) == bump_cost["misses"]

    partial_misses, partial_files = _one(
        r"([\d,]+) of that remainder sit in ([\d,]+) files whose stored row count",
        _flat(_INGEST_PY),
        "PIPELINE_VERSION partial-ingest split",
    ).groups()
    assert (_num(partial_misses), _num(partial_files)) == (
        bump_cost["partial_misses"],
        bump_cost["partial_files"],
    )

    complete_misses, complete_files = _one(
        r"([\d,]+) sit in ([\d,]+) files that are complete",
        _flat(_INGEST_PY),
        "PIPELINE_VERSION moved-text split",
    ).groups()
    assert (_num(complete_misses), _num(complete_files)) == (
        bump_cost["complete_misses"],
        bump_cost["complete_files"],
    )
