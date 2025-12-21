import os
import sys
import json
import logging
import re
import hashlib
import requests
from typing import List, Dict, Any, Tuple

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
# Junk filters (tune as you like)
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
    r"康复医师网络",  # 名录/名单类通常很吵
]
JUNK_RE = re.compile("|".join(JUNK_PATTERNS))


def _norm_text(t: str) -> str:
    t = (t or "").strip()
    # normalize whitespace
    t = re.sub(r"\s+", " ", t)
    return t


def _fingerprint(text: str) -> str:
    text = _norm_text(text)
    return hashlib.md5(text.encode("utf-8")).hexdigest()


def _is_junk(text: str) -> bool:
    if not text or len(text.strip()) < 30:
        return True
    return bool(JUNK_RE.search(text))


def _looks_like_answer(question: str, chunk: str) -> bool:
    """
    very light heuristic: if question asks genetics, prefer chunks with genetics terms.
    not mandatory, just helps ranking a bit.
    """
    q = question.lower()
    c = chunk.lower()
    genetics_q = any(k in q for k in ["遗传", "基因", "常染色体", "显性", "隐性", "duxd", "dux4", "d4z4", "fshd1", "fshd2"])
    if genetics_q:
        return any(k in c for k in ["常染色体", "显性", "隐性", "遗传", "d4z4", "4q35", "dux4", "fshd1", "fshd2", "smchd1", "lrifs"])
    return True


def expand_queries(question: str, max_q: int = 6) -> List[str]:
    """
    Rule-based query expansion (no LLM needed).
    Generates 3~6 queries including synonyms / bilingual keywords.
    """
    q = (question or "").strip()
    if not q:
        return []

    queries = [q]

    q_lower = q.lower()

    # If mentions FSHD / 面肩肱
    if ("fshd" in q_lower) or ("面肩肱" in q) or ("面-肩-肱" in q) or ("面肩肱型" in q):
        queries += [
            "FSHD 面肩肱型肌营养不良 遗传 常染色体显性",
            "facioscapulohumeral muscular dystrophy inheritance autosomal dominant",
            "FSHD1 FSHD2 D4Z4 4q35 DUX4",
        ]

    # Genetics focused
    if any(k in q for k in ["遗传", "基因", "显性", "隐性", "家族", "遗传方式"]):
        queries += [
            "FSHD 常染色体显性 遗传方式 外显率",
            "FSHD1 D4Z4 缩短 4qA DUX4 表达",
            "FSHD2 SMCHD1 DNMT3B LRIF1 DUX4",
        ]

    # Symptom / rehab focused
    if any(k in q for k in ["肩", "酸痛", "疼", "疼痛", "疲劳", "康复", "运动", "训练", "拉伸", "姿势"]):
        queries += [
            "FSHD 肩胛带 疼痛 管理 康复 运动 注意事项",
            "FSHD 肩胛骨翼状 肩关节 活动 过度使用",
            "肌营养不良 疼痛 疲劳 物理治疗 运动处方",
        ]

    # Deduplicate while preserving order
    seen = set()
    out = []
    for x in queries:
        x = x.strip()
        if not x or x in seen:
            continue
        out.append(x)
        seen.add(x)
        if len(out) >= max_q:
            break
    return out


