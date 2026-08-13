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

TWO HALVES, TWO GATES, because they need different things.

READING a claim back out of the source needs nothing but the working
tree. `test_every_census_claim_is_still_stated_in_the_source` therefore
runs EVERYWHERE, CI included, and turns red the moment an ENUMERATED
claim is deleted or reworded past its pattern — one parametrised case
per claim, so the failure names which one went missing. Repeated claims
are counted per file and pinned exactly, so a surplus match in one file
cannot pay for a missing statement in another, and a claim that spreads
to an extra site is a failure too.

WHAT THAT HALF CANNOT DO, stated here because the sentence it replaces
claimed otherwise: the table below is a list of literal patterns for
sentences someone already wrote. A census number written LATER, in a
shape nobody enumerated, is invisible to it — there is no general
"looks like a corpus claim" detector here and a pattern matcher over
prose could not be one. The boundary is pinned for one region:
`test_every_corpus_total_and_date_in_the_authority_block_is_enumerated`
fails if a corpus total or a measurement date appears anywhere in
knowledge.py's AUTHORITY_TIERS block without an entry reading it. That
comment block and nothing else; the list above that test names what
stays uncovered.

COMPARING that claim against the corpus needs the corpus. Those tests
skip when DATABASE_URL is unset or `kb_chunks` is absent, which is what
CI gets: the 547 MB corpus is gitignored and no CI job has ever ingested
it. That is a real coverage limit and not a hidden one — but a skip is
the wrong answer for someone who has just run an ingest and believes
they are checking the numbers, so KB_CENSUS_REQUIRED=1 turns every one
of those skips into a failure. (Same shape as _DB_REQUIRED in
test_pgvector_reusable_embeddings.py and _CONVERTER_REQUIRED in
test_docx_parser.py, minus the `CI` half of their condition — see
_CORPUS_REQUIRED for why that omission is deliberate.)

The split is the point. It did not exist before: every extraction lived
inside a test that took the `rows` fixture, and `rows` skips during
setup, before any test body — so deleting the census claim out of
knowledge.py produced「9 skipped」and exit 0 from the exact command and
DATABASE_URL the CI report-manager job runs. The docstring here claimed
the opposite. The reword guard now has no database in front of it.
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

_INGEST_PY = _REPO_ROOT / "scripts" / "kb-ingest.py"
_BACKEND_BASE_PY = _REPO_ROOT / "apps" / "api" / "kb_backends" / "base.py"
_REUSE_TEST_PY = _HERE / "test_ingest_embedding_reuse.py"

#: The three files that state the cost of a bump. How many times each
#: file states each claim is recorded per file in `_REPEATED_CLAIMS`
#: below rather than as one total, because a total lets a surplus match
#: in one file pay for a missing one in another. They have drifted
#: apart once already: every site said "30 pages" went through the
#: rasteriser, when 30 was the count of pages OCR recovered TEXT from
#: and 84 were rasterised.
_COST_CLAIM_FILES = (_INGEST_PY, _BACKEND_BASE_PY, _REUSE_TEST_PY)


