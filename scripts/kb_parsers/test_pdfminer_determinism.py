"""Guards for the forked pdfminer reading-order pass.

Three things can quietly undo `pdfminer_determinism`: an upstream change
to the function we forked (our copy then freezes an algorithm pdfminer
has moved on from), anyone dropping the install call (the corpus goes
back to parsing differently in every process), and anyone undoing the
tie-break edit inside the fork (same, but with the install still in
place). One test each, plus two that keep the first of them honest — a
hash that ignores formatting has to be shown to still notice the edit it
is there to notice, and to be shown where it stops ignoring.

The tie-break test reads the fields out of the heap tuples rather than
checking the reading order they decide, and that is deliberate. With
upstream's `id()` restored, which of two exactly-tied pairs merges first
is `sign(id(a) - id(b))`, so an assertion *about the outcome* is decided
by the allocator, and the rate moves with whatever allocated before it.
Measured on this branch, six configurations of 20 fresh processes each —
the outcome test alone and then the whole file, against a fork reverted
at both tie-break sites, at the sweep only, and at the re-push only —
left `test_a_tied_page_merges_in_document_order` at the bottom of this
file green between 8 and 20 times out of 20. Do not expect that spread
to reproduce: four runs of those same six configurations — only comment
text changed between them — gave 8-20, 16-20, 13-20 and 14-20. What
reproduces is the direction. The field test was red 20 of 20 in all six,
and in four more configurations that reorder `boxes` instead of
reverting the fields: 40 mutant configurations across the four runs,
800 processes, no escape.
On the intact tree both tests were green 20 of 20 in every scope. The
field test is never flaky-red; the outcome test is only ever
flaky-green.
"""

from __future__ import annotations

import ast
import hashlib
import heapq
import inspect
import textwrap

import pytest

from kb_parsers import pdfminer_determinism

pdfminer_layout = pytest.importorskip("pdfminer.layout")


def _or_operands(node: ast.expr) -> list:
    """`a | b | c` -> `[a, b, c]`; anything else -> `[itself]`."""
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
        return _or_operands(node.left) + _or_operands(node.right)
    return [node]


def _flatten_or(elements: list) -> ast.expr:
    """`[a, b, c]` -> the AST for `a | b | c`, left-associated, with any
    `|` chain already inside `elements` flattened into it so that
    `Union[a, Union[b, c]]`, `Union[a, b, c]` and `a | b | c` all render
    the same."""
    flat = [operand for element in elements for operand in _or_operands(element)]
    folded = flat[0]
    for element in flat[1:]:
        folded = ast.BinOp(left=folded, op=ast.BitOr(), right=element)
    return folded


class _ExecutableShape(ast.NodeTransformer):
    """Reduce a function's AST to what actually runs: no annotations, no
    docstring, `Union`/`Optional` written in PEP 604 form, and
    `list(<genexpr>)` folded into the equivalent comprehension.

    Every one of those is a rewrite that leaves the statements alone:
    the annotation strip and the docstring strip are the reason a hash
    of the source text is useless here (see `_shape`), the typing
    normalisation is the `Union[X, Y]` -> `X | Y` modernisation that
    pyupgrade and ruff both ship a rule for — and one upstream has
    already run the `List`/`Set`/`Tuple` sibling of over this exact
    function, at 20251229 — and the comprehension folds are
    flake8-comprehensions C400/C401/C402, same elements, same
    evaluation order.
    """

    #: `list`/`set` of a single generator expression fold into the
    #: matching comprehension. `dict` is handled separately: it folds
    #: only when the generator yields a 2-tuple.
    _COMPREHENSION = {
        "list": lambda gen: ast.ListComp(elt=gen.elt, generators=gen.generators),
        "set": lambda gen: ast.SetComp(elt=gen.elt, generators=gen.generators),
    }

    def visit_FunctionDef(self, node: ast.FunctionDef) -> ast.AST:
        self.generic_visit(node)
        node.returns = None
        args = node.args
        for arg in [*args.posonlyargs, *args.args, *args.kwonlyargs]:
            arg.annotation = None
        for arg in (args.vararg, args.kwarg):
            if arg is not None:
                arg.annotation = None
        first = node.body[0] if node.body else None
        if (
            isinstance(first, ast.Expr)
            and isinstance(first.value, ast.Constant)
            and isinstance(first.value.value, str)
        ):
            node.body = node.body[1:] or [ast.Pass()]
        return node

    def visit_AnnAssign(self, node: ast.AnnAssign) -> ast.AST | None:
        self.generic_visit(node)
        if node.value is None:
            return None
        return ast.Assign(targets=[node.target], value=node.value)

    def visit_Subscript(self, node: ast.Subscript) -> ast.AST:
        """`Union[...]` and `Optional[...]` -> `|`, wherever they sit.

        Wherever, not just in an annotation: upstream's function opens
        with `ElementT = Union[LTTextBox, LTTextGroup]`, an ordinary
        assignment, and that is the one place in this function the
        modernisation would land.
        """
        self.generic_visit(node)
        value = node.value
        name = (
            value.id
            if isinstance(value, ast.Name)
            else value.attr if isinstance(value, ast.Attribute) else None
        )
        if name == "Union":
            arguments = (
                list(node.slice.elts)
                if isinstance(node.slice, ast.Tuple)
                else [node.slice]
            )
            return _flatten_or(arguments)
        if name == "Optional":
            return _flatten_or([node.slice, ast.Constant(value=None)])
        return node

    def visit_Call(self, node: ast.Call) -> ast.AST:
        self.generic_visit(node)
        if (
            isinstance(node.func, ast.Name)
            and len(node.args) == 1
            and not node.keywords
            and isinstance(node.args[0], ast.GeneratorExp)
        ):
            inner = node.args[0]
            fold = self._COMPREHENSION.get(node.func.id)
            if fold is not None:
                return fold(inner)
            if (
                node.func.id == "dict"
                and isinstance(inner.elt, ast.Tuple)
                and len(inner.elt.elts) == 2
            ):
                return ast.DictComp(
                    key=inner.elt.elts[0],
                    value=inner.elt.elts[1],
                    generators=inner.generators,
                )
        return node


