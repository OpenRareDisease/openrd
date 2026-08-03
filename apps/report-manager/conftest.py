"""Make `apps/report-manager` importable no matter where pytest is run.

`tests/test_fshd_report_service.py` imports `app.services...`, which only
resolves when this directory is on sys.path. Running pytest from inside
`apps/report-manager` happens to satisfy that; running the whole Python
suite from the repo root — `pytest apps/report-manager/tests
scripts/kb_parsers`, which is what a CI job would do — does not, because
pytest inserts the *test file's* directory (`tests/`), not its parent.
The result was a collection error, so any CI job written against the
obvious command would have failed on a clean tree.

pytest prepends a conftest's own directory to sys.path in the default
import mode, so this file existing is most of the fix; the explicit
insert keeps it working under `--import-mode=importlib` too.
"""

import sys
from pathlib import Path

_PACKAGE_ROOT = str(Path(__file__).resolve().parent)
if _PACKAGE_ROOT not in sys.path:
    sys.path.insert(0, _PACKAGE_ROOT)