def _source(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _flat(path: Path) -> str:
    """Source with comment markers stripped and runs of whitespace
    collapsed, so a claim can be matched without caring where the
    comment happened to wrap or which marker it wraps under."""
    stripped = [
        re.sub(r"^\s*(?:#:|#|//|\*)\s?", "", line)
        for line in _source(path).splitlines()
    ]
    return re.sub(r"\s+", " ", " ".join(stripped))


def _one(pattern: str, text: str, what: str) -> re.Match:
    """Find the single claim, or fail loudly.

    A claim that has been reworded out of existence is not a passing
    test; it is an untested claim.
    """
    match = re.search(pattern, text)
    assert match, f"{what}: no longer stated in the source — re-point this test or drop the claim"
    return match


def _all(pattern: str, what: str, per_file: Dict[Path, int]) -> List[Tuple[str, ...]]:
    """Every statement of one claim, counted per file and pinned exactly.

    Returns the captures so the caller can assert they agree with the
    measurement — and with each other, which is the failure this whole
    file exists for.

    EXACTLY, and PER FILE, not `>= minimum` over the three files
    concatenated. Under a total, one file can quietly lose a statement
    while another gains an unrelated sentence that happens to match,
    and the count still clears the floor. Re-measured on the「file
    count a bump re-parses」claim: rewording one of kb-ingest.py's
    three statements of it and adding one incidental matching line to
    base.py leaves the total at 5 statements, which the old
    `minimum=4` accepted; the per-file counts below reject it (and
    reject the surplus line on its own, which the old floor could not
    see at all — a claim stated one time too many is how two sites end
    up disagreeing in the first place).
    """
    hits: List[Tuple[str, ...]] = []
    for path in _COST_CLAIM_FILES:
        found = re.findall(pattern, _flat(path))
        expected = per_file.get(path, 0)
        assert len(found) == expected, (
            f"{what}: {path.name} states it {len(found)} times, expected exactly "
            f"{expected} — a claim was reworded, deleted or duplicated; re-point "
            "this test (the per-file counts live in _REPEATED_CLAIMS) or drop the claim"
        )
        hits.extend(found)
    return hits


def _num(raw: str) -> int:
    return int(raw.replace(",", "").replace("，", ""))


# --------------------------------------------------------------------------
# The claims, in one table.
#
# Every pattern below is declared once and read twice: by the
# corpus-free "is it still stated" test, and by whichever measurement
# test compares its captures against the corpus. Declaring them twice
# would put the reword guard and the number check on separate copies of
# the same regex — which is the drift this file exists to catch, one
# level up.

#: The six category rows of knowledge.py's AUTHORITY_TIERS census that
#: name a category the `metadata->>'category'` column also names. The
#: seventh row ("everything else") is checked as the residual.
_NAMED_CATEGORY_ROWS: Dict[str, str] = {
    "指南共识": r"指南共识/\s+([\d,]+) chunks",
    "文献": r"文献/\s+([\d,]+)",
    "": r"\(corpus root — papers, preprints, abstract books\)\s+([\d,]+)",
    "AFO": r"AFO/\s+([\d,]+)",
    "05.相关研究": r"05\.相关研究/\s+([\d,]+)",
    "11.病友经验": r"11\.病友经验/ \(including the 连载 subdirectory\)\s+([\d,]+)",
}

#: what -> (file, pattern, read the file flattened). Claims stated once,
#: read with `_one`.
_SINGLE_CLAIMS: Dict[str, Tuple[Path, str, bool]] = {
    "knowledge.py authority census header": (
        _KNOWLEDGE_PY,
        r"the live corpus \(([\d,]+) chunks / (\d+) files, ([\d-]+)\)",
        False,
    ),
    # The census header is not the only place the block states the
    # corpus size and the measurement date: the paragraph that sizes
    # the ranking penalty restates both, eight lines below, in a
    # different shape. Nothing read it — the header's own copy was
    # asserted against kb_chunks and its date held to the _FOLDER_TIERS
    # note, while this one could say anything. Setting it to
    # "1999-01-01 / 77,777-chunk corpus" now fails the two-halves test
    # without a corpus and the census test with one.
    "knowledge.py penalty-sizing corpus size": (
        _KNOWLEDGE_PY,
        r"both re-run ([\d-]+) against\n# the ([\d,]+)-chunk corpus",
        False,
    ),
    "knowledge.py census 'everything else' row": (
        _KNOWLEDGE_PY,
        r"everything else \(01/02/03/04/06/07/08/09/10/12/孕期\)\s*([\d,]+)",
        False,
    ),
    "knowledge.py root-tier census": (
        _KNOWLEDGE_PY,
        r"measured ([\d-]+): (\d+) files, ([\d,]+) chunks",
        False,
    ),
    "knowledge.py guideline-filename census": (
        _KNOWLEDGE_PY,
        r"(?s)over the (\d+)\s*\n#: source files IN THE INDEX.*?this hits exactly (\d+), and\n#: (\d+) are",
        False,
    ),
    "knowledge.py ingest-label census": (
        _KNOWLEDGE_PY,
        r"# ([\d]+) 块语料里有 ([\d]+) 块带着它",
        False,
    ),
    "medical-kb.ts ingest-label census": (
        _MEDICAL_KB_TS,
        r"\* ([\d,]+) of the corpus's ([\d,]+) chunks carry one",
        False,
    ),
    "search-medical-kb.ts census header": (
        _SEARCH_TOOL_TS,
        r"Measured ([\d-]+) over\n \* ([\d,]+) chunks / (\d+) source files",
        False,
    ),
    "search-medical-kb.ts census table": (
        _SEARCH_TOOL_TS,
        r"(?s)\n \*\n \*   文献.*?07\.项目活动\s+\d+\n",
        False,
    ),
    "PIPELINE_VERSION reuse/embed split": (
        _INGEST_PY,
        r"the ([\d,]+) indexed files chunk to ([\d,]+) chunks, ([\d,]+) of which hit "
        r"a stored vector and cost no embedding, and ([\d,]+) of which are embedded",
        True,
    ),
    "PIPELINE_VERSION partial-ingest split": (
        _INGEST_PY,
        r"([\d,]+) of that remainder sit in ([\d,]+) files whose stored row count",
        True,
    ),
    "PIPELINE_VERSION moved-text split": (
        _INGEST_PY,
        r"([\d,]+) sit in ([\d,]+) files that are complete",
        True,
    ),
}

_SINGLE_CLAIMS.update(
    {
        f"knowledge.py census row for {category!r}": (_KNOWLEDGE_PY, pattern, False)
        for category, pattern in _NAMED_CATEGORY_ROWS.items()
    }
)

#: what -> (pattern, {file: exactly how many times that file states it}).
#: Claims the bump-cost files repeat, read with `_all`. A file missing
#: from the mapping must state the claim zero times, so a claim that
#: spreads to a fourth site is a failure too — the whole point is that
#: every site of one number is enumerated, not that some floor is met.
_REPEATED_CLAIMS: Dict[str, Tuple[str, Dict[Path, int]]] = {
    "rasterised-page count": (
        r"([\d,]+) pages\b(?:[^.]{0,30}?across ([\d,]+))?[^.]{0,40}?rasterised at 300 DPI",
        # kb-ingest.py twice: once with the「across N files」split and
        # once without.
        {_INGEST_PY: 2, _BACKEND_BASE_PY: 1, _REUSE_TEST_PY: 1},
    ),
    "OCR-recovered page count": (
        r"([\d,]+) of (?:those|the)[^.]{0,40}?come back with",
        {_INGEST_PY: 1, _BACKEND_BASE_PY: 1, _REUSE_TEST_PY: 1},
    ),
    "OCR-recovered page/file split": (
        r"([\d,]+) of those, in ([\d,]+) files, come back with",
        # Only kb-ingest.py carries the file half of the split.
        {_INGEST_PY: 1},
    ),
    "file count a bump re-parses": (
        r"all ([\d,]+) files under content/medical-kb/source|re-chunks all ([\d,]+) files|"
        r"([\d,]+) files in this corpus|over the ([\d,]+)-file",
        # FIVE sites, not four: kb-ingest.py states it three times, in
        # three of the four shapes the alternation lists. The old
        # `minimum=4` left one of the five free to be reworded away in
        # every environment.
        {_INGEST_PY: 3, _BACKEND_BASE_PY: 1, _REUSE_TEST_PY: 1},
    ),
    "PDF count": (r"corpus's ([\d,]+) PDFs", {_INGEST_PY: 1}),
    "chunks a bump embeds": (
        r"([\d,]+) of (?:the )?([\d,]+) chunks",
        {_INGEST_PY: 1, _BACKEND_BASE_PY: 1, _REUSE_TEST_PY: 1},
    ),
}


def _stated(what: str) -> re.Match:
    """The claim named `what`, or a failure saying it is gone."""
    path, pattern, flat = _SINGLE_CLAIMS[what]
    return _one(pattern, _flat(path) if flat else _source(path), what)


def _repeated(what: str) -> List[Tuple[str, ...]]:
    """Every statement of the repeated claim named `what`."""
    pattern, per_file = _REPEATED_CLAIMS[what]
    return _all(pattern, what, per_file)


# --------------------------------------------------------------------------
# Half one: no corpus, no database, no opt-in. Runs on CI.


@pytest.mark.parametrize(
    "kind,what",
    # Carried as (kind, what) pairs rather than one flat list of names,
    # so a name that ends up in both tables cannot quietly resolve to
    # whichever branch an `in` check reached first.
    [("single", what) for what in sorted(_SINGLE_CLAIMS)]
    + [("repeated", what) for what in sorted(_REPEATED_CLAIMS)],
)
def test_every_census_claim_is_still_stated_in_the_source(kind: str, what: str) -> None:
    """A claim reworded past its pattern is not a passing test.

    This is the half that survives a machine with no corpus. It proves
    only that the sentence is still there in a shape the measurement
    test can read — the numbers themselves are checked below, where a
    corpus exists. Retiring a claim quietly requires deleting its entry
    from the table above, which is a diff a reviewer sees.
    """
    (_stated if kind == "single" else _repeated)(what)


def test_the_two_halves_of_the_authority_block_agree_with_each_other() -> None:
    """The three dates in the authority block are one measurement.

    The chunk counts are asserted against `kb_chunks` further down,
    which forces them equal on a machine that has the corpus — and
    leaves them free to drift apart on every machine that does not.
    The DATE is the part no query can check at all: nothing in
    `kb_chunks` records when a comment was written. So the three
    statements of it are held to each other, which is the only handle
    there is, and re-stamping one by hand without the others fails
    here.
    """
    header = _stated("knowledge.py authority census header")
    root_tier = _stated("knowledge.py root-tier census")
    penalty = _stated("knowledge.py penalty-sizing corpus size")
    assert root_tier.group(1) == header.group(3), (
        "the AUTHORITY_TIERS header and the _FOLDER_TIERS root-tier note quote "
        "different measurement dates; they describe one snapshot of one corpus"
    )
    assert penalty.group(1) == header.group(3), (
        "the AUTHORITY_TIERS header and the penalty-sizing paragraph below it "
        "quote different measurement dates; both describe the same snapshot"
    )
    root_row = _stated("knowledge.py census row for ''")
    assert _num(root_tier.group(3)) == _num(root_row.group(1)), (
        "the root-tier chunk count and the '(corpus root ...)' census row "
        "disagree; one of them was re-measured and the other was not"
    )


# --------------------------------------------------------------------------
# Where the table stops.
#
# Everything above is a literal pattern for a claim someone already
# wrote. That catches a reworded claim and a deleted one; it cannot
# catch a claim WRITTEN LATER in a shape nobody enumerated. The test
# below closes that for one region and one pair of numbers — the
# authority block, the corpus total and the measurement date — because
# that is the block whose prose tells a reader what is and is not
# enforced, so a fourth unenforced restatement appearing inside it
# would make that prose wrong.
#
# What it does NOT cover, named rather than implied:
#   * anything outside the region below. knowledge.py restates the
#     corpus total at least four more times — the ingest-label note
#     near the top, the relevance-floor probe block, the
#     guideline-filename note's「N of M chunks」and the authority_tier
#     backfill note near the bottom. Two of those are enumerated in
#     _SINGLE_CLAIMS by their own patterns; the other two are not
#     checked by this file at all.
#   * any number in the region that is neither the corpus total nor a
#     date — the per-category rows, the penalty spread, the distance
#     band, the four-decimal cosine figures. The rows have their own
#     entries; the rest are unchecked.
#   * every other file. medical-kb.ts, search-medical-kb.ts,
#     kb-ingest.py and the two bump-cost files are covered only by the
#     literal patterns above.

#: The region: the AUTHORITY_TIERS census block through the end of the
#: `_FOLDER_TIERS` note, which is the block the census prose in
#: knowledge.py calls「this block」.
_AUTHORITY_BLOCK_START = "# The corpus directory structure already encodes"
_AUTHORITY_BLOCK_END = '_ROOT_TIER = "literature"'

#: A date any of these comments could carry, and the corpus total in
#: both spellings the file uses (`10,241` and `10241`).
_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")

#: How many of each the region holds. Pinned, because the check below
#: only walks what the region contains: moving either marker inward
#: would make it cover less and stay green. Bumping these is how a
#: reviewer sees that the block grew a statement — and the entry that
#: reads the new one has to land in `_SINGLE_CLAIMS` in the same diff
#: or the check itself fails.
_AUTHORITY_BLOCK_DATES = 3
_AUTHORITY_BLOCK_TOTALS = 2


def _authority_block_bounds(source: str) -> Tuple[int, int]:
    start = source.index(_AUTHORITY_BLOCK_START)
    return start, source.index(_AUTHORITY_BLOCK_END, start)


def test_every_corpus_total_and_date_in_the_authority_block_is_enumerated() -> None:
    """A number added to the block later is enumerated, or this fails.

    The rest of this file matches claims that already exist, so a
    reader could reasonably read「the census block is checked」and add a
    fifth restatement of the total to it that nothing reads. This is
    the boundary: inside the region, every corpus total and every date
    has to sit inside the span of a pattern in `_SINGLE_CLAIMS`.

    It is a boundary and not a widening — see the list above for what
    stays uncovered. If a future change narrows the region or drops a
    pattern, the numbers it stops covering surface here rather than
    going quiet.
    """
    source = _source(_KNOWLEDGE_PY)
    start, end = _authority_block_bounds(source)

    covered: List[Tuple[int, int]] = []
    for path, pattern, flat in _SINGLE_CLAIMS.values():
        if path != _KNOWLEDGE_PY or flat:
            continue
        covered.extend(m.span() for m in re.finditer(pattern, source))

    total = _stated("knowledge.py authority census header").group(1)
    spellings = {total, total.replace(",", "")}
    dates = [(m.start(), m.group(0)) for m in _DATE_RE.finditer(source)]
    totals = [
        (m.start(), spelling)
        for spelling in spellings
        for m in re.finditer(re.escape(spelling), source)
    ]
    def inside(found: List[Tuple[int, str]]) -> List[Tuple[int, str]]:
        return [(offset, text) for offset, text in found if start <= offset < end]

    assert len(inside(dates)) == _AUTHORITY_BLOCK_DATES, (
        f"the AUTHORITY_TIERS region holds {len(inside(dates))} measurement "
        f"dates, not {_AUTHORITY_BLOCK_DATES}. If the block really grew or lost "
        "one, update _AUTHORITY_BLOCK_DATES and the prose in knowledge.py that "
        "tells the reader how many to re-stamp; if it did not, the region "
        "markers moved and this check has quietly stopped looking at part of "
        "the block"
    )
    assert len(inside(totals)) == _AUTHORITY_BLOCK_TOTALS, (
        f"the AUTHORITY_TIERS region states the corpus total "
        f"{len(inside(totals))} times, not {_AUTHORITY_BLOCK_TOTALS} — same "
        "two possibilities as above"
    )

    for offset, text in inside(dates) + inside(totals):
        assert any(lo <= offset < hi for lo, hi in covered), (
            f"knowledge.py line {source.count(chr(10), 0, offset) + 1} states "
            f"{text!r} inside the AUTHORITY_TIERS block, and no pattern in "
            "_SINGLE_CLAIMS reads it. A corpus figure or a measurement date "
            "that nothing extracts is a number that drifts — add an entry for "
            "it (and assert it against kb_chunks below, or against the other "
            "dates in test_the_two_halves_of_the_authority_block_agree_with_"
            "each_other), or take it back out of the block."
        )


# --------------------------------------------------------------------------
# Half two: the numbers, against the corpus they were measured on.

#: A skip is the honest answer on a machine that has no corpus — the
#: index is gitignored and no CI job has ever built it. It is the wrong
#: answer for someone who has just re-ingested and is running this file
#: to confirm the comments, because a typo in DATABASE_URL then reads as
#: a green census. KB_CENSUS_REQUIRED=1 makes that a failure instead.
#:
#: Parsed the same way `bump_cost` parses KB_PARSE_CENSUS twelve lines
#: down, so `KB_CENSUS_REQUIRED=0` and `=false` mean off rather than on.
#: `bool(os.environ.get(...))` armed on both, which is a nasty shape for
#: a switch whose only job is to convert skips into failures.
#:
#: Deliberately NOT `os.environ.get("CI") or ...`, which is where it
#: differs from `_DB_REQUIRED` in test_pgvector_reusable_embeddings.py
#: and `_CONVERTER_REQUIRED` in test_docx_parser.py. Those two guard
#: things CI is supposed to have — a pgvector container, LibreOffice —
#: so a runner that loses them must go red. CI has never had this
#: corpus and is not meant to: it is 547 MB and gitignored, and making
#: it mandatory on CI would turn every run red forever. The omission is
#: the load-bearing part of the shape, not an oversight in copying it.
_CORPUS_REQUIRED = os.getenv("KB_CENSUS_REQUIRED", "").strip() in {"1", "true", "yes"}


def _no_corpus(reason: str) -> None:
    """Fail where a corpus is mandatory, skip elsewhere. Never returns."""
    if _CORPUS_REQUIRED:
        pytest.fail(
            f"{reason} — but KB_CENSUS_REQUIRED is set, so this environment is "
            "supposed to hold the ingested corpus these comments were measured "
            "against. Point DATABASE_URL at the database you ingested into "
            "(`set -a; . ./.env; set +a`), or drop KB_CENSUS_REQUIRED to fall "
            "back to checking that the claims are still stated."
        )
    pytest.skip(reason)


@pytest.fixture(scope="module")
def rows() -> List[Tuple[str, str, str]]:
    """(source_file, category, content) for the whole live corpus."""
    dsn = os.getenv("DATABASE_URL", "").strip()
    if not dsn:
        _no_corpus("no DATABASE_URL; the corpus numbers can only be checked against a corpus")
    try:
        import psycopg
    except ImportError:  # pragma: no cover - environment dependent
        _no_corpus("psycopg is not installed")
    try:
        with psycopg.connect(dsn, connect_timeout=5) as conn, conn.cursor() as cur:
            cur.execute("select to_regclass('kb_chunks')")
            if cur.fetchone()[0] is None:
                _no_corpus("this database has no kb_chunks table")
            cur.execute(
                "select source_file, coalesce(metadata->>'category',''), content from kb_chunks"
            )
            return cur.fetchall()
    except psycopg.OperationalError as exc:  # pragma: no cover - environment dependent
        _no_corpus(f"cannot reach DATABASE_URL: {exc}")


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
    header = _stated("knowledge.py authority census header")
    chunks, files = _totals(rows)
    assert (_num(header.group(1)), int(header.group(2))) == (chunks, files)

    by_category: Dict[str, int] = {}
    for _, category, _content in rows:
        by_category[category] = by_category.get(category, 0) + 1

    for category in _NAMED_CATEGORY_ROWS:
        claimed = _num(_stated(f"knowledge.py census row for {category!r}").group(1))
        assert claimed == by_category.get(category, 0), category

    rest = _num(_stated("knowledge.py census 'everything else' row").group(1))
    assert rest == chunks - sum(by_category.get(c, 0) for c in _NAMED_CATEGORY_ROWS)

    # The same total, restated eight lines below to size the ranking
    # penalty. One block, one corpus, one number.
    penalty = _stated("knowledge.py penalty-sizing corpus size")
    assert _num(penalty.group(2)) == chunks, (
        "the penalty-sizing paragraph and the census header above it quote "
        "different corpus sizes"
    )


def test_knowledge_py_root_tier_census_reproduces(rows):
    """`_ROOT_TIER` rests on every root-level file being a paper."""
    match = _stated("knowledge.py root-tier census")
    root = [r for r in rows if not r[1]]
    assert (int(match.group(2)), _num(match.group(3))) == (len({r[0] for r in root}), len(root))


def test_guideline_filename_rule_hits_the_documented_count(rows, kb):
    """The filename promotion, over the population the comment names.

    The index and the directory on disk are two different populations —
    211 files against 235 — and the comment used to quote the count from
    one against the denominator of the other.
    """
    match = _stated("knowledge.py guideline-filename census")
    files = sorted({r[0] for r in rows})
    hits = [f for f in files if kb._GUIDELINE_FILENAME_RE.search(f.split("/")[-1])]
    assert int(match.group(1)) == len(files)
    assert int(match.group(2)) == len(hits)
    # "N are unambiguous guidelines" is a judgement about the hits, not a
    # count of them, so it only has to stay consistent with the total.
    assert int(match.group(3)) == len(hits) - 1


@pytest.mark.parametrize(
    "what",
    ["knowledge.py ingest-label census", "medical-kb.ts ingest-label census"],
)
def test_ingest_label_census_reproduces(rows, what):
    """How many chunks carry the pipeline's `[label]` line.

    Stated in two files in two languages and in opposite orders, which is
    exactly the shape that lets one of them be updated alone.
    """
    match = _stated(what)
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
    header = _stated("search-medical-kb.ts census header")
    chunks, files = _totals(rows)
    assert (_num(header.group(2)), int(header.group(3))) == (chunks, files)

    by_category: Dict[str, int] = {}
    for _, category, _content in rows:
        by_category[category] = by_category.get(category, 0) + 1

    table = _stated("search-medical-kb.ts census table").group(0)
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
# about five minutes. So the MEASUREMENT is opt-in; the guard that these
# claims are still stated at all is not, and runs in the parametrised
# test above with everything else. If you reword one of them, run
#
#     KB_PARSE_CENSUS=1 .venv/bin/python -m pytest \
#         scripts/kb_parsers/test_kb_corpus_census.py -q
#
# before you believe the new wording.


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
        # KB_PARSE_CENSUS is an explicit "re-parse the corpus" request.
        # Skipping it because the corpus is missing answers a question
        # nobody asked, and does it in the one place the operator was
        # trying to verify the five-minute number.
        pytest.fail(
            f"KB_PARSE_CENSUS is set but there is no corpus at {root} — the "
            "bump-cost numbers can only be re-measured against the source "
            "files. Unset KB_PARSE_CENSUS, or restore the corpus."
        )
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
    for pages, files in _repeated("rasterised-page count"):
        assert _num(pages) == bump_cost["raster_pages"]
        if files:
            assert _num(files) == bump_cost["raster_files"]

    for recovered in _repeated("OCR-recovered page count"):
        assert _num(recovered) == bump_cost["recovered_pages"]

    for pages, files in _repeated("OCR-recovered page/file split"):
        assert (_num(pages), _num(files)) == (
            bump_cost["recovered_pages"],
            bump_cost["recovered_files"],
        )


def test_the_corpus_size_a_bump_re_parses_reproduces(bump_cost):
    for files in _repeated("file count a bump re-parses"):
        stated = next(_num(f) for f in files if f)
        assert stated == bump_cost["files"]

    for pdfs in _repeated("PDF count"):
        assert _num(pdfs) == bump_cost["pdfs"]


def test_what_a_bump_still_embeds_reproduces(bump_cost):
    """The claim that replaced "re-embedding is no longer part of it"."""
    for embedded, total in _repeated("chunks a bump embeds"):
        assert (_num(embedded), _num(total)) == (
            bump_cost["misses"],
            bump_cost["chunks"],
        )

    indexed, total, reused, embedded = _stated("PIPELINE_VERSION reuse/embed split").groups()
    assert _num(indexed) == bump_cost["indexed_files"]
    assert _num(total) == bump_cost["chunks"]
    assert _num(reused) == bump_cost["hits"]
    assert _num(embedded) == bump_cost["misses"]

    partial_misses, partial_files = _stated("PIPELINE_VERSION partial-ingest split").groups()
    assert (_num(partial_misses), _num(partial_files)) == (
        bump_cost["partial_misses"],
        bump_cost["partial_files"],
    )

    complete_misses, complete_files = _stated("PIPELINE_VERSION moved-text split").groups()
    assert (_num(complete_misses), _num(complete_files)) == (
        bump_cost["complete_misses"],
        bump_cost["complete_files"],
    )
