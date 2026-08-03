import argparse
import json
import os
import sys
import traceback

from app.services.fshd_report_service import analyze_fshd_report
from app.services.ocr_service import (
    OcrPageLimitExceeded,
    extract_text_from_file,
    ocr_engine_report,
    resolve_ocr_engine,
)

#: Base provider label. The engine that actually read the document gets
#: appended (`embedded_report_pipeline_v1+tesseract`) because this string
#: is what the api stores on the document row, and until now nothing
#: recorded whether a given report was read by PaddleOCR or by the
#: Tesseract fallback that production actually runs. Two documents whose
#: numbers disagree are impossible to triage without knowing that.
_PROVIDER_BASE = "embedded_report_pipeline_v1"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Embedded OCR + FSHD report parser")
    parser.add_argument("--file-path", required=True)
    parser.add_argument("--mime-type", default="application/octet-stream")
    parser.add_argument("--document-type-hint", default="")
    parser.add_argument("--report-name", default="")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    # Announce the resolved engine before doing any work. stdout is the
    # JSON channel the api parses, so this goes to stderr, which the api
    # captures on failure and which `docker logs` shows either way.
    _resolved = resolve_ocr_engine()
    print(
        f"OCR engine (resolved): {_resolved['engine']} — {_resolved['reason']}",
        file=sys.stderr,
    )

    try:
        if not os.path.exists(args.file_path):
            raise FileNotFoundError(f"Input file not found: {args.file_path}")

        extracted_text = extract_text_from_file(args.file_path, args.mime_type)
        analysis = analyze_fshd_report(
            extracted_text,
            args.document_type_hint or None,
            args.report_name or os.path.basename(args.file_path),
        )

        engines = ocr_engine_report()
        provider = _PROVIDER_BASE + "+" + ("/".join(engines["used"]) or "none")

        payload = {
            "provider": provider,
            "ocr_engine": engines,
            "report_name": args.report_name or os.path.basename(args.file_path),
            "mime_type": args.mime_type,
            "document_type_hint": args.document_type_hint or None,
            "extracted_text": extracted_text,
            "analysis": analysis,
        }
        sys.stdout.write(json.dumps(payload, ensure_ascii=False))
        return 0
    except OcrPageLimitExceeded as exc:
        # Distinct code so the api can eventually surface this as a
        # 「文件页数过多」 message the patient can act on, rather than the
        # generic parse failure. `detail` is already user-facing Chinese
        # and is what the api currently forwards.
        payload = {
            "error": "embedded_report_page_limit_exceeded",
            "detail": str(exc),
        }
        sys.stdout.write(json.dumps(payload, ensure_ascii=False))
        return 1
    except Exception as exc:
        payload = {
            "error": "embedded_report_parse_failed",
            "detail": str(exc),
            "traceback": traceback.format_exc(limit=6),
        }
        sys.stdout.write(json.dumps(payload, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
