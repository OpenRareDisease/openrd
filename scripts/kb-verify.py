#!/usr/bin/env python3
"""Compare KB recall between two backends side-by-side.

Runs the same set of probe questions through Chroma Cloud and pgvector,
prints the top hits from each, and saves a JSON report. Intended as a
human-in-the-loop A/B during the cutover -- read the output and judge
whether pgvector's recall is good enough to flip KB_BACKEND.

Examples
--------
  python scripts/kb-verify.py
  python scripts/kb-verify.py --questions my_probes.txt --top-k 5
  python scripts/kb-verify.py --output results.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT / "apps" / "api"))

from kb_backends.chroma_cloud import ChromaCloudBackend  # noqa: E402
from kb_backends.pgvector import PgVectorBackend  # noqa: E402
from embed_models import create_embedder  # noqa: E402

DEFAULT_QUESTIONS = [
    "FSHD 是什么病？",
    "D4Z4 重复减少是什么意思？",
    "FSHD 的早期症状有哪些？",
    "FSHD1 和 FSHD2 的区别？",
    "肩胛带无力是 FSHD 的典型表现吗？",
    "FSHD 目前有哪些治疗方向？",
    "甲基化值对 FSHD 诊断有什么意义？",
    "FSHD 患者日常生活要注意什么？",
    "MRI 的 STIR 信号增高在 FSHD 报告里说明什么？",
    "FSHD 是遗传病吗，会传给下一代吗？",
]


def load_questions(path: str | None) -> List[str]:
    if not path:
        return DEFAULT_QUESTIONS
    with open(path, "r", encoding="utf-8") as f:
        return [line.strip() for line in f if line.strip() and not line.startswith("#")]


def run_one(question: str, backend, embedder, top_k: int) -> List[Dict[str, Any]]:
    q_emb = embedder.embed_one(question)
    hits = backend.query_multi([q_emb], fetch_k=top_k)
    out = []
    for hit in hits[0] if hits else []:
        out.append(
            {
                "distance": hit.distance,
                "source_file": hit.source_file,
                "snippet": (hit.content[:200] + "...") if hit.content and len(hit.content) > 200 else hit.content,
            }
        )
    return out


def format_results(results: List[Dict[str, Any]]) -> str:
    if not results:
        return "    (no hits)\n"
    lines = []
    for i, r in enumerate(results, 1):
        dist = r["distance"]
        dist_str = f"{dist:.4f}" if dist is not None else "?"
        src = r["source_file"] or "?"
        snippet = (r["snippet"] or "").replace("\n", " ")
        lines.append(f"    {i}. d={dist_str}  src={src}")
        lines.append(f"       {snippet}")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare KB recall: chroma_cloud vs pgvector")
    parser.add_argument("--questions", help="File with one question per line; defaults to a built-in set")
    parser.add_argument("--top-k", type=int, default=3, help="Top hits to show per backend per question")
    parser.add_argument("--output", help="Optional JSON file to write the full report to")
    args = parser.parse_args()

    questions = load_questions(args.questions)

    print(f"KB verify: {len(questions)} questions, top-{args.top_k}")
    print(f"  embed model : {os.getenv('KB_EMBED_MODEL', 'BAAI/bge-m3')}")
    print()

    embedder = create_embedder()
    chroma = ChromaCloudBackend()
    pgvector_backend = PgVectorBackend()

    # Note: chroma_cloud was indexed with all-MiniLM-L6-v2 historically;
    # using bge-m3 query vectors against chroma will be apples-to-oranges
    # for cosine distance. The intent here is human review of *which
    # chunks come back*, not raw distance comparison.

    report: List[Dict[str, Any]] = []
    for i, question in enumerate(questions, 1):
        chroma_hits = run_one(question, chroma, embedder, args.top_k)
        pg_hits = run_one(question, pgvector_backend, embedder, args.top_k)
        report.append(
            {
                "question": question,
                "chroma_cloud": chroma_hits,
                "pgvector": pg_hits,
            }
        )
        print(f"[{i}/{len(questions)}] {question}")
        print("  -- chroma_cloud --")
        print(format_results(chroma_hits), end="")
        print("  -- pgvector --")
        print(format_results(pg_hits), end="")
        print()

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print(f"Wrote full report to {args.output}")

    pgvector_backend.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
