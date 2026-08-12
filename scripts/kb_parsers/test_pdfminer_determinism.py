"""Guards for the forked pdfminer reading-order pass.

Two things can quietly undo `pdfminer_determinism`: an upstream change
to the function we forked (our copy then freezes an algorithm pdfminer
has moved on from), and anyone dropping the install call (the corpus
goes back to parsing differently in every process). One test each.
"""

from __future__ import annotations

import hashlib
import inspect
import textwrap

import pytest

from kb_parsers import pdfminer_determinism

pdfminer_layout = pytest.importorskip("pdfminer.layout")

#: sha256 of `LTLayoutContainer.group_textboxes` as shipped by
#: pdfminer.six 20260107 — the revision `_group_textboxes_stable` was
#: transcribed from. requirements.txt pins only `pdfminer.six>=20240706`,
#: so an upgrade can land at any time; when it changes this function,
#: this test is the thing that says "go re-read upstream and re-sync the
#: fork" instead of letting the two drift apart in silence.
UPSTREAM_GROUP_TEXTBOXES_SHA256 = (
    "f856d3d1f2ff48ccd70bf9bf6c7318f8137177ed7dade52629d185d327009e28"
)


def test_fork_is_still_in_sync_with_upstream() -> None:
    upstream = pdfminer_determinism.replaced_function()
    assert upstream is not None
    src = textwrap.dedent(inspect.getsource(upstream))
    digest = hashlib.sha256(src.encode("utf-8")).hexdigest()
    assert digest == UPSTREAM_GROUP_TEXTBOXES_SHA256, (
        "pdfminer's group_textboxes changed since "
        f"{pdfminer_determinism.FORKED_FROM_VERSION}. Re-read it, re-apply "
        "the id()->ordinal edit in kb_parsers/pdfminer_determinism.py, and "
        f"update this hash to {digest}."
    )


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


def _scene(reverse_allocation: bool) -> list:
    """Four equal boxes in two equally-spaced pairs, so the two merges
    tie on distance exactly and something has to break the tie.

    `reverse_allocation` builds the objects back to front and then
    reverses the list, so the boxes arrive in the same logical order
    while their `id()`s run the other way.
    """
    coords = [(0, 0, 10, 10), (20, 0, 30, 10), (200, 0, 210, 10), (220, 0, 230, 10)]
    if reverse_allocation:
        boxes = [pdfminer_layout.LTComponent(c) for c in reversed(coords)]
        boxes.reverse()
        return boxes
    return [pdfminer_layout.LTComponent(c) for c in coords]


def test_reading_order_does_not_depend_on_allocation_order() -> None:
    pdfminer_determinism.install()
    container = pdfminer_layout.LTLayoutContainer((0, 0, 300, 100))

    forward = pdfminer_layout.LTLayoutContainer.group_textboxes(
        container, pdfminer_layout.LAParams(), _scene(False)
    )
    backward = pdfminer_layout.LTLayoutContainer.group_textboxes(
        container, pdfminer_layout.LAParams(), _scene(True)
    )

    assert [_leaves(g) for g in forward] == [_leaves(g) for g in backward]
