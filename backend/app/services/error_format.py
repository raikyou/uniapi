from __future__ import annotations

import json
from typing import Any, Dict, Optional, Tuple, List

JSON_MEDIA_TYPE = "application/json"


def _normalize_protocol(protocol: Optional[str]) -> str:
    if not protocol:
        return "openai"
    protocol = protocol.lower().strip()
    if protocol in {"openai", "anthropic", "gemini"}:
        return protocol
    return "openai"


def _is_json_media_type(content_type: Optional[str]) -> bool:
    if not content_type:
        return False
    base_type = content_type.split(";", 1)[0].strip().lower()
    return base_type == "application/json" or base_type.endswith("+json")


def _looks_like_json(body: str) -> bool:
    stripped = body.lstrip()
    if not stripped or stripped[0] not in "{[":
        return False
    try:
        json.loads(stripped)
        return True
    except json.JSONDecodeError:
        return False


def _openai_error_type(status_code: int) -> str:
    if status_code == 401:
        return "authentication_error"
    if status_code == 403:
        return "permission_error"
    if status_code == 429:
        return "rate_limit_error"
    if 500 <= status_code:
        return "server_error"
    return "invalid_request_error"


def _anthropic_error_type(status_code: int) -> str:
    if status_code == 401:
        return "authentication_error"
    if status_code == 403:
        return "permission_error"
    if status_code == 404:
        return "not_found_error"
    if status_code == 429:
        return "rate_limit_error"
    if status_code == 529:
        return "overloaded_error"
    if 500 <= status_code:
        return "api_error"
    return "invalid_request_error"


def _google_error_status(status_code: int) -> str:
    mapping = {
        400: "INVALID_ARGUMENT",
        401: "UNAUTHENTICATED",
        403: "PERMISSION_DENIED",
        404: "NOT_FOUND",
        408: "DEADLINE_EXCEEDED",
        409: "ABORTED",
        429: "RESOURCE_EXHAUSTED",
        500: "INTERNAL",
        501: "UNIMPLEMENTED",
        502: "INTERNAL",
        503: "UNAVAILABLE",
        504: "DEADLINE_EXCEEDED",
    }
    return mapping.get(status_code, "UNKNOWN")


def build_error_payload(
    protocol: Optional[str],
    message: str,
    status_code: int,
    *,
    code: Optional[str] = None,
) -> Dict[str, Any]:
    protocol = _normalize_protocol(protocol)
    if protocol == "anthropic":
        return {
            "type": "error",
            "error": {"type": _anthropic_error_type(status_code), "message": message},
        }
    if protocol == "gemini":
        return {
            "error": {
                "code": status_code,
                "message": message,
                "status": _google_error_status(status_code),
            }
        }
    payload = {"error": {"message": message, "type": _openai_error_type(status_code)}}
    if code:
        payload["error"]["code"] = code
    return payload


def format_error_body(
    protocol: Optional[str],
    status_code: int,
    message: Optional[str],
    *,
    code: Optional[str] = None,
) -> str:
    safe_message = (message or "").strip() or "request failed"
    payload = build_error_payload(protocol, safe_message, status_code, code=code)
    return json.dumps(payload, ensure_ascii=True)


def normalize_error_body(
    protocol: Optional[str],
    status_code: int,
    body: Optional[object],
    *,
    content_type: Optional[str] = None,
    code: Optional[str] = None,
    allow_passthrough: bool = True,
) -> Tuple[str, str]:
    if body is None:
        message = ""
    elif isinstance(body, (dict, list)):
        message = json.dumps(body, ensure_ascii=True)
    else:
        message = str(body)

    if allow_passthrough and message and _looks_like_json(message):
        media_type = content_type if _is_json_media_type(content_type) else JSON_MEDIA_TYPE
        return message, media_type

    return format_error_body(protocol, status_code, message, code=code), JSON_MEDIA_TYPE


def build_stream_error_frames(
    protocol: Optional[str],
    status_code: int,
    message: Optional[str],
    *,
    code: Optional[str] = None,
) -> List[bytes]:
    payload = format_error_body(protocol, status_code, message, code=code)
    protocol = _normalize_protocol(protocol)
    if protocol == "anthropic":
        return [f"event: error\ndata: {payload}\n\n".encode("utf-8")]
    if protocol == "gemini":
        return [f"data: {payload}\n\n".encode("utf-8")]
    return [
        f"data: {payload}\n\n".encode("utf-8"),
        b"data: [DONE]\n\n",
    ]
