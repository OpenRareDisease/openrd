"""FSHD knowledge base orchestration.

This module is backend-agnostic: it relies on `kb_backends` for storage
and `embed_models` for embeddings. Pick a backend with the KB_BACKEND
env and an embedder with KB_EMBED_MODEL. See
docs/proposals/local-rag-migration.md.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import sys
from typing import Any, Dict, List, Optional

from kb_backends import VectorBackend, create_backend
from kb_backends.base import QueryHit
from embed_models import Embedder, create_embedder

# -----------------------------
# Logging: only to stderr (avoid breaking JSON stdout)
# -----------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger("fshd_kb")

# -----------------------------
# Junk filters (tune as needed)
# -----------------------------
# 去掉入库时加在每一块前面的 [label] 行
# （scripts/kb-ingest.py: tagged = f"[{section.label}]\n{raw.content}"）。
#
# 10241 块语料里有 7524 块带着它（2026-08-11 实测，见下面 AUTHORITY_TIERS
# 那段记的 SQL）。那是流水线自己的标注 —— 多数是 [page 92]，有时是来源
# 页标题 —— 下游任何过滤都不该拿它当正文判。下面每一条过滤原本都在读
# 它，于是一个不走运的 section label 就能把整份文档从语料里抹掉：
#《中国康复辅助器具目录（2023年版）》修订说明.docx 一共 2 块，两块都因为
# 标题里的「目录」被判掉，整份清零；ClinicalTrials 列表页因为每块前缀里
# 的抓取横幅丢掉全部 40 块 —— 连带里面真实的 NCT 编号、申办方和招募状态。
#
# 注意被清零的是那份 2 块的修订说明，不是同名的 110 页目录正本
#（08.无障碍生活/…/A.中国康复辅助器具目录（2023年版）.docx，534 块）。
# 正本当时根本不在索引里 —— 它是一份披着 .docx 的老式 .doc，解析器直接
# 跳过，4d27900 才修好；旧过滤对它 534 块里也只命中 2 块。两件事看起来
# 都是「目录不见了」，成因完全无关，别混成一条。
#
# 判之前先剥一次。一个能凭标注把整份文档删掉的过滤器不是过滤器，
# 是一个瞄不准的删除键。
INGEST_LABEL_RE = re.compile(r"^\s*\[[^\]\n]{0,120}\]\s*\n?")


def _strip_ingest_label(text: str) -> str:
    return INGEST_LABEL_RE.sub("", text or "")


# 微信公众号版式家具 —— 文章周围的导航和署名，不是文章本身。
#
# 按密度判，不按出现判。旧版本对整段正文做子串匹配，代价是实测在
# 10241 块语料上静默删掉 75 块、波及 40 个文件，其中三个文件被整份清零
#（2026-08-11 重测；同一次重放在 2026-08-07 之前那 7800 块的快照上是
# 73 块 / 39 个文件 / 同样三份清零，也就是这段话原本写的数）：
#
#   FSHD康复医师网络.docx              给医生的转诊名单
#   FSHD青年路社区简介.docx             这个社区是谁
#   《中国康复辅助器具目录（2023年版）》修订说明.docx
#
# 并且从患友自传《不管如何，你得长大》连载1-4 每一集里拿走 4/6 到 4/8。
#
# 其中三条根本不是版式家具 —— 连载、社区简介、康复医师网络 是有人特意
# 策展进来的文档标题。它们已从列表移除：过滤器不该有能力按名字把一份
# 文档从语料里删掉。
#
# 留下的是真家具，而且只在它占多数时才生效：这些标记单独成短行，一段
# 几乎全是它们的是导航块，一句话里提到一次的是正文。
FURNITURE_RE = re.compile(
    r"^\s*(目录|上一篇|下一篇|排版|撰文|责任编辑|点击阅读|更多内容|阅读原文|扫码关注)\s*[:：]?\s*.{0,24}$"
)
# 抓取下来的 ClinicalTrials.gov 结果页 —— 永远是列表外壳不是正文，
# 这两条用出现判是对的。
SCRAPE_RE = re.compile(r"List Results \| ClinicalTrials|Search for:.*Recruiting studies")
FURNITURE_RATIO = 0.5


def _is_navigation_boilerplate(text: str) -> bool:
    if SCRAPE_RE.search(text or ""):
        return True
    lines = [ln for ln in (text or "").splitlines() if ln.strip()]
    if not lines:
        return True
    furniture = sum(1 for ln in lines if FURNITURE_RE.match(ln))
    return furniture / len(lines) > FURNITURE_RATIO


def _norm_text(t: str) -> str:
    t = (t or "").strip()
    t = re.sub(r"\s+", " ", t)
    return t


def _fingerprint(text: str) -> str:
    # sha256 truncated to 32 hex chars matches the format used by
    # scripts/kb-ingest.py so chunk-level fingerprints stay consistent
    # whether they come from the orchestrator's runtime dedup or from
    # an ingest pipeline.
    return hashlib.sha256(_norm_text(text).encode("utf-8")).hexdigest()[:32]


def _is_junk(raw: str) -> bool:
    """判一块原文是不是垃圾。传原文，不要传折叠过空白的文本。

    长度按折叠空白后算 —— 一块「两行标题 + 一堆缩进」不该靠空白撑过 30 字。
    版式判断则必须拿到原文：_is_navigation_boilerplate 数的是「几行里有几行
    是版式家具」，折叠之后整块只剩一行，那个比值永远是 0/1，过滤器一次也
    不会响。
    """
    # 先剥掉入库标注再判 —— 见 _strip_ingest_label 的说明。
    text = _strip_ingest_label(raw)
    if not text or len(_norm_text(text)) < 30:
        return True
    return bool(_is_navigation_boilerplate(text))


def _safe_int(x: Any, default: int) -> int:
    try:
        return int(x)
    except Exception:
        return default


# Search defaults. Centralised here so callers (CLI, KB service, future
# orchestrator) all see the same fallback if KB_* env vars are unset.
DEFAULT_FINAL_N = int(os.getenv("KB_FINAL_N", "8"))
DEFAULT_FETCH_K = int(os.getenv("KB_FETCH_K", "80"))
DEFAULT_MAX_PER_SOURCE = int(os.getenv("KB_MAX_PER_SOURCE", "4"))


# ----------------------------------------------------------- relevance floor

#: Cosine-distance ceiling above which a hit is treated as「语料里没有」
#: rather than「这是最接近的」.
#:
#: There was no floor at all. A nearest-neighbour search over the whole
#: corpus ALWAYS returns something, so 「明天北京天气怎么样」came back
#: with the Dutch FSHD genetic-diagnostics guideline and 「杜氏肌营养不良
#: DMD 的激素治疗方案」came back with an FSHD history paper — and the
#: answer layer, which could not tell those apart from a real hit, wrote
#: an answer out of them. For a patient population where a majority
#: arrive misdiagnosed and asking about adjacent neuromuscular diseases,
#: that is the worst possible failure mode.
#:
#: MEASURED, not guessed. `DATABASE_URL=… python3 scripts/kb-verify.py
#: --floor-probe` reproduces the table below: 15 in-corpus probes (the
#: kb-verify probe set plus five covering anaesthesia / pregnancy / AFO /
#: prognosis / coping) and 23 out-of-corpus probes (DMD, ALS, 重症肌无力,
#: SMA ×2, vaccines, 中药, 针灸, 「某某医院能不能做基因检测」, weather,
#: recipes, crypto, ...). Re-run 2026-08-11 against the live corpus
#: (10,241 chunks / 211 files, bge-m3):
#:
#:            best-hit cosine distance      min      p50      max
#:   in-corpus  (15 probes)               0.2119   0.2944   0.3782
#:   out-of-corpus (23 probes)            0.3123   0.4653   0.6261
#:
#: THE TWO DISTRIBUTIONS NOW OVERLAP, and the script says so ("NO
#: separating band"). 21 of the 23 out-of-corpus probes still sit at
#: 0.4054 and above, so the band this number was originally picked out of
#: — [0.3782, 0.4054], ~0.027 wide — is intact for everything the old
#: probe set covered. The two that break it are the Chinese SMA probes,
#: 0.3123 and 0.3557, both landing on 文献/面-肩-肱型肌营养不良症研究进展
#: 史.pdf: a Chinese paper about FSHD answers a Chinese question about SMA
#: at 0.31 because 肌萎缩/肌营养不良 is the vocabulary of the whole disease
#: family. That paper was indexed 2026-05-28, so this is not new drift —
#: it is a hole the old probe set never looked into. See the retired probe
#: note in scripts/kb-verify.py.
#:
#: No floor closes that hole. Shutting the SMA probes out needs a floor
#: below 0.3123, and 5 of the 15 in-corpus probes have a best hit at or
#: above that — they would come back with nothing at all. So 0.40 stays,
#: on what it does buy:
#:
#:   - at 0.40, 21 of 23 out-of-corpus probes lose their entire candidate
#:     set (6 chunks survive in total, 3 under each SMA probe), and no
#:     in-corpus probe is emptied — 14 of the 15 keep 8+ chunks, and
#:    「D4Z4 重复减少是什么意思」keeps exactly 1 (its 3rd hit is 0.4039).
#:   - dropping to 0.38 halves the out-of-corpus survivors (6 chunks -> 3)
#:     without freeing a single probe (still 21 of 23 emptied) and costs
#:     84 in-corpus chunks; 0.36 costs another 77 and starts emptying an
#:     in-corpus probe (1 of 15).
#:   - 0.42 is worse on the side that matters: only 17 of 23 out-of-corpus
#:     probes lose everything, the DMD steroid-regimen probe keeps 5 chunks
#:     of FSHD literature and the 针灸 probe keeps 5 — exactly enough for
#:     the model to write a confident answer to a question this corpus
#:     cannot answer.
#:
#: Err LOW on purpose. Too low costs a real question some of its chunks
#: and, at worst, an honest 「知识库里没找到」. Too high hands the model
#: FSHD literature to answer a DMD question with. Those are not symmetric.
#:
#: And do not read this number as a guarantee about adjacent neuromuscular
#: disease — the SMA probes are the standing proof that it is not one.
#: That is the answer layer's job, not the floor's.
#:
#: Re-measure when the embedding model or the corpus changes materially
#: — the number is a property of both, not a universal constant. Paste the
#: run in here, including whatever the script says about the band; a table
#: that no longer reproduces is worse than no table.
DEFAULT_RELEVANCE_FLOOR = 0.40

#: Values of KB_RELEVANCE_FLOOR that turn the floor off entirely.
_FLOOR_DISABLED_VALUES = frozenset({"off", "none", "disabled", "false", "0"})


def _resolve_relevance_floor(raw: Optional[str]) -> Optional[float]:
    """Parse KB_RELEVANCE_FLOOR. `None` means the floor is disabled.

    Unset falls back to the measured default. An explicit `off` (or a
    non-positive number) disables it, which is the escape hatch for an
    operator running a corpus this number was never measured against.
    """
    s = (raw or "").strip().lower()
    if not s:
        return DEFAULT_RELEVANCE_FLOOR
    if s in _FLOOR_DISABLED_VALUES:
        return None
    try:
        value = float(s)
    except ValueError:
        logger.warning(
            "invalid KB_RELEVANCE_FLOOR=%r, falling back to %s",
            raw,
            DEFAULT_RELEVANCE_FLOOR,
        )
        return DEFAULT_RELEVANCE_FLOOR
    return value if value > 0 else None


DEFAULT_RELEVANCE_FLOOR_RESOLVED = _resolve_relevance_floor(os.getenv("KB_RELEVANCE_FLOOR"))

#: Sentinel so `search_multi(relevance_floor=None)` can mean "floor off"
#: and an omitted argument can mean "use the configured default".
_FLOOR_UNSET = object()


# ---------------------------------------------------------- authority tiers

# The corpus directory structure already encodes how much weight a chunk
# deserves, and nothing read it: an AAN / Dutch-guideline chunk and a
# 病友 forum post were retrieved with exactly equal weight, ranked only
# by cosine distance. A patient asking about anaesthesia could get an
# anecdote above the AANA obstetric-anaesthesia paper.
#
# The tier is derived from the corpus-relative source path (the same
# `source_key` the ingester stores in `kb_chunks.source_file`, e.g.
# "11.病友经验/第二批：2025年5月15日/我们的故事丨....pdf"). Measured over
# the live corpus (10,241 chunks / 211 files, 2026-08-11) with
#
#   select coalesce(nullif(metadata->>'category',''),'<root>'), count(*)
#     from kb_chunks group by 1 order by 2 desc;
#
#   指南共识/                                             51 chunks
#   文献/                                              5,009
#   (corpus root — papers, preprints, abstract books)   1,746
#   AFO/                                                 550
#   05.相关研究/                                          401
#   11.病友经验/ (including the 连载 subdirectory)          150
#   everything else (01/02/03/04/06/07/08/09/10/12/孕期) 2,334
#
# Every one of these moved when this branch re-chunked the corpus, and
# they will move again on the next ingest.
# scripts/kb_parsers/test_kb_corpus_census.py runs the query above and
# compares it against this block row by row, and it fails on a REWORD as
# loudly as on a drifted count — softening a row into prose is not a way
# out of re-measuring it. The comparison needs a corpus, so it only runs
# where DATABASE_URL reaches an ingested database; after an ingest, run
# it with KB_CENSUS_REQUIRED=1 so a mistyped DSN cannot report a skip as
# a pass. Every chunk and file count in this block goes through that
# comparison — the seven category rows, the header's totals, the
# _FOLDER_TIERS note, and the corpus size the penalty-sizing paragraph
# below restates in its own shape — and a count added later without an
# extractor fails the test rather than sitting here unread. The COSINE
# figures in the penalty paragraph are a different kind of number and
# are checked by nothing: reproducing them means re-running those two
# queries by hand.
#
# The measurement DATE is the one thing no query can check — nothing in
# kb_chunks records when a comment was written. This block states it
# THREE times: here, in the penalty-sizing paragraph below, and in the
# _FOLDER_TIERS note under that. The test holds the three to each
# other, so re-stamping one without the others goes red; re-stamping
# all three together is a hand edit nothing can verify. Do all three in
# the same pass, and do not trust a green run to mean the date is
# right — only that the block agrees with itself.
#
# `penalty` is added to the cosine distance for RANKING ONLY — never for
# the relevance floor, which must keep judging raw distance or the tier
# would quietly move the floor around. The whole spread is 0.03 against
# an in-corpus top-8 distance band of roughly 0.21-0.41, i.e. small
# enough to break near-ties and too small to overturn a clear relevance
# win. Two measured checks fixed that size (both re-run 2026-08-11 against
# the 10,241-chunk corpus and unchanged to four decimals):
#
#   「FSHD 麻醉 恶性高热 风险」— AANA paper (literature) 0.3323 -> 0.3423
#     vs the MDA patient-experience piece (reference) 0.3912 -> 0.4112.
#     The paper's lead widens. This is the case the tiering exists for.
#
#   「确诊 FSHD 后心理上怎么调整？」— top 病友经验 chunk 0.3023 -> 0.3323,
#     still ahead of the nearest guideline-tier chunk, which the penalty
#     does not move: 0.3642 (孕期/FSHD女性的怀孕指南, promoted by the
#     filename rule below) and 0.3695 for 指南共识/ itself. For a question
#     about coping, lived experience IS the right source; a larger penalty
#     would have demoted it wrongly. 0.03 is the largest spread that
#     leaves this ordering intact.

#: Tier key -> ranking rank, patient-facing label, ranking penalty.
#: `unknown` deliberately mirrors `reference`: a path we cannot classify
#: must not be promoted above the literature and must not be labelled as
#: something it may not be.
AUTHORITY_TIERS: Dict[str, Dict[str, Any]] = {
    "guideline": {"rank": 0, "label": "指南/共识", "penalty": 0.00},
    "literature": {"rank": 1, "label": "文献", "penalty": 0.01},
    "reference": {"rank": 2, "label": "资料", "penalty": 0.02},
    "community": {"rank": 3, "label": "病友经验", "penalty": 0.03},
    "unknown": {"rank": 2, "label": "资料", "penalty": 0.02},
}

#: Top-level corpus folder -> tier. Anything not listed falls to
#: `reference`; a file sitting directly at the corpus root falls to
#: `literature` because every root file today is a paper, preprint or
#: conference abstract book (measured 2026-08-11: 29 files, 1,746 chunks).
_FOLDER_TIERS: Dict[str, str] = {
    "指南共识": "guideline",
    "文献": "literature",
    "05.相关研究": "literature",
    # Orthotics research papers, not a product catalogue.
    "AFO": "literature",
    "11.病友经验": "community",
}
_ROOT_TIER = "literature"
_DEFAULT_TIER = "reference"

#: The librarian filed the actual practice guidelines by topic, not into
#: 指南共识/ — that folder holds a single document while the Dutch
#: guideline, the AAN evidence-based summary, the 2024 molecular
#: diagnostics best-practice paper and the 中华医学会 consensus all live
#: under 01./02./03. Folder alone would therefore tier 51 of 10,241 chunks
#: as guidance and miss every guideline a patient actually asks about.
#:
#: Matching the filename recovers them. Measured 2026-08-11 over the 211
#: source files IN THE INDEX (`select distinct source_file from kb_chunks`
#: — not the 235 files on disk, which is a different population and where
#: the rule hits 14; the extra two never parsed) this hits exactly 12, and
#: 11 are unambiguous clinical practice guidelines or expert consensus
#: statements. The 12th,《FSHD女性的怀孕指南》, is a community-written
#: patient guide that the rule over-promotes — accepted knowingly because
#: the consequence is a 0.02 ranking nudge and a label the document
#: applies to itself, not a claim about evidence grade. Renaming that one
#: file is the real fix.
#:
#: The promotion never applies to the community tier, so a future patient
#: story titled「求医指南」cannot be labelled as guidance.
_GUIDELINE_FILENAME_RE = re.compile(
    r"指南|共识|guideline|consensus|best practice", re.IGNORECASE
)


def authority_tier_for_path(source_key: Optional[str]) -> str:
    """Tier key for a corpus-relative source path."""
    key = (source_key or "").replace("\\", "/").strip("/")
    parts = [p for p in key.split("/") if p]
    if not parts:
        return "unknown"

    tier = _ROOT_TIER if len(parts) == 1 else _FOLDER_TIERS.get(parts[0], _DEFAULT_TIER)
    if tier != "community" and _GUIDELINE_FILENAME_RE.search(parts[-1]):
        tier = "guideline"
    return tier


def authority_for_path(source_key: Optional[str]) -> Dict[str, Any]:
    """`{'tier', 'label', 'rank', 'penalty'}` for a source path.

    Shared by the ingester (which stores tier + label on every chunk)
    and by retrieval (which falls back to it, see `resolve_authority`),
    so the two can never disagree about what a path means.
    """
    tier = authority_tier_for_path(source_key)
    meta = AUTHORITY_TIERS[tier]
    return {
        "tier": tier,
        "label": meta["label"],
        "rank": meta["rank"],
        "penalty": meta["penalty"],
    }


def resolve_authority(
    metadata: Optional[Dict[str, Any]], source_key: Optional[str]
) -> Dict[str, Any]:
    """Authority for a retrieved hit: stored value first, path second.

    The path fallback is what makes the ranking preference work on rows
    that predate the backfill. On the dev corpus that is now none of them
    — 0 of 10,241 rows are missing `authority_tier` as of 2026-08-11,
    because the backfill has been run here — which is exactly why the
    fallback has to stay: any deployment seeded from an older dump is
    still on the other side of it. Without it this feature would
    do nothing at all until an operator remembered to run
    `scripts/kb-ingest.py --backfill-authority`, and「a patient asking
    about anaesthesia gets an anecdote」would still be live in
    production. The backfill is what makes the tier queryable in SQL and
    removes the per-hit derivation; it is not what makes ranking correct.
    """
    stored = (metadata or {}).get("authority_tier")
    if isinstance(stored, str) and stored in AUTHORITY_TIERS:
        meta = AUTHORITY_TIERS[stored]
        return {
            "tier": stored,
            "label": meta["label"],
            "rank": meta["rank"],
            "penalty": meta["penalty"],
        }
    return authority_for_path(source_key)


def _get_source(metadata: Optional[Dict[str, Any]], fallback: Optional[str] = None) -> str:
    md = metadata or {}
    source = (
        md.get("source_file")
        or md.get("source")
        or md.get("file")
        or md.get("path")
        or md.get("folder_path")
        or fallback
        or "unknown"
    )
    return str(source)


class FSHDKnowledgeBase:
    """Backend-agnostic FSHD knowledge base orchestrator."""

    def __init__(
        self,
        backend: Optional[VectorBackend] = None,
        embedder: Optional[Embedder] = None,
        relevance_floor: Any = _FLOOR_UNSET,
    ) -> None:
        self.backend = backend or create_backend()
        self.embedder = embedder or create_embedder()
        self.relevance_floor: Optional[float] = (
            DEFAULT_RELEVANCE_FLOOR_RESOLVED
            if relevance_floor is _FLOOR_UNSET
            else relevance_floor
        )
        logger.info(
            "KB ready: backend=%s embedder=%s dim=%s relevance_floor=%s",
            self.backend.id,
            self.embedder.model_name,
            self.embedder.dimension,
            "off" if self.relevance_floor is None else self.relevance_floor,
        )

    # --------------------------------------------------------------- search

    def search_multi(
        self,
        question: str,
        queries: List[str],
        final_n: int = 8,
        fetch_k: int = 80,
        max_per_source: int = 4,
        where: Optional[Dict[str, Any]] = None,
        keep_debug_fields: bool = False,
        relevance_floor: Any = _FLOOR_UNSET,
    ) -> Dict[str, Any]:
        question = (question or "").strip()
        queries = [q.strip() for q in (queries or []) if q and q.strip()]
        floor: Optional[float] = (
            self.relevance_floor if relevance_floor is _FLOOR_UNSET else relevance_floor
        )

        if not question:
            return {
                "answer": "请输入问题。",
                "chunks": [],
                "metadata": {"total_results": 0, "search_query": question},
            }

        # Fall back to the original question when no rewritten queries
        # are provided.
        if not queries:
            queries = [question]

        # PHI hygiene: queries routinely contain free-form patient
        # context ("我 38 岁女性 ...家族史 ..."). Logging the full strings
        # at INFO promotes PHI into whatever centralised log sink the
        # container stack ships stderr to. Log a stable hash + length
        # instead so an operator can correlate without storing PHI.
        # Full queries are still accessible at DEBUG when explicitly
        # enabled.
        import hashlib as _hashlib
        query_fingerprints = [
            _hashlib.sha256((q or '').encode('utf-8')).hexdigest()[:8] for q in queries
        ]
        logger.info(
            "Multi queries (%d, fingerprints=%s, total_chars=%d) | fetch_k=%d final_n=%d max_per_source=%d where_keys=%s",
            len(queries),
            query_fingerprints,
            sum(len(q or '') for q in queries),
            fetch_k,
            final_n,
            max_per_source,
            sorted((where or {}).keys()) if where else [],
        )
        logger.debug(
            "Multi queries (full): %s | where=%s",
            queries,
            where,
        )

        # 1) Embed all queries in a single call (faster + cache-friendly).
        q_embs = self.embedder.embed_texts(queries)

        # 2) Backend-specific recall.
        per_query_hits: List[List[QueryHit]] = self.backend.query_multi(
            query_embeddings=q_embs,
            fetch_k=fetch_k,
            where=where,
        )

        # 3) Merge, dedup, junk-filter.
        #
        # `backend_hits` counts what the vector store actually returned,
        # before dedup and before the junk filters. It is the only thing
        # that can tell「the corpus is empty」apart from「everything that
        # came back was a bibliography page」, and those two need
        # different answers: the first is an outage the operator must
        # see, the second is a genuine (if unhelpful) search result.
        # A nearest-neighbour search over a non-empty table always
        # returns rows, so zero here means zero rows to search — an
        # empty corpus, or a `where` filter that matched nothing.
        backend_hits = sum(len(hits) for hits in per_query_hits)
        merged: List[Dict[str, Any]] = []
        seen_fp: set[str] = set()
        for qi, (q, hits) in enumerate(zip(queries, per_query_hits)):
            for hit in hits:
                # 判 junk 用原文，折叠只用于指纹和下游 payload。
                # 反过来写过一版：先 _norm_text 再判，于是按行密度判的
                # 版式过滤器从来没生效过 —— 折叠后整块只剩一行，比值恒为
                # 0/1。后果是微信文章的导航与署名块带着引用角标进了患者
                # 看到的答案里，而且比 master 上那版子串匹配更差。
                if _is_junk(hit.content):
                    continue
                text_norm = _norm_text(hit.content)
                fp = hit.fingerprint or _fingerprint(text_norm)
                if fp in seen_fp:
                    continue
                seen_fp.add(fp)
                authority = resolve_authority(hit.metadata, hit.source_file)
                merged.append(
                    {
                        "content": text_norm,
                        "metadata": hit.metadata or {},
                        "distance": hit.distance,
                        "authority_tier": authority["tier"],
                        "authority_label": authority["label"],
                        "_authority_penalty": authority["penalty"],
                        "_source_file": hit.source_file,
                        "_hit_query": q,
                        "_hit_query_i": qi,
                    }
                )

        # 3b) Relevance floor, applied to the RAW distance before any
        # authority adjustment. A nearest-neighbour search cannot return
        # nothing, so without this every question the corpus has no
        # answer for still handed the model its 8 closest chunks. See
        # DEFAULT_RELEVANCE_FLOOR for the measured numbers.
        #
        # A hit with no distance is kept rather than dropped: `None`
        # means the backend did not report one (the interface allows it),
        # which is "cannot judge", not "far away". Dropping those would
        # silently empty every result on such a backend.
        candidates_considered = len(merged)
        distances = [
            float(item["distance"]) for item in merged if item.get("distance") is not None
        ]
        best_distance = min(distances) if distances else None

        dropped_below_floor = 0
        if floor is not None:
            above_floor: List[Dict[str, Any]] = []
            for item in merged:
                d = item.get("distance")
                if d is not None and float(d) > floor:
                    dropped_below_floor += 1
                    continue
                above_floor.append(item)
            merged = above_floor

        # True only when there WERE candidates and the floor took every
        # one of them — i.e. the corpus was consulted and genuinely has
        # nothing relevant. That is a different fact from "the search
        # could not run", and the answer layer has to be able to tell
        # them apart or it will either improvise or claim an outage.
        below_relevance_floor = candidates_considered > 0 and not merged

        # 4) Rank by distance (closer first; missing distances sink),
        # nudged by source authority so a guideline outranks a forum post
        # at comparable relevance.
        def _rank_key(item: Dict[str, Any]) -> float:
            d = item.get("distance")
            if d is None:
                return 1e9
            return float(d) + float(item.get("_authority_penalty") or 0.0)

        merged.sort(key=_rank_key)

        # 5) Per-source diversification.
        chosen: List[Dict[str, Any]] = []
        per_source: Dict[str, int] = {}
        for item in merged:
            src = _get_source(item.get("metadata"), fallback=item.get("_source_file"))
            if per_source.get(src, 0) >= max_per_source:
                continue
            chosen.append(item)
            per_source[src] = per_source.get(src, 0) + 1
            if len(chosen) >= final_n:
                break

        # 6) Preview answer (Node side will produce the real LLM answer).
        answer = self._generate_answer_preview(question, chosen)

        # 7) Strip debug fields unless requested.
        for c in chosen:
            c.pop("_source_file", None)
            c.pop("_authority_penalty", None)
            if not keep_debug_fields:
                c.pop("_hit_query", None)
                c.pop("_hit_query_i", None)

        return {
            "answer": answer,
            "chunks": chosen,
            "metadata": {
                "total_results": len(chosen),
                "search_query": question,
                "queries_used": queries,
                "fetch_k": fetch_k,
                "final_n": final_n,
                "max_per_source": max_per_source,
                "where": where or None,
                "backend": self.backend.id,
                "embed_model": self.embedder.model_name,
                # Retrieval-quality signals. `below_relevance_floor` is
                # the one a caller must branch on: chunks==[] with it
                # true means「知识库里没有」, chunks==[] with it false
                # means the search returned nothing for some other
                # reason and says nothing about the corpus.
                "relevance_floor": floor,
                "below_relevance_floor": below_relevance_floor,
                "dropped_below_floor": dropped_below_floor,
                "backend_hits": backend_hits,
                "candidates_considered": candidates_considered,
                "best_distance": best_distance,
            },
        }

    def _generate_answer_preview(self, question: str, chunks: List[Dict[str, Any]]) -> str:
        if not chunks:
            return (
                "抱歉，在知识库中没有找到直接相关的信息。\n"
                "建议你换一种问法（更具体一点），比如：\n"
                "• 你想问的是“遗传方式/症状/治疗/康复/检查/生活注意事项”的哪一类？\n"
                "• 症状持续多久、部位、严重程度、是否影响日常活动？\n"
                "（这不是医疗诊断，请咨询专业医生。）"
            )

        parts = [f"根据知识库检索，关于“{question}”可能相关的资料片段：\n"]
        for idx, ch in enumerate(chunks[:5], 1):
            text = ch.get("content") or ""
            preview = (text[:220] + "...") if len(text) > 220 else text
            parts.append(f"{idx}. {preview}")

        parts.extend(
            [
                "\n---",
                "提示：上面只是检索到的资料片段预览；最终解读仍需结合医生建议。",
                "（这不是医疗诊断，请咨询专业医生。）",
            ]
        )
        return "\n".join(parts)


# ----------------------------------------------------------------------- legacy alias

#: Kept so any older import sites continue to work; new code should use
#: FSHDKnowledgeBase directly.
FSHDKnowledgeBaseCloud = FSHDKnowledgeBase


# ----------------------------------------------------------------------- CLI

def _parse_multi_payload(arg: str) -> Dict[str, Any]:
    """Accept either an inline JSON string or `@path/to/file.json`."""
    s = (arg or "").strip()
    if not s:
        return {}

    if s.startswith("@"):
        p = s[1:].strip()
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)

    return json.loads(s)


def main() -> None:
    # Usage:
    #   python knowledge.py "你的问题"
    #   python knowledge.py --multi '{"question":"...","queries":[...],"top_k":8}'
    if len(sys.argv) < 2:
        out = {
            "answer": (
                "Usage: python knowledge.py \"your question\"  OR  "
                "python knowledge.py --multi '{\"question\":\"...\",\"queries\":[...]}'"
            ),
            "chunks": [],
            "metadata": {"error": "missing args"},
        }
        sys.stdout.buffer.write((json.dumps(out, ensure_ascii=False) + "\n").encode("utf-8"))
        sys.exit(1)

    try:
        kb = FSHDKnowledgeBase()

        if sys.argv[1] == "--multi":
            if len(sys.argv) < 3:
                out = {
                    "answer": (
                        "Usage: python knowledge.py --multi "
                        "'{\"question\":\"...\",\"queries\":[...]}'"
                    ),
                    "chunks": [],
                    "metadata": {"error": "missing multi payload"},
                }
                sys.stdout.buffer.write(
                    (json.dumps(out, ensure_ascii=False) + "\n").encode("utf-8")
                )
                sys.exit(1)

            payload = _parse_multi_payload(sys.argv[2])
            question = str(payload.get("question") or payload.get("q") or "").strip()
            queries_payload = payload.get("queries") or []
            if not isinstance(queries_payload, list):
                queries_payload = []

            top_k = _safe_int(
                payload.get("top_k") or payload.get("final_n"), DEFAULT_FINAL_N
            )
            fetch_k = _safe_int(payload.get("fetch_k"), DEFAULT_FETCH_K)
            max_per_source = _safe_int(payload.get("max_per_source"), DEFAULT_MAX_PER_SOURCE)

            where = payload.get("where")
            if where is not None and not isinstance(where, dict):
                where = None

            keep_debug = bool(payload.get("keep_debug_fields", False))

            result = kb.search_multi(
                question=question,
                queries=[str(x) for x in queries_payload if x is not None],
                final_n=top_k,
                fetch_k=fetch_k,
                max_per_source=max_per_source,
                where=where,
                keep_debug_fields=keep_debug,
            )
        else:
            question = str(sys.argv[1]).strip()
            result = kb.search_multi(
                question=question,
                queries=[question],
                final_n=DEFAULT_FINAL_N,
                fetch_k=DEFAULT_FETCH_K,
                max_per_source=DEFAULT_MAX_PER_SOURCE,
                where=None,
                keep_debug_fields=False,
            )

        sys.stdout.buffer.write((json.dumps(result, ensure_ascii=False) + "\n").encode("utf-8"))
        sys.exit(0)

    except Exception:
        # psycopg / openai / pgvector exception strings can carry DB
        # connection strings (with the password), bearer tokens, and
        # internal file paths. Log the full traceback server-side;
        # the JSON answer / metadata returned to the caller only
        # carries a short correlation id so an operator can grep
        # the logs without leaking the credentials onto the wire.
        import uuid as _uuid
        request_id = _uuid.uuid4().hex[:12]
        logger.exception("knowledge.py failed (request_id=%s)", request_id)
        err = {
            "answer": "知识库服务暂时不可用，请稍后再试。",
            "chunks": [],
            "metadata": {"error": "kb_internal_error", "request_id": request_id},
        }
        sys.stdout.buffer.write((json.dumps(err, ensure_ascii=False) + "\n").encode("utf-8"))
        sys.exit(1)


if __name__ == "__main__":
    main()