def _shape(source: str) -> str:
    """sha256 of `source` re-rendered from its executable shape.

    Hashing the source *text* does not work here. `pdfminer.six>=20240706`
    — the floor requirements.txt:18 and .github/requirements-python-ci.txt:35
    declare — spans 11 releases, and upstream reformatted this function
    twice inside that range without changing one statement: 20250324
    wrapped the signature and the `isinstance` call and dropped a blank
    line, 20251229 modernised `List`/`Set`/`Tuple` to the builtin
    generics and turned `list(g for g in plane)` into a comprehension.
    A text hash therefore takes three different values across those 11
    releases, i.e. it is red on 8 of the versions the requirement allows,
    and it cannot tell "upstream changed the algorithm" from "upstream
    ran a formatter". This digest is one single value on all 11.

    `ast.unparse` rather than `ast.dump` for the same reason one axis
    over: a dump embeds the AST field names of the interpreter that
    produced it, so the same function hashes differently on 3.11 than on
    3.13 and 3.14 (measured — two values for identical source), and the
    next Python bump would redden this test with a message about
    pdfminer. Unparsing renders canonical Python instead, which came out
    byte-identical on all three interpreters for all 11 releases.

    What this normalises is the *spelling* of a type, not the statements
    that build one, and that edge is close enough to name. Upstream's
    function opens with `ElementT = Union[LTTextBox, LTTextGroup]`, whose
    only readers are annotations this strips — so by the time the digest
    is taken that assignment is dead, and deleting it, renaming it, or
    adding a member to it still moves the digest and still asks for a
    re-sync that has nothing to re-sync. Deliberate: dropping assignments
    that look dead after the strip would take a statement out of the hash
    on a rule that cannot tell `X = Union[A, B]` from `x = boxes[0]`, and
    the second one can raise. The pin for that edge is the last section
    of `test_shape_ignores_layout_and_typing_but_not_statements`.
    """
    tree = _ExecutableShape().visit(ast.parse(textwrap.dedent(source)))
    rendered = ast.unparse(ast.fix_missing_locations(tree))
    return hashlib.sha256(rendered.encode("utf-8")).hexdigest()


#: Executable shape of `LTLayoutContainer.group_textboxes` as shipped by
#: every pdfminer.six release from 20240706 (the declared floor) through
#: 20260107, the revision `_group_textboxes_stable` was transcribed from.
#: requirements.txt pins only `>=`, so an upgrade can land at any time;
#: when it changes a statement in this function, this test is the thing
#: that says "go re-read upstream and re-sync the fork" instead of
#: letting the two drift apart in silence.
UPSTREAM_GROUP_TEXTBOXES_SHAPE = (
    "fa6810caae237e6b9ecee1d82d6ef05cb1385637533c9b10583b40a17f31015e"
)


def _upstream_source() -> str:
    upstream = pdfminer_determinism.replaced_function()
    assert upstream is not None
    return textwrap.dedent(inspect.getsource(upstream))


