from __future__ import annotations

import hmac
from typing import Dict, Optional

from ..settings import API_KEY


AUTH_HEADER_KEYS = ("authorization", "x-api-key", "x-goog-api-key")


def extract_api_key(headers: Dict[str, str]) -> Optional[str]:
    authorization = headers.get("authorization")
    if authorization:
        if authorization.lower().startswith("bearer "):
            return authorization.split(" ", 1)[1].strip()
        return authorization.strip()

    for key in AUTH_HEADER_KEYS[1:]:
        value = headers.get(key)
        if value:
            return value.strip()

    return None


def is_authorized(headers: Dict[str, str]) -> bool:
    if not API_KEY:
        return False
    api_key = extract_api_key(headers)
    if api_key is None:
        return False
    return hmac.compare_digest(api_key, API_KEY)
