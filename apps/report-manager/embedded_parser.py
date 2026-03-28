import argparse
import json
import os
import sys
import traceback

from app.services.fshd_report_service import analyze_fshd_report
from app.services.ocr_service import extract_text_from_file


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

    try:
        if not os.path.exists(args.file_path):
            raise FileNotFoundError(f"Input file not found: {args.file_path}")

        extracted_text = extract_text_from_file(args.file_path, args.mime_type)
        analysis = analyze_fshd_report(extracted_text, args.document_type_hint or None)

        payload = {
            "provider": "embedded_report_pipeline_v1",
            "report_name": args.report_name or os.path.basename(args.file_path),
            "mime_type": args.mime_type,
            "document_type_hint": args.document_type_hint or None,
            "extracted_text": extracted_text,
            "analysis": analysis,
        }
        sys.stdout.write(json.dumps(payload, ensure_ascii=False))
        return 0
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