def _apply_the_forks_edit(source: str) -> tuple:
    """`source` with every `id(...)` call rewritten to `_ordinal(...)`,
    and how many were rewritten.

    Through the AST rather than `source.replace("id(", "_ordinal(")`:
    upstream's docstring says «id(obj) has to appear before obj», so a
    substring pass hits prose it should not, and would hit a future
    `valid(` or `grid(` too. Only calls in a code position are the edit
    this fork actually makes.
    """
    tree = ast.parse(source)
    rewritten = 0
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "id"
        ):
            node.func = ast.Name(id="_ordinal", ctx=ast.Load())
            rewritten += 1
    return ast.unparse(ast.fix_missing_locations(tree)), rewritten


def test_fork_is_still_in_sync_with_upstream() -> None:
    digest = _shape(_upstream_source())
    assert digest == UPSTREAM_GROUP_TEXTBOXES_SHAPE, (
        "pdfminer's group_textboxes changed since "
        f"{pdfminer_determinism.FORKED_FROM_VERSION} — not just its "
        "formatting or the spelling of a type, its statements. Re-read "
        "it, re-apply the id()->ordinal edit in "
        "kb_parsers/pdfminer_determinism.py, and update this shape to "
        f"{digest}."
    )


def test_the_drift_hash_would_notice_the_forks_own_edit() -> None:
    """`_shape` deliberately throws formatting away, and a normaliser
    that threw away too much would leave the drift test green forever.
    Re-apply the fork's own edit to upstream's source: the shape has to
    move, because that edit is the whole reason this module exists."""
    upstream = _upstream_source()
    forked, rewritten = _apply_the_forks_edit(upstream)
    assert rewritten == 4, (
        f"upstream's group_textboxes calls id() {rewritten} times in a "
        "code position, not at the four tie-break positions this fork "
        "replaces — so the edit re-applied here is no longer the fork's "
        "edit, and this test is calibrating against the wrong thing."
    )

    assert _shape(forked) != _shape(upstream), (
        "`_shape` normalises the fork's own edit away — it would stay "
        "green through an upstream change to the tie-break itself, "
        "which is the one change it exists to catch."
    )


def test_shape_ignores_layout_and_typing_but_not_statements() -> None:
    """The behaviour-preserving rewrites `_shape` is built to absorb,
    plus one that changes behaviour and one it deliberately does not
    absorb — pinned on toy pairs so this test says what `_shape` does
    without depending on how upstream happens to be written today."""
    legacy = (
        "def f(self, xs: List[int]) -> Tuple[int, ...]:\n"
        "    ElementT = Union[int, str]\n"
        "    MaybeT = Optional[ElementT]\n"
        "    ys: List[int] = list(x for x in xs)\n"
        "    zs: Set[int] = set(x for x in xs)\n"
        "    ds: Dict[int, int] = dict((x, x) for x in xs)\n"
        "    return tuple(ys), zs, ds, ElementT, MaybeT\n"
    )
    modernised = (
        "def f(\n"
        "    self,\n"
        "    xs: list[int],\n"
        ") -> tuple[int, ...]:\n"
        '    """Now with a docstring."""\n'
        "    ElementT = int | str\n"
        "    MaybeT = ElementT | None\n"
        "    ys = [x for x in xs]\n"
        "    zs = {x for x in xs}\n"
        "    ds = {x: x for x in xs}\n"
        "    return tuple(ys), zs, ds, ElementT, MaybeT\n"
    )
    assert _shape(legacy) == _shape(modernised)

    behaviour_changed = modernised.replace(
        "return tuple(ys)", "return tuple(sorted(ys))"
    )
    assert _shape(behaviour_changed) != _shape(modernised)

    # The disclosed edge, pinned here so a future widening has to come
    # through this line. `_shape` normalises how a type is spelled, not
    # the statements that build one, so an alias whose only readers are
    # annotations is still hashed as a statement: deleting it, renaming
    # it or widening it moves the digest and fires a re-sync request
    # with nothing to re-sync. Upstream's `ElementT` is exactly that
    # shape. If you close this, delete these three assertions and
    # rewrite the paragraph in `_shape` that discloses it.
    alias_deleted = modernised.replace("    ElementT = int | str\n", "")
    alias_renamed = modernised.replace("ElementT", "_Element")
    alias_widened = modernised.replace("ElementT = int | str", "ElementT = int | bytes")
    assert _shape(alias_deleted) != _shape(modernised)
    assert _shape(alias_renamed) != _shape(modernised)
    assert _shape(alias_widened) != _shape(modernised)