class FSHDKnowledgeBaseCloud:
    def __init__(self):
        self.api_key = os.getenv("CHROMA_API_KEY", "").strip()
        self.tenant = os.getenv("CHROMA_TENANT", "").strip()
        self.database = os.getenv("CHROMA_DATABASE", "").strip()
        self.collection_name = os.getenv("CHROMA_COLLECTION", "").strip()

        if not self.api_key:
            raise RuntimeError("Missing env CHROMA_API_KEY")
        if not self.tenant:
            raise RuntimeError("Missing env CHROMA_TENANT")
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
        # batch encode for speed
        return self.model.encode(texts).tolist()

    def _query_once(self, q: str, fetch_k: int) -> Tuple[List[str], List[Dict[str, Any]], List[float]]:
        q_emb = self._embed_texts([q])[0]
        results = self.collection.query(
            query_embeddings=[q_emb],
            n_results=fetch_k,
            include=["documents", "metadatas", "distances"],
        )

        docs0 = (results.get("documents") or [[]])[0] or []
        metas0 = (results.get("metadatas") or [[]])[0] or []
        dists0 = (results.get("distances") or [[]])[0] or []

        return docs0, metas0, dists0

    def search_knowledge(self, question: str, n_results: int = 8) -> Dict[str, Any]:
        question = (question or "").strip()
        if not question:
            return {
                "answer": "请输入问题。",
                "chunks": [],
                "metadata": {"total_results": 0, "search_query": question},
            }

        try:
            # ---- config knobs ----
            FETCH_K = int(os.getenv("KB_FETCH_K", "80"))  # per-query recall
            MAX_QUERIES = int(os.getenv("KB_MAX_QUERIES", "6"))
            MAX_PER_SOURCE = int(os.getenv("KB_MAX_PER_SOURCE", "4"))  # diversity
            FINAL_N = int(os.getenv("KB_FINAL_N", str(n_results)))

            queries = expand_queries(question, max_q=MAX_QUERIES)
            logger.info(f"Expanded queries ({len(queries)}): {queries}")

            merged: List[Dict[str, Any]] = []
            seen_fp = set()

            # 1) multi-query recall
            for qi, q in enumerate(queries):
                docs, metas, dists = self._query_once(q, FETCH_K)

                for i, doc in enumerate(docs):
                    text = doc or ""
                    text_norm = _norm_text(text)
                    if _is_junk(text_norm):
                        continue

                    # optional heuristic
                    if not _looks_like_answer(question, text_norm):
                        # not drop; just keep, but we could downrank later if desired
                        pass

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
                            "_hit_query": q,        # debug
                            "_hit_query_i": qi,     # debug
                        }
                    )

            # 2) rank: distance asc (smaller = closer)
            def dist_key(x: Dict[str, Any]) -> float:
                d = x.get("distance")
                return float(d) if d is not None else 1e9

            merged.sort(key=dist_key)

            # 3) diversify: limit per source_file (or fallback to folder_path)
            chosen: List[Dict[str, Any]] = []
            per_source: Dict[str, int] = {}

            for item in merged:
                md = item.get("metadata") or {}
                source = (
                    md.get("source_file")
                    or md.get("source")
                    or md.get("file")
                    or md.get("path")
                    or md.get("folder_path")
                    or "unknown"
                )
                source = str(source)

                if per_source.get(source, 0) >= MAX_PER_SOURCE:
                    continue

                chosen.append(item)
                per_source[source] = per_source.get(source, 0) + 1

                if len(chosen) >= FINAL_N:
                    break

            answer = self._generate_answer(question, chosen)

            # strip debug keys before returning
            for c in chosen:
                c.pop("_hit_query", None)
                c.pop("_hit_query_i", None)

            return {
                "answer": answer,
                "chunks": chosen,  # {content, metadata, distance}
                "metadata": {
                    "total_results": len(chosen),
                    "search_query": question,
                    "expanded_queries": queries,
                    "fetch_k": FETCH_K,
                },
            }

        except Exception as e:
            logger.exception("Search failed")
            return {
                "answer": "抱歉，知识库搜索暂时不可用。",
                "chunks": [],
                "metadata": {"error": str(e), "search_query": question},
            }

    def _generate_answer(self, question: str, chunks: List[Dict[str, Any]]) -> str:
        if not chunks:
            return (
                "抱歉，在知识库中没有找到直接相关的信息。\n"
                "如果是健康/症状问题，建议提供：症状持续时间、部位、严重程度、是否影响日常活动、是否伴随无力/麻木/发热等。\n"
                "（这不是医疗诊断，请咨询专业医生。）"
            )

        parts = [f"根据知识库检索，关于“{question}”的信息如下：\n"]
        for idx, ch in enumerate(chunks[:5], 1):
            text = ch.get("content") or ""
            preview = (text[:220] + "...") if len(text) > 220 else text
            parts.append(f"{idx}. {preview}")

        parts.extend(
            [
                "\n---",
                "请注意：以上信息来自资料检索，仅供参考；这不是医疗诊断，请咨询专业医生。",
            ]
        )
        return "\n".join(parts)


def main():
    if len(sys.argv) < 2:
        out = {
            "answer": "Usage: python knowledge.py \"your question\"",
            "chunks": [],
            "metadata": {"error": "missing question"},
        }
        sys.stdout.buffer.write((json.dumps(out, ensure_ascii=False) + "\n").encode("utf-8"))
        sys.exit(1)

    question = sys.argv[1]

    try:
        kb = FSHDKnowledgeBaseCloud()
        result = kb.search_knowledge(question, n_results=int(os.getenv("KB_FINAL_N", "8")))
        sys.stdout.buffer.write((json.dumps(result, ensure_ascii=False) + "\n").encode("utf-8"))
        sys.exit(0)
    except Exception as e:
        err = {
            "answer": f"知识库服务暂时不可用：{str(e)}",
            "chunks": [],
            "metadata": {"error": str(e)},
        }
        sys.stdout.buffer.write((json.dumps(err, ensure_ascii=False) + "\n").encode("utf-8"))
        sys.exit(1)


if __name__ == "__main__":
    main()
