from __future__ import annotations

import asyncio
import json
import time
import urllib.parse
from typing import Any, Dict, Iterable, Optional

import litellm
from starlette.responses import StreamingResponse

from . import log_service
from .error_format import build_stream_error_frames, format_error_body
from .stream_aggregate import aggregate_stream_chunks


def _build_litellm_model(provider_type: str, model: str) -> str:
    if "/" in model:
        return model
    return f"{provider_type}/{model}"


def _normalize_api_base(provider_type: str, base_url: str) -> Optional[str]:
    if provider_type != "gemini":
        return base_url
    if not base_url:
        return None
    parsed = urllib.parse.urlparse(base_url)
    # Let LiteLLM build the default Gemini v1beta URL when the base URL is the root host.
    if parsed.hostname == "generativelanguage.googleapis.com" and "/v1" not in parsed.path:
        return None
    return base_url


def _response_to_dict(response: Any) -> Dict[str, Any]:
    if isinstance(response, dict):
        return response
    if hasattr(response, "model_dump"):
        return response.model_dump()
    if hasattr(response, "dict"):
        return response.dict()
    if hasattr(response, "json"):
        try:
            return json.loads(response.json())
        except Exception:
            pass
    return {"raw": str(response)}


def _extract_usage(payload: Dict[str, Any]) -> Dict[str, Optional[int]]:
    def pick(primary: Optional[int], fallback: Optional[int]) -> Optional[int]:
        return primary if primary is not None else fallback

    tokens_in = None
    tokens_out = None
    tokens_total = None
    tokens_cache = None

    usage = payload.get("usage")
    if isinstance(usage, dict):
        tokens_in = pick(usage.get("prompt_tokens"), usage.get("input_tokens"))
        tokens_out = pick(usage.get("completion_tokens"), usage.get("output_tokens"))
        tokens_total = usage.get("total_tokens")
        details = usage.get("prompt_tokens_details")
        if isinstance(details, dict):
            tokens_cache = details.get("cached_tokens")
        if tokens_cache is None:
            tokens_cache = pick(usage.get("cache_read_input_tokens"), usage.get("cached_tokens"))

    usage_meta = payload.get("usageMetadata") or payload.get("usage_metadata")
    if isinstance(usage_meta, dict):
        tokens_in = pick(tokens_in, pick(usage_meta.get("promptTokenCount"), usage_meta.get("prompt_tokens")))
        tokens_out = pick(tokens_out, pick(usage_meta.get("candidatesTokenCount"), usage_meta.get("completion_tokens")))
        tokens_total = pick(tokens_total, pick(usage_meta.get("totalTokenCount"), usage_meta.get("total_tokens")))

    return {
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "tokens_total": tokens_total,
        "tokens_cache": tokens_cache,
    }


async def litellm_completion(provider: Dict[str, Any], request_json: Dict[str, Any], stream: bool):
    payload = dict(request_json)
    # Ensure stream is set correctly in payload (overwrite if exists)
    payload["stream"] = stream
    payload["model"] = _build_litellm_model(provider["type"], payload["model"])
    payload["api_key"] = provider["api_key"]
    api_base = _normalize_api_base(provider["type"], provider["base_url"])
    if api_base:
        payload["api_base"] = api_base
    return await asyncio.to_thread(litellm.completion, **payload)


async def litellm_streaming_response(
    response: Iterable[Any],
    provider_id: int,
    log_id: int,
    model_alias: Optional[str],
    model_id: Optional[str],
    translated: bool,
    start_time: float,
    protocol: str,
    extra_headers: Optional[Dict[str, str]] = None,
) -> StreamingResponse:
    chunks: list[Dict[str, Any]] = []
    first_chunk_time: Optional[float] = None

    def generator():
        nonlocal first_chunk_time
        completed = False
        error_body = None
        try:
            for chunk in response:
                if first_chunk_time is None:
                    first_chunk_time = time.monotonic()
                chunk_dict = _response_to_dict(chunk)
                chunks.append(chunk_dict)
                yield f"data: {json.dumps(chunk_dict, ensure_ascii=True)}\n\n".encode("utf-8")
            completed = True
            yield b"data: [DONE]\n\n"
        except Exception as exc:
            if not chunks:
                frames = build_stream_error_frames(protocol, 502, str(exc))
                error_body = format_error_body(protocol, 502, str(exc))
                for frame in frames:
                    yield frame

        latency_ms = int((time.monotonic() - start_time) * 1000)
        first_token_ms = (
            int((first_chunk_time - start_time) * 1000) if first_chunk_time else None
        )
        usage_source = {}
        for chunk in reversed(chunks):
            if isinstance(chunk, dict) and ("usage" in chunk or "usageMetadata" in chunk):
                usage_source = chunk
                break

        if error_body is not None:
            response_body = error_body
        else:
            final_payload = aggregate_stream_chunks(chunks, protocol)
            if final_payload is not None:
                response_body = json.dumps(final_payload, ensure_ascii=True)
            else:
                response_body = ""
        log_service.update_log(
            log_id,
            {
                "status": "success" if completed else "error",
                "response_body": response_body,
                "latency_ms": latency_ms,
                "first_token_ms": first_token_ms,
                "provider_id": provider_id,
                "model_alias": model_alias,
                "model_id": model_id,
                "translated": translated,
                **_extract_usage(usage_source),
            },
        )

    return StreamingResponse(
        generator(),
        status_code=200,
        headers=extra_headers,
        media_type="text/event-stream",
    )
