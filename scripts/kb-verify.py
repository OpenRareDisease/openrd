#!/usr/bin/env python3
"""Compare KB recall between two backends, or measure the relevance floor.

Default mode runs the same set of probe questions through Chroma Cloud
and pgvector, prints the top hits from each, and saves a JSON report.
Intended as a human-in-the-loop A/B during the cutover -- read the
output and judge whether pgvector's recall is good enough to flip
KB_BACKEND.

`--floor-probe` mode runs the in-corpus and out-of-corpus probe sets
through pgvector only and prints the two distance distributions. This is
the measurement that produced `DEFAULT_RELEVANCE_FLOOR` in
apps/api/knowledge.py; rerun it after an embedding-model change or a
significant corpus change and move the constant if the band has moved.

Examples
--------
  python scripts/kb-verify.py
  python scripts/kb-verify.py --questions my_probes.txt --top-k 5
  python scripts/kb-verify.py --output results.json
  python scripts/kb-verify.py --floor-probe
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
from pathlib import Path
from typing import Any, Dict, List

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT / "apps" / "api"))

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

#: In-corpus probes for the relevance-floor measurement: the A/B set
#: above plus five topics the corpus demonstrably covers and that the
#: authority tiering cares about (anaesthesia, pregnancy, orthotics,
#: prognosis, coping). Adding them widened the measured in-corpus band
#: rather than flattering it, which is the point of a floor probe.
IN_CORPUS_QUESTIONS = [
    *DEFAULT_QUESTIONS,
    "FSHD 患者做手术麻醉需要注意什么？",
    "FSHD 女性怀孕需要注意什么？",
    "踝足矫形器 AFO 对足下垂有帮助吗？",
    "FSHD 会影响寿命吗？",
    "确诊 FSHD 后心理上怎么调整？",
]

#: Out-of-corpus probes. Three deliberate groups, hardest first:
#:
#:   1. Adjacent neuromuscular disease (DMD / ALS / 重症肌无力 / SMA).
#:      These are the dangerous ones — a majority of FSHD patients spend
#:      years misdiagnosed, so they genuinely ask these questions, and
#:      the FSHD corpus is full of text that looks like an answer.
#:   2. Alternative / general medicine the corpus does not cover
#:      (vaccines, 中药, 针灸, 高血压, 糖尿病, a named hospital's testing).
#:   3. Plainly off-topic (weather, recipes, code, crypto, football).
#:
#: If a floor lets group 1 through, it is too high, whatever it does for
#: group 3.
#:
#: A probe belongs here only if the corpus really has no passage that
#: answers it. One of the original SMA probes did not clear that bar and
#: was retired on 2026-08-11: 「脊髓性肌萎缩症 SMA 的诺西那生钠多少钱一
#: 针？」 came back at best-hit 0.2314 — nearer than 13 of the 15
#: in-corpus probes — because 06.政策与倡导教育/…/B.以患者为中心”的互动
#: 交流活动——白皮书》完整版.pdf chunk 48 literally quotes 「单只 70 万元」
#: for that drug. That is a true positive, so it can only pull the
#: out-of-corpus minimum below any usable floor and make the band look
#: broken for the wrong reason. Two SMA questions the corpus genuinely
#: does not answer replace it (their top hit is a Chinese FSHD paper,
#: not an SMA answer), and they measure the same danger honestly.
OUT_OF_CORPUS_QUESTIONS = [
    "杜氏肌营养不良 DMD 的激素治疗方案是什么？",
    "渐冻症 ALS 的确诊标准是什么？",
    "重症肌无力的胸腺切除手术效果如何？",
    "脊髓性肌萎缩症 SMA 分几型，怎么区分？",
    "脊髓性肌萎缩症 SMA 的 SMN1 基因检测怎么做？",
    "帕金森病的早期症状有哪些？",
    "新冠疫苗打了会不会加重肌无力？",
    "中药调理对肌营养不良有效吗？",
    "针灸能治疗肌肉萎缩吗？",
    "广州中山一院能不能做基因检测？",
    "腰椎间盘突出需要手术吗？",
    "高血压吃什么降压药最好？",
    "糖尿病人可以吃西瓜吗？",
    "感冒发烧应该吃什么药？",
    "我家猫不吃东西怎么办？",
    "明天北京天气怎么样？",
    "今天上海会下雨吗？",
    "怎么用 Python 读取 CSV 文件？",
    "红烧肉的做法是什么？",
    "帮我写一首关于春天的诗",
    "比特币现在多少钱？",
    "世界杯决赛是哪一天？",
    "推荐几部好看的科幻电影",
]

#: Candidate floors the probe reports survivor counts for. Bracket the
#: measured gap between the two distributions so the printout shows what
#: each choice costs, not just the one that was picked.
FLOOR_CANDIDATES = [0.36, 0.38, 0.40, 0.42, 0.44]


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


def _probe_distribution(
    questions: List[str], backend, embedder, fetch_k: int
) -> List[Dict[str, Any]]:
    """Best / 3rd / 8th distance plus per-floor survivor counts."""
    embeddings = embedder.embed_texts(questions)
    per_query = backend.query_multi(embeddings, fetch_k=fetch_k)
    rows: List[Dict[str, Any]] = []
    for question, hits in zip(questions, per_query):
        distances = sorted(h.distance for h in hits if h.distance is not None)
        rows.append(
            {
                "question": question,
                "best": distances[0] if distances else None,
                "d3": distances[2] if len(distances) > 2 else None,
                "d8": distances[7] if len(distances) > 7 else None,
                "top_source": hits[0].source_file if hits else None,
                "kept": {
                    f: sum(1 for d in distances if d <= f) for f in FLOOR_CANDIDATES
                },
            }
        )
    return rows


def _print_distribution(rows: List[Dict[str, Any]], label: str) -> None:
    print(f"===== {label} ({len(rows)} probes) =====")
    header = "  " + "".join(f"<={f:<6.2f}" for f in FLOOR_CANDIDATES)
    print(f"{header}   best    d3      d8      question")
    for row in rows:
        counts = "".join(f"{row['kept'][f]:<8d}" for f in FLOOR_CANDIDATES)

        def _fmt(key: str) -> str:
            return f"{row[key]:.4f}" if row[key] is not None else "  ?   "

        print(
            f"  {counts}  {_fmt('best')}  {_fmt('d3')}  {_fmt('d8')}  {row['question']}"
        )
        print(f"        -> top hit: {row['top_source']}")

    bests = [r["best"] for r in rows if r["best"] is not None]
    if bests:
        print(
            f"  best-hit distance: min={min(bests):.4f} "
            f"p50={statistics.median(bests):.4f} max={max(bests):.4f}"
        )
    for f in FLOOR_CANDIDATES:
        total = sum(r["kept"][f] for r in rows)
        zeroed = sum(1 for r in rows if r["kept"][f] == 0)
        print(
            f"    floor={f:.2f}: {total:5d} chunks kept, "
            f"{zeroed}/{len(rows)} probes left with nothing"
        )
    print()


def _run_floor_probe(fetch_k: int, output: str | None) -> int:
    """Print the two distance distributions the floor is derived from.

    Reads the two distributions and leaves the judgement to a human on
    purpose. The right floor sits in the gap between「the worst distance
    an in-corpus question still needs」and「the best distance an
    out-of-corpus question can reach」, and whether that gap even exists
    is the thing worth looking at — a printed "suggested value" would
    hide an overlap behind a number.
    """
    print(f"KB relevance-floor probe (pgvector, fetch_k={fetch_k})")
    print(f"  embed model : {os.getenv('KB_EMBED_MODEL', 'BAAI/bge-m3')}")
    print()

    embedder = create_embedder()
    backend = PgVectorBackend()
    try:
        in_rows = _probe_distribution(IN_CORPUS_QUESTIONS, backend, embedder, fetch_k)
        out_rows = _probe_distribution(
            OUT_OF_CORPUS_QUESTIONS, backend, embedder, fetch_k
        )
    finally:
        backend.close()

    _print_distribution(in_rows, "IN-CORPUS")
    _print_distribution(out_rows, "OUT-OF-CORPUS")

    in_bests = [r["best"] for r in in_rows if r["best"] is not None]
    out_bests = [r["best"] for r in out_rows if r["best"] is not None]
    if in_bests and out_bests:
        worst_in, best_out = max(in_bests), min(out_bests)
        if worst_in < best_out:
            print(
                f"Separating band: [{worst_in:.4f}, {best_out:.4f}] — every "
                f"in-corpus probe keeps its top hit below a floor in this "
                f"range and every out-of-corpus probe loses everything. "
                f"Pick low inside it; the two failure modes are not "
                f"symmetric (see DEFAULT_RELEVANCE_FLOOR)."
            )
        else:
            print(
                f"NO separating band: worst in-corpus best-hit {worst_in:.4f} "
                f">= best out-of-corpus best-hit {best_out:.4f}. Any single "
                f"floor will either cut real answers or admit out-of-corpus "
                f"ones. Do not pick a number off this run."
            )

    if output:
        with open(output, "w", encoding="utf-8") as f:
            json.dump({"in_corpus": in_rows, "out_of_corpus": out_rows}, f,
                      ensure_ascii=False, indent=2)
        print(f"Wrote full report to {output}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare KB recall: chroma_cloud vs pgvector")
    parser.add_argument("--questions", help="File with one question per line; defaults to a built-in set")
    parser.add_argument("--top-k", type=int, default=3, help="Top hits to show per backend per question")
    parser.add_argument("--output", help="Optional JSON file to write the full report to")
    parser.add_argument(
        "--floor-probe",
        action="store_true",
        help=(
            "Measure the relevance floor instead of running the A/B: query "
            "pgvector with the in-corpus and out-of-corpus probe sets and "
            "print both distance distributions. Chroma is not touched."
        ),
    )
    parser.add_argument(
        "--floor-fetch-k",
        type=int,
        default=80,
        help="Hits per probe in --floor-probe mode (default %(default)s, matching KB_FETCH_K)",
    )
    args = parser.parse_args()

    if args.floor_probe:
        return _run_floor_probe(args.floor_fetch_k, args.output)

    questions = load_questions(args.questions)

    print(f"KB verify: {len(questions)} questions, top-{args.top_k}")
    print(f"  embed model : {os.getenv('KB_EMBED_MODEL', 'BAAI/bge-m3')}")
    print()

    embedder = create_embedder()
    # Imported here, not at module scope: ChromaCloudBackend's
    # constructor needs Chroma Cloud credentials, and --floor-probe
    # (which only ever touches pgvector) must not require them.
    from kb_backends.chroma_cloud import ChromaCloudBackend

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