def test_parsing_a_pdf_installs_the_fork(tmp_path, monkeypatch) -> None:
    """`_parse_text_layer` is the only entry point into pdfminer we
    have, so the install has to happen there — not in a caller that a
    future refactor might route around."""
    from kb_parsers import pdf_parser

    upstream = pdfminer_determinism.replaced_function()
    # monkeypatch puts all three back afterwards, so the rest of the
    # session keeps the fork.
    monkeypatch.setattr(
        pdfminer_layout.LTLayoutContainer, "group_textboxes", upstream
    )
    monkeypatch.setattr(pdfminer_determinism, "_installed", False)
    monkeypatch.setattr(pdfminer_determinism, "_replaced", None)

    pdf = tmp_path / "not-really.pdf"
    pdf.write_bytes(b"not a pdf")
    with pytest.raises(Exception):
        pdf_parser._parse_text_layer(pdf)

    assert (
        pdfminer_layout.LTLayoutContainer.group_textboxes
        is pdfminer_determinism._group_textboxes_stable
    )


def _leaves(obj) -> list:
    """Reading order the layout pass produced, as (x0, y0) pairs."""
    if not hasattr(obj, "__iter__"):
        return [(obj.x0, obj.y0)]
    out: list = []
    for child in obj:
        out.extend(_leaves(child))
    return out


def _tied_scene() -> list:
    """Four equal boxes in two equally-spaced pairs, so the two merges
    tie on distance exactly and something has to break the tie."""
    coords = [(0, 0, 10, 10), (20, 0, 30, 10), (200, 0, 210, 10), (220, 0, 230, 10)]
    return [pdfminer_layout.LTComponent(c) for c in coords]


class _RecordingHeap:
    """Stands in for the `heapq` module inside `_group_textboxes_stable`,
    forwarding to the real one and keeping every tuple that reaches the
    heap, in the order the function built them."""

    def __init__(self) -> None:
        self.records: list = []
        self.heapified = 0
        self.pushed = 0

    def heapify(self, items) -> None:
        self.records.extend(items)
        self.heapified += len(items)
        heapq.heapify(items)

    def heappush(self, items, item) -> None:
        self.records.append(item)
        self.pushed += 1
        heapq.heappush(items, item)

    def heappop(self, items):
        return heapq.heappop(items)


def _record_heap_tuples(monkeypatch, boxes: list):
    """Run the installed `group_textboxes` over `boxes` and hand back
    every tuple that reached the heap, in build order."""
    pdfminer_determinism.install()
    heap = _RecordingHeap()
    monkeypatch.setattr(pdfminer_determinism, "heapq", heap)
    container = pdfminer_layout.LTLayoutContainer((0, 0, 300, 100))
    groups = pdfminer_layout.LTLayoutContainer.group_textboxes(
        container, pdfminer_layout.LAParams(), boxes
    )
    return heap, groups


def _assert_fields_are_argument_positions(boxes: list, heap: _RecordingHeap) -> None:
    """Every tie-break field is the ordinal `boxes` implies: box k is k.

    The expectation for a box comes from the argument, not from the
    records — that is the difference between "these fields are dense
    0-based indices" (which `sorted(boxes, key=id)` also satisfies) and
    "these fields are the document's own order". Groups are the one
    thing the argument cannot describe, since the document does not
    contain them; they are numbered from `len(boxes)` up in creation
    order, and the pass below only checks that they are dense and stable
    within the call.
    """
    expected_of = {id(box): index for index, box in enumerate(boxes)}
    next_group_ordinal = len(boxes)
    for _skip_isany, _distance, field1, field2, obj1, obj2 in heap.records:
        for field, obj in ((field1, obj1), (field2, obj2)):
            if id(obj) not in expected_of:
                expected_of[id(obj)] = next_group_ordinal
                next_group_ordinal += 1
            expected = expected_of[id(obj)]
            assert field == expected, (
                f"heap tuple tie-break field is {field}, not {expected}, "
                f"the position this {type(obj).__name__} was handed in at. "
                "Upstream breaks ties on id(obj); pdfminer_determinism "
                "forks group_textboxes to break them on the order the "
                "document put the boxes in, and that edit is gone or has "
                "been made to follow something other than the argument — "
                "the corpus is back to parsing differently in every "
                "process."
            )


def _sweep_pairs(boxes: list, heap: _RecordingHeap) -> list:
    """The pairs the O(n^2) sweep built, as positions in `boxes`."""
    position = {id(box): index for index, box in enumerate(boxes)}
    return [
        (position.get(id(obj1)), position.get(id(obj2)))
        for *_fields, obj1, obj2 in heap.records[: heap.heapified]
    ]


