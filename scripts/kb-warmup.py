#!/usr/bin/env python3
"""Pre-download the embedding model used by the KB service.

Useful on a fresh dev machine or before a CI smoke test so the first
real query doesn't pay for the model download. Respects KB_EMBED_MODEL.

Usage:
  python scripts/kb-warmup.py              # uses KB_EMBED_MODEL or default
  python scripts/kb-warmup.py BAAI/bge-m3  # explicit override
"""

import os
import sys
import time

# Make apps/api importable when running from repo root.
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "apps", "api"))


def main() -> int:
    model_name = (
        sys.argv[1].strip()
        if len(sys.argv) > 1
        else os.getenv("KB_EMBED_MODEL", "BAAI/bge-m3").strip()
    )

    print(f"Warming embedding model: {model_name}")
    print("First run downloads weights (bge-m3 is ~2.3 GB); subsequent runs are cached.")

    started = time.time()
    try:
        from embed_models.sentence_transformer import SentenceTransformerEmbedder

        embedder = SentenceTransformerEmbedder(model_name=model_name)
        probe = embedder.embed_one("FSHD knowledge base warmup probe")
        elapsed = time.time() - started
        print(
            f"OK: model={embedder.model_name} dim={embedder.dimension} "
            f"probe_len={len(probe)} elapsed={elapsed:.1f}s"
        )
        return 0
    except Exception as exc:
        print(f"FAILED: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
