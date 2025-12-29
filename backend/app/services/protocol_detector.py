from __future__ import annotations

from typing import Dict

OPENAI_PATHS = {
    "/v1/chat/completions",
    "/v1/responses",
    "/v1/embeddings",
    "/v1/models",
}
OPENAI_PREFIXES = ("/v1/images", "/v1/audio")
ANTHROPIC_PREFIXES = ("/v1/messages", "/v1/complete")
GEMINI_PREFIXES = ("/v1beta/models", "/v1/models", "/v1beta/projects", "/v1/projects")
GEMINI_OPERATIONS = (
    ":generatecontent",
    ":streamgeneratecontent",
    ":batchgeneratecontent",
    ":counttokens",
    ":embedcontent",
)


def _is_gemini_path(path: str) -> bool:
    if any(op in path for op in GEMINI_OPERATIONS):
        return True
    return path.startswith(GEMINI_PREFIXES)


def detect_protocol(path: str, headers: Dict[str, str]) -> str:
    lower_path = path.lower()
    lower_headers = {key.lower(): value for key, value in headers.items()}
    if (
        lower_path in OPENAI_PATHS
        or lower_path.startswith(OPENAI_PREFIXES)
        or (lower_path.startswith("/v1/models/") and ":" not in lower_path)
    ):
        return "openai"
    if lower_path.startswith(ANTHROPIC_PREFIXES):
        return "anthropic"
    if _is_gemini_path(lower_path):
        return "gemini"

    if "anthropic-version" in lower_headers:
        return "anthropic"
    if "x-goog-api-key" in lower_headers or "x-goog-user-project" in lower_headers:
        return "gemini"
    return "unknown"
