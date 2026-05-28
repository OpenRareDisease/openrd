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
JUNK_PATTERNS = [
    r"目录",
    r"上一篇",
    r"下一篇",
    r"连载",
    r"撰文",
    r"排版",
    r"责任编辑",
    r"点击阅读",
    r"更多内容",
    r"病友故事\s*·\s*目录",
    r"社区简介",
    r"我们在路上",
    r"不是一个人",
    r"康复医师网络",
]
JUNK_RE = re.compile("|".join(JUNK_PATTERNS))


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


def _is_junk(text: str) -> bool:
    if not text or len(text.strip()) < 30:
        return True
    return bool(JUNK_RE.search(text))


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
    ) -> None:
        self.backend = backend or create_backend()
        self.embedder = embedder or create_embedder()
        logger.info(
            "KB ready: backend=%s embedder=%s dim=%s",
            self.backend.id,
            self.embedder.model_name,
            self.embedder.dimension,
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
    ) -> Dict[str, Any]:
        question = (question or "").strip()
        queries = [q.strip() for q in (queries or []) if q and q.strip()]

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
        merged: List[Dict[str, Any]] = []
        seen_fp: set[str] = set()
        for qi, (q, hits) in enumerate(zip(queries, per_query_hits)):
            for hit in hits:
                text_norm = _norm_text(hit.content)
                if _is_junk(text_norm):
                    continue
                fp = hit.fingerprint or _fingerprint(text_norm)
                if fp in seen_fp:
                    continue
                seen_fp.add(fp)
                merged.append(
                    {
                        "content": text_norm,
                        "metadata": hit.metadata or {},
                        "distance": hit.distance,
                        "_source_file": hit.source_file,
                        "_hit_query": q,
                        "_hit_query_i": qi,
                    }
                )

        # 4) Rank by distance (closer first; missing distances sink).
        def _dist_key(item: Dict[str, Any]) -> float:
            d = item.get("distance")
            return float(d) if d is not None else 1e9

        merged.sort(key=_dist_key)

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