def test_tie_break_fields_are_argument_position_ordinals(monkeypatch) -> None:
    """The one property the fork exists for: positions 2 and 3 of every
    heap tuple are the boxes' positions in `boxes`, not their `id()`s.

    Read the field, not the reading order it decides. An outcome
    assertion cannot guard this: restore upstream's `id()` and the
    winner of a tie is a comparison of two addresses, which lands on the
    order the fork produces often enough that the outcome test below
    survived a reverted fork 8 to 20 times out of 20 across the six
    configurations named in this file's docstring. This one was red 20
    of 20 in every one of them, because it checks every tuple, from both
    sites that build one (the O(n^2) sweep and the re-push after a
    merge) — including the re-push site alone, which the outcome test
    never caught at all (20 of 20 green, both scopes).

    The second half is why the same four boxes are grouped twice, in
    opposite orders. Dense 0-based fields are not the property; fields
    that follow the *document* are. `boxes = list(set(boxes))` inserted
    ahead of the sweep leaves every field a dense first-seen ordinal
    (checked directly under that mutation) while handing the reading
    order back to the allocator — the scene below came back in 6
    distinct orders across 20 fresh processes, against 1 intact — and a
    check that rebuilt its expectation from the same tuples the function
    numbered from would agree with it. Grouping the identical objects
    twice in opposite orders removes that: an order computed from the
    boxes themselves — from their addresses, or their coordinates — is
    the same order in both calls, so it can match at most one of the two
    arguments. `sorted(boxes, key=id)` is exactly that, and was red
    20/20 in each of the eight configurations it was run in.

    What this cannot see: a reorder that reproduces the argument order
    in both calls. Only something randomised per call can, and only by
    coincidence, which is why `list(set(boxes))` — a set's iteration
    order also moves with what was inserted into it when — is measured
    here rather than argued: red 20/20 in each of its eight
    configurations too, so the coincidence did not land once in 160
    processes. The outcome test below does catch a reordering more often
    than it catches a reverted tie-break, but not reliably: over those
    16 configurations its greens ran from 0 to 17 out of 20. The scene
    is also four synthetic boxes, not a corpus page; the corpus-scale
    claim lives in `pdfminer_determinism`'s module docstring, measured,
    not here.
    """
    forward = _tied_scene()
    heap, groups = _record_heap_tuples(monkeypatch, forward)

    # Both tuple-building sites ran: 4 boxes give 6 sweep pairs, and the
    # merges that collapse them into one group go through the push site.
    assert heap.heapified == 6, heap.heapified
    assert heap.pushed > 0, "no merge happened; the push site went unchecked"
    assert len(groups) == 1

    _assert_fields_are_argument_positions(forward, heap)
    assert _sweep_pairs(forward, heap) == [
        (0, 1),
        (0, 2),
        (0, 3),
        (1, 2),
        (1, 3),
        (2, 3),
    ], "the sweep did not walk `boxes` in the order it was handed in"

    # The same four objects, handed in backwards. `_ordinal` has to
    # follow the argument, so the fields have to come out the same and
    # the reading order has to come out mirrored.
    backward = list(reversed(forward))
    back_heap, back_groups = _record_heap_tuples(monkeypatch, backward)

    _assert_fields_are_argument_positions(backward, back_heap)
    assert _sweep_pairs(backward, back_heap) == _sweep_pairs(forward, heap)
    assert [_leaves(g) for g in back_groups] == [
        [(20, 0), (0, 0), (220, 0), (200, 0)]
    ], (
        "grouping the same boxes backwards did not mirror the reading "
        "order, so the tie-break is following something other than the "
        "order `boxes` arrived in"
    )


def test_a_tied_page_merges_in_document_order() -> None:
    """What the fork's tie-break produces end to end, through the
    installed `LTLayoutContainer.group_textboxes` rather than the module
    global: the pair that comes first in `boxes` wins the tie and merges
    first, and the page then reads in one fixed order in every process.

    This is an illustration, not the guard. With the fork's edit
    reverted, upstream's `id()` tie-break still lands on this same order
    8 to 20 times out of 20 fresh processes, depending on which tests
    ran before it, so a revert walks past this assertion most runs. The
    field test above is what catches it, every run.
    """
    pdfminer_determinism.install()
    container = pdfminer_layout.LTLayoutContainer((0, 0, 300, 100))

    groups = pdfminer_layout.LTLayoutContainer.group_textboxes(
        container, pdfminer_layout.LAParams(), _tied_scene()
    )

    assert [_leaves(g) for g in groups] == [
        [(200, 0), (220, 0), (0, 0), (20, 0)]
    ]
