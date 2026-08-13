"""Make pdfminer's page layout analysis reproducible across processes.

pdfminer decides the reading order of a page by repeatedly merging the
two closest text boxes (`LTLayoutContainer.group_textboxes`). Candidate
pairs live in a heap of `(skip_isany, distance, id(obj1), id(obj2),
obj1, obj2)` tuples, and the two `id()` fields are there only because
`LTComponent` disables `__lt__` — without them the heap would try to
compare the boxes themselves and raise. Upstream's own docstring says
so.

The side effect is that whenever two candidate pairs tie on distance —
which happens constantly on a page with repeated geometry: two-column
bodies, running headers, footnote blocks, standalone page numbers — the
merge that wins is decided by CPython memory addresses. Those differ
from one process to the next, so the same PDF parsed twice can come
back with its text boxes in a different order.

Measured on the FSHD corpus (`content/medical-kb/source`, 184 PDFs):
parsing every file's text layer in separate processes and comparing a
sha256 over each file's page texts, three pairs of processes disagreed
on 27, 26 and 24 files — 28 distinct files across the three, since which
tied pair wins is a coin flip per process and no single pair turns them
all up. The differences are reordered blocks, not lost characters, but
they move chunk boundaries, so the chunk fingerprints move too and
`VectorBackend.reusable_embeddings` misses on chunks whose source file
never changed. Two ingests of an untouched corpus also disagree about
what the corpus says.

The fix is to number the objects in the order the algorithm first sees
them and break ties on that number instead of on `id()`. Same
algorithm, same distances, same merges wherever the distances differ;
the only thing that changes is which of two exactly-tied pairs is
merged first, and now that answer is a function of the document rather
than of the allocator. With this installed, the same two-process
comparison over the same 184 files reports 0 files differing.

This is a fork of a third-party internal, and requirements.txt pins
pdfminer only as `>=`, so `test_pdfminer_determinism.py` pins the
upstream function's executable shape: its AST with annotations,
docstring, formatting and the `Union[X, Y]` / `X | Y` spelling of a
type normalised away, re-rendered as canonical Python. That is one
single value across all 11 releases `>=20240706` allows, so upstream
reformatting the function (which it did twice inside that range) does
not fire it and upstream changing a statement does. A red there is the
signal to re-read upstream and re-sync this copy, and the checklist for
doing that is `_group_textboxes_stable`'s own docstring below. Note what
the red test does NOT do: `install()` still applies this copy, because a
version skew is a reason to review the fork, not a reason to hand the
corpus back to a parse that differs run to run.
"""

from __future__ import annotations

import heapq
import itertools
from typing import Sequence, cast

#: pdfminer.six release this file was forked from. The upstream shape
#: hash lives in the test, not here, so that reading this module never
#: requires importing pdfminer.
FORKED_FROM_VERSION = "20260107"

_installed = False
_replaced = None


def install() -> None:
    """Replace `LTLayoutContainer.group_textboxes` with the
    order-stable variant. Idempotent; safe to call per parse."""
    global _installed, _replaced
    if _installed:
        return

    from pdfminer.layout import LTLayoutContainer  # type: ignore

    # Kept so the drift test can still read upstream's source after the
    # patch has been applied. Without it the test would have to run
    # before anything else touches pdfminer, and would silently skip
    # itself the moment some other test parsed a PDF first.
    _replaced = LTLayoutContainer.__dict__.get("group_textboxes")
    LTLayoutContainer.group_textboxes = _group_textboxes_stable  # type: ignore[method-assign]
    _installed = True


def replaced_function():
    """The upstream `group_textboxes` this module forked and replaced."""
    install()
    return _replaced


