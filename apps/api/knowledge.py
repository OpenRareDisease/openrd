import os
import sys
import json
import logging
import re
import hashlib
from typing import List, Dict, Any, Tuple, Optional

import chromadb
from sentence_transformers import SentenceTransformer

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
    return hashlib.md5(_norm_text(text).encode("utf-8")).hexdigest()


def _is_junk(text: str) -> bool:
    if not text or len(text.strip()) < 30:
        return True
    return bool(JUNK_RE.search(text))


def _safe_int(x: Any, default: int) -> int:
    try:
        return int(x)
    except Exception:
        return default


class FSHDKnowledgeBaseCloud:
    def __init__(self):
        self.api_key = os.getenv("CHROMA_API_KEY", "").strip()
        self.tenant = os.getenv("CHROMA_TENANT_ID", "").strip() or os.getenv("CHROMA_TENANT", "").strip()
        self.database = os.getenv("CHROMA_DATABASE", "FSHD").strip()
        self.collection_name = os.getenv("CHROMA_COLLECTION", "fshd_knowledge_base").strip()

        if not self.api_key:
            raise RuntimeError("Missing env CHROMA_API_KEY")
        if not self.tenant:
            raise RuntimeError("Missing env CHROMA_TENANT_ID")
        if not self.database:
            raise RuntimeError("Missing env CHROMA_DATABASE")
        if not self.collection_name:
            raise RuntimeError("Missing env CHROMA_COLLECTION")

        logger.info("Connecting to Chroma Cloud...")
        self.client = chromadb.CloudClient(
            api_key=self.api_key,
            tenant=self.tenant,
            database=self.database,
        )

        # Local embedding model (do NOT bind to collection)
        logger.info("Loading local embedding model: all-MiniLM-L6-v2")
        self.model = SentenceTransformer("all-MiniLM-L6-v2")

        logger.info(f"Opening collection (NO embedding_function passed): {self.collection_name}")
        self.collection = self.client.get_collection(name=self.collection_name)

        logger.info("Cloud KB initialized OK")

    def _embed_texts(self, texts: List[str]) -> List[List[float]]:
        return self.model.encode(texts).tolist()

    def _query_once(
        self,
        query_text: str,
        fetch_k: int,
        where: Optional[Dict[str, Any]] = None,
    ) -> Tuple[List[str], List[Dict[str, Any]], List[float]]:
        q_emb = self._embed_texts([query_text])[0]

        kwargs: Dict[str, Any] = {
            "query_embeddings": [q_emb],
            "n_results": fetch_k,
            "include": ["documents", "metadatas", "distances"],
        }
        if where:
            kwargs["where"] = where

        results = self.collection.query(**kwargs)

        docs0 = (results.get("documents") or [[]])[0] or []
        metas0 = (results.get("metadatas") or [[]])[0] or []
        dists0 = (results.get("distances") or [[]])[0] or []
        return docs0, metas0, dists0

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

        # 如果没传 queries，就至少用原问题
        if not queries:
            queries = [question]

        logger.info(f"Multi queries ({len(queries)}): {queries}")
        logger.info(f"fetch_k={fetch_k}, final_n={final_n}, max_per_source={max_per_source}, where={where}")

        merged: List[Dict[str, Any]] = []
        seen_fp = set()

        # 1) multi-query recall (single remote request for stability)
        q_embs = self._embed_texts(queries)
        kwargs: Dict[str, Any] = {
            "query_embeddings": q_embs,
            "n_results": fetch_k,
            "include": ["documents", "metadatas", "distances"],
        }
        if where:
            kwargs["where"] = where
        results = self.collection.query(**kwargs)

        docs_all = results.get("documents") or []
        metas_all = results.get("metadatas") or []
        dists_all = results.get("distances") or []

        for qi, q in enumerate(queries):
            docs = docs_all[qi] if qi < len(docs_all) and docs_all[qi] else []
            metas = metas_all[qi] if qi < len(metas_all) and metas_all[qi] else []
            dists = dists_all[qi] if qi < len(dists_all) and dists_all[qi] else []

            for i, doc in enumerate(docs):
                text_norm = _norm_text(doc or "")
                if _is_junk(text_norm):
                    continue

                fp = _fingerprint(text_norm)
                if fp in seen_fp:
                    continue
                seen_fp.add(fp)

                md = metas[i] if i < len(metas) and metas[i] is not None else {}
                dist = dists[i] if i < len(dists) else None

                merged.append(
                    {
                        "content": text_norm,
                        "metadata": md,
                        "distance": dist,
                        "_hit_query": q,
                        "_hit_query_i": qi,
                    }
                )

        # 2) rank: distance asc
        def dist_key(x: Dict[str, Any]) -> float:
            d = x.get("distance")
            return float(d) if d is not None else 1e9

        merged.sort(key=dist_key)

        # 3) diversify: limit per source_file/path/folder_path
        chosen: List[Dict[str, Any]] = []
        per_source: Dict[str, int] = {}

        def get_source(md: Dict[str, Any]) -> str:
            source = (
                md.get("source_file")
                or md.get("source")
                or md.get("file")
                or md.get("path")
                or md.get("folder_path")
                or "unknown"
            )
            return str(source)

        for item in merged:
            md = item.get("metadata") or {}
            src = get_source(md)

            if per_source.get(src, 0) >= max_per_source:
                continue

            chosen.append(item)
            per_source[src] = per_source.get(src, 0) + 1

            if len(chosen) >= final_n:
                break

        # 4) generate a small preview answer (Node 侧会再用 DeepSeek 生成更好的答案)
        answer = self._generate_answer_preview(question, chosen)

        # strip debug keys unless requested
        if not keep_debug_fields:
            for c in chosen:
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


