from fastapi import Header, HTTPException
from config import Config


def require_api_key(
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
    authorization: str | None = Header(default=None, alias="Authorization"),
):
    """
    Require API key for report-manager endpoints.
    Accepts either:
    - X-API-Key: <key>
    - Authorization: Bearer <key>
    """
    if not Config.API_KEY:
        # Dev-friendly: allow if no key configured
        return

    key = None
    if x_api_key:
        key = x_api_key.strip()
    elif authorization and authorization.lower().startswith("bearer "):
        key = authorization[7:].strip()

    if not key or key != Config.API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
