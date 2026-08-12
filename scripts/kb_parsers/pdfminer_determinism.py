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
parsing every file's text layer in two separate processes and comparing
a sha256 over each file's page texts, 26 of the 184 files disagreed.
The differences are reordered blocks, not lost characters — but they
move chunk boundaries, so the chunk fingerprints move too, and
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
sha256 of the upstream function we forked from. A pdfminer upgrade that
touches `group_textboxes` turns that test red, which is the signal to
re-read upstream and re-sync this copy. Note what the red test does NOT
do: `install()` still applies this copy, because a version skew is a
reason to review the fork, not a reason to hand the corpus back to a
parse that differs run to run.
"""

from __future__ import annotations

import heapq
import itertools
from typing import Sequence, cast

#: pdfminer.six release this file was forked from. The upstream source
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

    Transcribed from pdfminer.six 20260107. The only edits are the two
    `id(obj)` calls in each heap tuple, which become `_ordinal(obj)`,
    and the `done` set, which now holds those ordinals. Keeping the
    ordinals in the same tuple positions preserves the comparison order
    upstream relies on: `(skip_isany, distance, ...)` still decides
    every pair whose distance differs, and the boxes themselves are
    still never compared.
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
        the ordinal up: every object that gets one is held alive by
        `plane` or by the heap for as long as the ordinal is in use, so
        no address is ever recycled underneath us."""
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

    # Number the boxes before any distance is computed, so the ordinals
    # follow the order pdfminer produced the boxes in rather than the
    # order the O(n^2) sweep happens to touch them.
    for box in boxes:
        _ordinal(box)

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