def _group_textboxes_stable(
    self,
    laparams,
    boxes: Sequence,
) -> list:
    """`LTLayoutContainer.group_textboxes`, tie-broken on first-seen
    order instead of on `id()`.

    Transcribed from pdfminer.six 20260107. The edit this file exists
    for is the two `id(obj)` calls in each of the two heap tuples, which
    become `_ordinal(obj)`; `done` then holds ordinals rather than
    addresses. Keeping the ordinals in the same tuple positions
    preserves the comparison order upstream relies on: `(skip_isany,
    distance, ...)` still decides every pair whose distance differs, and
    the boxes themselves are still never compared.

    The rest of the diff against upstream changes nothing at runtime:
    the `counter` / `ordinals` / `_ordinal` helper the edit needs,
    upstream's module-level imports moved in here so that importing this
    module does not import pdfminer, upstream's opening
    `ElementT = Union[LTTextBox, LTTextGroup]` dropped along with the
    annotations that were its only readers (transcribe that line
    literally and you get `NameError: name 'Union' is not defined`, and
    once you fix that, the same for `LTTextBox` — this module imports
    neither), and annotations dropped or loosened elsewhere:
    `done: set[int]` is ours, upstream writes a bare `done = set()`.
    Everything else — `dist`, `isany`, the O(n^2) sweep, the merge loop
    — is upstream's, minus those tie-break fields.

    So re-syncing after a pdfminer upgrade is: re-transcribe the
    function, re-apply exactly what the paragraphs above name, and then
    check the two things the reading order actually depends on, because
    a transcription can preserve every line named above and still lose
    the property.

    1. The tie-break fields, which is the edit itself. The field test in
       `test_pdfminer_determinism.py` reads them back out of the heap
       tuples rather than checking the order they decide.
    2. The order of `boxes`. The sweep numbers the boxes in the order
       they arrive, so anything that reorders the sequence on the way in
       — `list(set(boxes))`, `sorted(boxes, key=id)` — hands the tie
       straight back to the allocator while leaving every ordinal a
       well-formed dense index. That is why the field test groups the
       same boxes twice, in opposite orders.

    `Plane.__iter__`'s order is not a third dependency, though it reads
    like one: every object the re-push loop takes out of the plane has
    already been numbered — the boxes by the sweep, the groups by an
    earlier re-push — and `heapq` pops in tuple order however the tuples
    were pushed.
    """
    from pdfminer.layout import (  # type: ignore
        LTTextBoxVertical,
        LTTextGroup,
        LTTextGroupLRTB,
        LTTextGroupTBRL,
    )
    from pdfminer.utils import Plane  # type: ignore

    counter = itertools.count()
    ordinals: dict[int, int] = {}

    def _ordinal(obj) -> int:
        """First-seen index for `obj`. Keyed on `id()` — which is fine
        here, unlike upstream, because the value is only used to look
        the ordinal up, never to order anything.

        That keying is sound only while nothing numbered here can be
        freed and have its address handed to something else, and nothing
        can: a box is held by `boxes` for the whole call; a group is
        held by the local `group` name from the moment it is created,
        which is before it is numbered, then by every tuple it is pushed
        into, by `plane` from `plane.add` until it is merged, and by the
        group it is merged into after that. No shipped test checks this,
        and none usefully could: a test watching the numbered objects
        would have to hold them, which is the very condition that makes
        a recycle impossible."""
        key = id(obj)
        if key not in ordinals:
            ordinals[key] = next(counter)
        return ordinals[key]

    plane: Plane = Plane(self.bbox)

    def dist(obj1, obj2) -> float:
        x0 = min(obj1.x0, obj2.x0)
        y0 = min(obj1.y0, obj2.y0)
        x1 = max(obj1.x1, obj2.x1)
        y1 = max(obj1.y1, obj2.y1)
        return (
            (x1 - x0) * (y1 - y0)
            - obj1.width * obj1.height
            - obj2.width * obj2.height
        )

    def isany(obj1, obj2) -> set:
        """Check if there's any other object between obj1 and obj2."""
        x0 = min(obj1.x0, obj2.x0)
        y0 = min(obj1.y0, obj2.y0)
        x1 = max(obj1.x1, obj2.x1)
        y1 = max(obj1.y1, obj2.y1)
        objs = set(plane.find((x0, y0, x1, y1)))
        return objs.difference((obj1, obj2))

    dists: list = []
    for i in range(len(boxes)):
        box1 = boxes[i]
        for j in range(i + 1, len(boxes)):
            box2 = boxes[j]
            dists.append(
                (False, dist(box1, box2), _ordinal(box1), _ordinal(box2), box1, box2)
            )
    heapq.heapify(dists)

    plane.extend(boxes)
    done: set[int] = set()
    while len(dists) > 0:
        (skip_isany, d, id1, id2, obj1, obj2) = heapq.heappop(dists)
        # Skip objects that are already merged
        if (id1 not in done) and (id2 not in done):
            if not skip_isany and isany(obj1, obj2):
                heapq.heappush(dists, (True, d, id1, id2, obj1, obj2))
                continue
            if isinstance(obj1, (LTTextBoxVertical, LTTextGroupTBRL)) or isinstance(
                obj2,
                (LTTextBoxVertical, LTTextGroupTBRL),
            ):
                group = LTTextGroupTBRL([obj1, obj2])
            else:
                group = LTTextGroupLRTB([obj1, obj2])
            plane.remove(obj1)
            plane.remove(obj2)
            done.update([id1, id2])

            for other in plane:
                heapq.heappush(
                    dists,
                    (
                        False,
                        dist(group, other),
                        _ordinal(group),
                        _ordinal(other),
                        group,
                        other,
                    ),
                )
            plane.add(group)
    # By now only groups are in the plane
    return [cast(LTTextGroup, g) for g in plane]