def _parse_multi_payload(arg: str) -> Dict[str, Any]:
    """
    Accept:
      - JSON string: {"question": "...", "queries": [...], "top_k": 8, "fetch_k": 80, ...}
      - or @file.json : startswith '@' then load file
    """
    s = (arg or "").strip()
    if not s:
        return {}

    if s.startswith("@"):
        p = s[1:].strip()
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)

    return json.loads(s)


def main():
    # Usage:
    # 1) python knowledge.py "你的问题"
    # 2) python knowledge.py --multi '{"question":"...","queries":["...","..."],"top_k":8}'
    if len(sys.argv) < 2:
        out = {
            "answer": "Usage: python knowledge.py \"your question\"  OR  python knowledge.py --multi '{\"question\":\"...\",\"queries\":[...]}'",
            "chunks": [],
            "metadata": {"error": "missing args"},
        }
        sys.stdout.buffer.write((json.dumps(out, ensure_ascii=False) + "\n").encode("utf-8"))
        sys.exit(1)

    try:
        kb = FSHDKnowledgeBaseCloud()

        if sys.argv[1] == "--multi":
            if len(sys.argv) < 3:
                out = {
                    "answer": "Usage: python knowledge.py --multi '{\"question\":\"...\",\"queries\":[...]}'",
                    "chunks": [],
                    "metadata": {"error": "missing multi payload"},
                }
                sys.stdout.buffer.write((json.dumps(out, ensure_ascii=False) + "\n").encode("utf-8"))
                sys.exit(1)

            payload = _parse_multi_payload(sys.argv[2])

            question = str(payload.get("question") or payload.get("q") or "").strip()
            queries = payload.get("queries") or []
            if not isinstance(queries, list):
                queries = []

            top_k = _safe_int(payload.get("top_k") or payload.get("final_n"), int(os.getenv("KB_FINAL_N", "8")))
            fetch_k = _safe_int(payload.get("fetch_k"), int(os.getenv("KB_FETCH_K", "80")))
            max_per_source = _safe_int(payload.get("max_per_source"), int(os.getenv("KB_MAX_PER_SOURCE", "4")))

            where = payload.get("where")
            if where is not None and not isinstance(where, dict):
                where = None

            keep_debug = bool(payload.get("keep_debug_fields", False))

            result = kb.search_multi(
                question=question,
                queries=[str(x) for x in queries if x is not None],
                final_n=top_k,
                fetch_k=fetch_k,
                max_per_source=max_per_source,
                where=where,
                keep_debug_fields=keep_debug,
            )

        else:
            # single-question mode: no hardcoded expansion, just use question itself
            question = str(sys.argv[1]).strip()
            top_k = int(os.getenv("KB_FINAL_N", "8"))
            fetch_k = int(os.getenv("KB_FETCH_K", "80"))
            max_per_source = int(os.getenv("KB_MAX_PER_SOURCE", "4"))

            result = kb.search_multi(
                question=question,
                queries=[question],
                final_n=top_k,
                fetch_k=fetch_k,
                max_per_source=max_per_source,
                where=None,
                keep_debug_fields=False,
            )

        sys.stdout.buffer.write((json.dumps(result, ensure_ascii=False) + "\n").encode("utf-8"))
        sys.exit(0)

    except Exception as e:
        logger.exception("knowledge.py failed")
        err = {
            "answer": f"知识库服务暂时不可用：{str(e)}",
            "chunks": [],
            "metadata": {"error": str(e)},
        }
        sys.stdout.buffer.write((json.dumps(err, ensure_ascii=False) + "\n").encode("utf-8"))
        sys.exit(1)


if __name__ == "__main__":
    main()
