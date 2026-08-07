"""Tests for the retrieval-quality layer in apps/api/knowledge.py:
the relevance floor and the source-authority tiering.

Like test_kb_service.py these target a module under apps/api rather
than a kb_parsers module, and use the same sys.path bootstrap so they
run without standing up the KB service, Postgres or an embedder.

The two things being protected here are both "the product must never
tell a patient something untrue" failures:

  * without the floor, a question the corpus cannot answer still
    returned its 8 nearest neighbours and the answer layer wrote an
    answer from them;
  * without the tiering, a 病友 anecdote could outrank a clinical
    guideline at comparable distance.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import pytest

_HERE = Path(__file__).resolve().parent
_REPO_ROOT = _HERE.parent.parent


@pytest.fixture(scope="module")
def kb():
    apps_api = _REPO_ROOT / "apps" / "api"
    if str(apps_api) not in sys.path:
        sys.path.insert(0, str(apps_api))
    import knowledge

    return knowledge


@pytest.fixture(scope="module")
def ingest_mod():
    """kb-ingest.py, loaded through importlib because of the hyphen.

    Same bootstrap as test_ingest_helpers.py.
    """
    for path in (_REPO_ROOT / "apps" / "api", _HERE.parent):
        if str(path) not in sys.path:
            sys.path.insert(0, str(path))
    spec = importlib.util.spec_from_file_location(
        "kb_ingest_authority_under_test", _HERE.parent / "kb-ingest.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


# ------------------------------------------------------------ authority tier


@pytest.mark.parametrize(
    "source_key,expected",
    [
        # Every path below is a real corpus path (2026-08 snapshot).
        ("指南共识/（指南）（全面）Dutch-FSHD-Guideline-English-24012019_1_44_translate.pdf", "guideline"),
        ("文献/hamel2019_副本.docx", "literature"),
        ("05.相关研究/第一批：2025年3月31日/B.6个月居家康复计划及研究.pdf", "literature"),
        ("AFO/Balance and gait in facioscapulohumeral muscular dystrophy.pdf", "literature"),
        # Corpus root: papers, preprints and conference abstract books.
        (
            "Balancing Risks in Obstetrics_ Anesthesia Management in "
            "Facioscapulohumeral Muscular Dystrophy With Scoliosis AANA "
            "Journal _ October 2025.pdf",
            "literature",
        ),
        ("11.病友经验/第二批：2025年5月15日/我们的故事丨被小火慢炖的人生.pdf", "community"),
        (
            "11.病友经验/第二批：2025年5月15日/我们的故事｜患友自传《不管如何，你得长大》"
            "连载1-4/连载3.pdf",
            "community",
        ),
        ("02.临床管理与治疗/第一批：2025年3月31日/B.FSHD上肢康复：患者观点.pdf", "reference"),
        ("07.项目活动/第一批：2025年3月31日/FSHD甲基化筛查患者招募详情.pdf", "reference"),
        ("12.资源库/第二批：2025年5月15日/FSHD合作门诊信息（华山）.pdf", "reference"),
        ("10.心理支持/5月15日第二批/C.8 tips for coping with a serious diagnosis.pdf", "reference"),
        # Filename promotion: the real practice guidelines are filed by
        # topic, not under 指南共识/.
        ("02.临床管理与治疗/第一批：2025年3月31日/A.指南【康复】PhysicalTherapyAndFSHD_May2009.pdf", "guideline"),
        ("01.疾病定义和科普/第一批：2025年3月31日/A.指南Evidence-based Guideline Summary.pdf", "guideline"),
        ("03.遗传生育/第一批：2025年3月31日/A.胚胎植入前遗传学检测的遗传咨询专家共识.html", "guideline"),
        ("FSHD_Care_Guidelines_for_Clinicians.pdf", "guideline"),
        # Not guidelines despite living beside them.
        ("06.政策与倡导教育/5月15日第二批/A.药品注册管理办法.pdf", "reference"),
        ("06.政策与倡导教育/5月15日第二批/A.国家罕见病医学中心设置标准.pdf", "reference"),
        # Unclassifiable.
        ("", "unknown"),
        (None, "unknown"),
    ],
)
def test_authority_tier_for_path(kb, source_key, expected):
    assert kb.authority_tier_for_path(source_key) == expected


def test_guideline_promotion_never_escapes_the_community_tier(kb):
    """A patient story is a patient story whatever it is titled.

    The promotion rule matches 指南 anywhere in the filename, so without
    the community guard a future《我的求医指南》under 11.病友经验/ would
    be labelled 指南/共识 to a reader — presenting one person's account
    in the register of clinical guidance.
    """
    assert (
        kb.authority_tier_for_path("11.病友经验/第二批：2025年5月15日/我的求医指南.pdf")
        == "community"
    )


def test_authority_labels_are_distinct_and_patient_facing(kb):
    assert kb.authority_for_path("指南共识/x.pdf")["label"] == "指南/共识"
    assert kb.authority_for_path("文献/x.docx")["label"] == "文献"
    assert kb.authority_for_path("11.病友经验/x.pdf")["label"] == "病友经验"


def test_authority_penalties_are_ordered_and_small(kb):
    tiers = kb.AUTHORITY_TIERS
    assert (
        tiers["guideline"]["penalty"]
        < tiers["literature"]["penalty"]
        < tiers["reference"]["penalty"]
        < tiers["community"]["penalty"]
    )
    # The whole spread must stay well inside the in-corpus distance band
    # (~0.21-0.41 measured). A spread that grows past this stops being a
    # tie-breaker and starts overriding relevance.
    assert tiers["community"]["penalty"] - tiers["guideline"]["penalty"] <= 0.05


def test_unknown_tier_is_not_promoted(kb):
    """A path we cannot classify must rank no better than 资料."""
    unknown = kb.AUTHORITY_TIERS["unknown"]
    reference = kb.AUTHORITY_TIERS["reference"]
    assert unknown["penalty"] == reference["penalty"]
    assert unknown["label"] == reference["label"]


def test_resolve_authority_prefers_the_stored_tier(kb):
    resolved = kb.resolve_authority({"authority_tier": "community"}, "指南共识/x.pdf")
    assert resolved["tier"] == "community"


def test_resolve_authority_falls_back_to_the_path(kb):
    """The 9,594 rows that predate the backfill still have to rank."""
    assert kb.resolve_authority({}, "指南共识/x.pdf")["tier"] == "guideline"
    assert kb.resolve_authority(None, "11.病友经验/x.pdf")["tier"] == "community"


def test_resolve_authority_ignores_an_unrecognised_stored_tier(kb):
    resolved = kb.resolve_authority({"authority_tier": "vip"}, "指南共识/x.pdf")
    assert resolved["tier"] == "guideline"


# ------------------------------------------------------- floor env resolution


@pytest.mark.parametrize(
    "raw,expected",
    [
        (None, 0.40),
        ("", 0.40),
        ("0.35", 0.35),
        ("0.5", 0.5),
        ("off", None),
        ("none", None),
        ("disabled", None),
        ("0", None),
        ("-1", None),
        # Unparseable must not silently disable the floor.
        ("abc", 0.40),
    ],
)
def test_resolve_relevance_floor(kb, raw, expected):
    assert kb._resolve_relevance_floor(raw) == expected


def test_default_floor_sits_in_the_measured_separating_band(kb):
    """Guards the documented measurement, not an arbitrary number.

    [0.3782, 0.4054] is the gap between the worst in-corpus best-hit and
    the best out-of-corpus best-hit measured by
    `scripts/kb-verify.py --floor-probe`. A default outside it either
    cuts real answers or admits questions the corpus cannot answer.
    """
    assert 0.3782 < kb.DEFAULT_RELEVANCE_FLOOR < 0.4054


# --------------------------------------------------------------- search_multi


class _FakeEmbedder:
    model_name = "fake"
    dimension = 3

    def embed_texts(self, texts: List[str]) -> List[List[float]]:
        return [[0.0, 0.0, 0.0] for _ in texts]

    def embed_one(self, text: str) -> List[float]:
        return [0.0, 0.0, 0.0]


class _FakeBackend:
    id = "fake"

    def __init__(self, hits) -> None:
        self._hits = hits

    def query_multi(self, query_embeddings, fetch_k, where=None):
        return [list(self._hits) for _ in query_embeddings]


def _hit(kb, *, distance: float, source_file: str, content: Optional[str] = None,
         metadata: Optional[Dict[str, Any]] = None):
    from kb_backends.base import QueryHit

    # Long enough and sentence-terminated so knowledge.py's junk filters
    # (min length, title-fragment) keep it — those are tested elsewhere.
    body = content or (
        f"这是一段用于测试的知识库正文，来源是 {source_file}，"
        "内容足够长以通过最小长度与标题片段过滤。"
    )
    return QueryHit(
        content=body,
        metadata=metadata if metadata is not None else {},
        distance=distance,
        fingerprint=None,
        source_file=source_file,
    )


def _kb_with(kb, hits, **kwargs):
    return kb.FSHDKnowledgeBase(
        backend=_FakeBackend(hits), embedder=_FakeEmbedder(), **kwargs
    )


def test_floor_drops_everything_when_nothing_is_close_enough(kb):
    instance = _kb_with(
        kb,
        [
            _hit(kb, distance=0.47, source_file="文献/a.docx"),
            _hit(kb, distance=0.52, source_file="文献/b.docx"),
        ],
        relevance_floor=0.40,
    )
    result = instance.search_multi("杜氏肌营养不良的激素方案？", ["DMD 激素"])

    assert result["chunks"] == []
    assert result["metadata"]["below_relevance_floor"] is True
    assert result["metadata"]["dropped_below_floor"] == 2
    assert result["metadata"]["candidates_considered"] == 2
    assert result["metadata"]["best_distance"] == pytest.approx(0.47)
    assert result["metadata"]["relevance_floor"] == 0.40


def test_floor_keeps_the_hits_that_are_close_enough(kb):
    instance = _kb_with(
        kb,
        [
            _hit(kb, distance=0.28, source_file="文献/close.docx"),
            _hit(kb, distance=0.61, source_file="文献/far.docx"),
        ],
        relevance_floor=0.40,
    )
    result = instance.search_multi("FSHD 是什么病？", ["FSHD"])

    assert len(result["chunks"]) == 1
    assert result["metadata"]["below_relevance_floor"] is False
    assert result["metadata"]["dropped_below_floor"] == 1


def test_below_floor_is_false_when_there_were_no_candidates_at_all(kb):
    """An empty corpus is not「知识库里没有这个主题」.

    Zero candidates means the search found nothing to judge — possibly
    because the corpus is empty or the backend is broken. Reporting that
    as「we looked and the KB has nothing on it」would state a fact about
    the corpus we did not establish.
    """
    instance = _kb_with(kb, [], relevance_floor=0.40)
    result = instance.search_multi("FSHD 是什么病？", ["FSHD"])

    assert result["chunks"] == []
    assert result["metadata"]["below_relevance_floor"] is False
    assert result["metadata"]["candidates_considered"] == 0


def test_backend_hits_reports_what_the_store_returned(kb):
    """The signal that tells an empty corpus apart from a junk-only result.

    Both end up with `chunks == []`, and the answer layer has to say
    different things: an empty corpus is an outage, a junk-only result
    is a real search. Counting AFTER the junk filter would collapse the
    two back together.
    """
    junk_only = _kb_with(
        kb,
        # Below the 30-character minimum, so the junk filter takes it.
        [_hit(kb, distance=0.10, source_file="文献/a.docx", content="太短")],
        relevance_floor=0.40,
    )
    result = junk_only.search_multi("FSHD？", ["FSHD"])
    assert result["metadata"]["backend_hits"] == 1
    assert result["metadata"]["candidates_considered"] == 0

    empty_corpus = _kb_with(kb, [], relevance_floor=0.40)
    result = empty_corpus.search_multi("FSHD？", ["FSHD"])
    assert result["metadata"]["backend_hits"] == 0


def test_floor_can_be_disabled(kb):
    instance = _kb_with(
        kb, [_hit(kb, distance=0.93, source_file="文献/a.docx")], relevance_floor=None
    )
    result = instance.search_multi("天气", ["天气"])

    assert len(result["chunks"]) == 1
    assert result["metadata"]["below_relevance_floor"] is False
    assert result["metadata"]["relevance_floor"] is None


def test_floor_judges_raw_distance_not_the_authority_adjusted_one(kb):
    """The tier must never move the floor.

    A 病友经验 hit exactly at the floor carries a +0.03 ranking penalty.
    If the floor were applied after the penalty this chunk would be cut
    for being 0.43, and the tiering would silently become a second,
    stricter floor for the lowest tier.
    """
    instance = _kb_with(
        kb,
        [_hit(kb, distance=0.40, source_file="11.病友经验/第二批：2025年5月15日/x.pdf")],
        relevance_floor=0.40,
    )
    result = instance.search_multi("确诊后怎么调整？", ["确诊 心理"])

    assert len(result["chunks"]) == 1
    assert result["chunks"][0]["authority_tier"] == "community"


def test_authority_breaks_a_near_tie_in_favour_of_the_guideline(kb):
    """The case this tiering exists for.

    A forum anecdote 0.01 closer than the AANA anaesthesia paper used to
    win outright. With the tier applied the paper comes first.
    """
    instance = _kb_with(
        kb,
        [
            _hit(kb, distance=0.31, source_file="11.病友经验/第二批：2025年5月15日/我的麻醉经历.pdf"),
            _hit(kb, distance=0.32, source_file="指南共识/Dutch-FSHD-Guideline.pdf"),
        ],
        relevance_floor=0.40,
    )
    result = instance.search_multi("FSHD 麻醉要注意什么？", ["FSHD 麻醉"])

    tiers = [c["authority_tier"] for c in result["chunks"]]
    assert tiers == ["guideline", "community"]


def test_authority_does_not_overturn_a_clear_relevance_win(kb):
    """0.03 is a nudge, not an override.

    For「确诊后心理上怎么调整」lived experience IS the right source. A
    penalty large enough to demote a clearly-closer anecdote would make
    the KB worse at the questions patients most need it for.
    """
    instance = _kb_with(
        kb,
        [
            _hit(kb, distance=0.26, source_file="11.病友经验/第二批：2025年5月15日/x.pdf"),
            _hit(kb, distance=0.34, source_file="指南共识/Dutch-FSHD-Guideline.pdf"),
        ],
        relevance_floor=0.40,
    )
    result = instance.search_multi("确诊后心理上怎么调整？", ["确诊 心理"])

    tiers = [c["authority_tier"] for c in result["chunks"]]
    assert tiers == ["community", "guideline"]


def test_chunks_carry_the_authority_label_for_citations(kb):
    instance = _kb_with(
        kb,
        [_hit(kb, distance=0.30, source_file="指南共识/Dutch-FSHD-Guideline.pdf")],
        relevance_floor=0.40,
    )
    result = instance.search_multi("FSHD 指南怎么说？", ["FSHD 指南"])

    assert result["chunks"][0]["authority_label"] == "指南/共识"
    # The ranking penalty is an internal detail and must not leak into
    # the payload the api forwards.
    assert "_authority_penalty" not in result["chunks"][0]


def test_stored_tier_on_a_hit_wins_over_its_path(kb):
    """Backfilled rows are believed, so a librarian can override a path."""
    instance = _kb_with(
        kb,
        [
            _hit(
                kb,
                distance=0.30,
                source_file="指南共识/x.pdf",
                metadata={"authority_tier": "community"},
            )
        ],
        relevance_floor=0.40,
    )
    result = instance.search_multi("FSHD？", ["FSHD"])

    assert result["chunks"][0]["authority_tier"] == "community"
    assert result["chunks"][0]["authority_label"] == "病友经验"


# ----------------------------------------------------------- ingest backfill


def test_ingest_stamps_the_same_authority_as_retrieval_resolves(ingest_mod, kb):
    """One derivation, shared. If these two ever diverge, a backfilled
    corpus and a freshly-ingested one would rank differently."""
    assert ingest_mod.authority_for_path is kb.authority_for_path


class _CapturingBackend:
    """Minimal VectorBackend stand-in that records what was upserted."""

    id = "fake"

    def __init__(self) -> None:
        self.upserted: List[Any] = []

    def list_source_fingerprints(self, source_files):
        return {}

    def reusable_embeddings(self, fingerprints, embed_model):
        # This stand-in stores no vectors, so nothing is reusable and
        # every chunk is embedded — which is what these tests assert
        # about. Present rather than inherited because the fake is
        # duck-typed: `ingest` calls the method directly, deliberately,
        # so that renaming it breaks loudly instead of silently turning
        # the optimisation off while every test still passes.
        return {}

    def upsert(self, chunks):
        self.upserted.extend(chunks)

    def delete_by_source_other_fingerprints(self, source_file, keep_fingerprint):
        return 0


class _OnesEmbedder:
    model_name = "fake"

    def embed_texts(self, texts):
        return [[1.0] for _ in texts]


def test_ingest_stores_authority_on_every_chunk(ingest_mod, tmp_path):
    """The stored half of the tiering, exercised through ingest() itself.

    Asserting on `authority_for_path` alone would pass even if the
    ingester never wrote the keys — which is exactly the shape of bug
    this repo keeps getting bitten by.
    """
    story_dir = tmp_path / "11.病友经验" / "第二批：2025年5月15日"
    story_dir.mkdir(parents=True)
    (story_dir / "我们的故事丨测试.md").write_text(
        "确诊之后我用了很长时间才接受这件事，这一段是为测试写的正文，长度足够通过分块器。",
        encoding="utf-8",
    )
    guideline_dir = tmp_path / "指南共识"
    guideline_dir.mkdir()
    (guideline_dir / "Dutch-FSHD-Guideline.md").write_text(
        "本指南建议在确诊后建立基线的肺功能与心脏评估记录，并按建议的间隔定期复查。",
        encoding="utf-8",
    )

    backend = _CapturingBackend()
    ingest_mod.ingest(
        content_root=tmp_path, backend=backend, embedder=_OnesEmbedder()
    )

    stored = {
        chunk.source_file: (
            chunk.metadata["authority_tier"],
            chunk.metadata["authority_label"],
        )
        for chunk in backend.upserted
    }
    assert stored["11.病友经验/第二批：2025年5月15日/我们的故事丨测试.md"] == (
        "community",
        "病友经验",
    )
    assert stored["指南共识/Dutch-FSHD-Guideline.md"] == ("guideline", "指南/共识")


def test_scoped_source_still_derives_the_corpus_tier(ingest_mod, kb):
    """`--source .../11.病友经验` must not re-badge stories as 文献.

    Without the authority root the source_key is a bare filename, which
    reads as a corpus-root paper — so a routine "just re-ingest this one
    folder" would relabel every patient story 「文献」 to the reader.
    """
    corpus_root = Path("/repo/content/medical-kb/source/FSHD_知识库")
    scoped = corpus_root / "11.病友经验" / "第二批：2025年5月15日"
    story = scoped / "我们的故事丨被小火慢炖的人生.pdf"

    scoped_only = ingest_mod.authority_key_for(story, scoped, None)
    assert kb.authority_tier_for_path(scoped_only) == "literature"  # the bug

    pinned = ingest_mod.authority_key_for(story, scoped, corpus_root)
    assert kb.authority_tier_for_path(pinned) == "community"


def test_authority_key_falls_back_when_outside_the_corpus_root(ingest_mod):
    """An operator ingesting from somewhere else entirely still works."""
    elsewhere = Path("/tmp/adhoc")
    key = ingest_mod.authority_key_for(
        elsewhere / "notes.md", elsewhere, Path("/repo/content/medical-kb/source")
    )
    assert key == "notes.md"


def test_backfill_refuses_a_backend_without_a_sql_pool(ingest_mod):
    """Chroma Cloud has no pool; failing loudly beats reporting 0 rows
    updated and letting an operator believe the backfill ran."""

    class _NoPool:
        id = "chroma_cloud"

    with pytest.raises(SystemExit):
        ingest_mod.backfill_authority(backend=_NoPool(), dry_run=True)


def test_backfill_refuses_an_unsafe_table_name(ingest_mod):
    """The UPDATE has to interpolate the table name into SQL."""

    class _Evil:
        id = "pgvector"
        pool = object()
        table_name = "kb_chunks; DROP TABLE users--"

    with pytest.raises(SystemExit):
        ingest_mod.backfill_authority(backend=_Evil(), dry_run=True)


class TestBackfillNeverOverwritesIngest:
    """The backfill fills gaps; ingest owns the value.

    A row written by a scoped run (`--source .../11.病友经验`) carries a
    bare filename in `source_file`. `backfill_authority` cannot recover
    the corpus-root path from that, so deriving from it yields
    `literature` — and an overwriting backfill would re-badge patient
    stories as 「文献」, which is exactly the footgun `authority_key_for`
    exists to prevent on the ingest side.

    So the WHERE clause must select on ABSENCE, never on difference.
    """

    def _sql(self) -> str:
        import pathlib

        return pathlib.Path(
            __file__
        ).resolve().parents[1].joinpath("kb-ingest.py").read_text(encoding="utf-8")

    def test_backfill_selects_missing_not_different(self):
        src = self._sql()
        start = src.index("def backfill_authority")
        end = src.index("\ndef ", start + 1)
        body = src[start:end]
        assert "IS DISTINCT FROM" not in body, (
            "backfill must not select rows whose stored tier merely DIFFERS — "
            "that overwrites the correct tier ingest stored for scoped runs"
        )
        assert body.count("metadata ->> 'authority_tier' IS NULL") == 2, (
            "both the dry-run count and the UPDATE must select on absence"
        )

    def test_backfill_derivation_is_documented_as_gap_fill_only(self):
        body = self._sql()
        start = body.index("def backfill_authority")
        doc = body[start : body.index('"""', body.index('"""', start) + 3)]
        assert "fill-only" in doc or "fills gaps" in doc
