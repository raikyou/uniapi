from __future__ import annotations

import asyncio
import json
import time
import uuid
import urllib.parse
from dataclasses import dataclass
from typing import Any, Dict, Optional

import httpx
from fastapi import Response
from starlette.responses import StreamingResponse

from .protocol_detector import detect_protocol
from .runtime import freeze_manager
from . import provider_service, log_service, litellm_service
from .auth import is_authorized
from .error_format import build_stream_error_frames, format_error_body, normalize_error_body
from .litellm_service import litellm_completion, litellm_streaming_response
from .url_service import join_base_url
from .stream_aggregate import aggregate_stream_chunks, collect_stream_chunks


HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
}
AUTH_HEADERS = {"authorization", "x-api-key", "x-goog-api-key"}
REQUEST_ID_HEADER = "X-Request-Id"


@dataclass
class GatewayContext:
    request_id: str
    start_time: float
    log_id: int
    return_response: bool

    def latency_ms(self) -> int:
        return int((time.monotonic() - self.start_time) * 1000)


@dataclass
class ErrorDecision:
    status_code: int
    error_body: str
    retryable: bool
    freeze: bool
    allow_passthrough: bool
    response_headers: Optional[Dict[str, str]] = None
    media_type: Optional[str] = None


def _with_request_id(headers: Optional[Dict[str, str]], request_id: str) -> Dict[str, str]:
    merged = dict(headers) if headers else {}
    merged[REQUEST_ID_HEADER] = request_id
    return merged


def _append_query(url: str, query_string: str) -> str:
    if not query_string:
        return url
    parsed = urllib.parse.urlsplit(url)
    combined_query = parsed.query
    if combined_query:
        combined_query = f"{combined_query}&{query_string}"
    else:
        combined_query = query_string
    return urllib.parse.urlunsplit(
        (parsed.scheme, parsed.netloc, parsed.path, combined_query, parsed.fragment)
    )


def _classify_status_error(
    status_code: int,
    body: Optional[str],
    *,
    response_headers: Optional[Dict[str, str]] = None,
    media_type: Optional[str] = None,
) -> ErrorDecision:
    error_body = body or ""
    if 400 <= status_code < 500:
        return ErrorDecision(
            status_code=status_code,
            error_body=error_body,
            retryable=False,
            freeze=False,
            allow_passthrough=True,
            response_headers=response_headers,
            media_type=media_type,
        )
    return ErrorDecision(
        status_code=status_code,
        error_body=error_body,
        retryable=True,
        freeze=True,
        allow_passthrough=True,
        response_headers=response_headers,
        media_type=media_type,
    )


def _extract_exception_payload(
    exc: Exception,
) -> tuple[Optional[str], Optional[str], Optional[Dict[str, str]]]:
    response = getattr(exc, "response", None)
    if isinstance(response, httpx.Response):
        host = ""
        try:
            host = response.request.url.host or ""
        except Exception:
            host = ""
        if host and host.endswith("litellm.ai"):
            return None, None, None
        return response.text, response.headers.get("content-type"), _response_headers(response.headers)
    if response is not None:
        if isinstance(response, (bytes, bytearray)):
            return response.decode("utf-8", errors="replace"), None, None
        if isinstance(response, str):
            return response, None, None
        if isinstance(response, dict):
            return json.dumps(response, ensure_ascii=True), "application/json", None
        if isinstance(response, list):
            return json.dumps(response, ensure_ascii=True), "application/json", None

    body = getattr(exc, "body", None)
    if isinstance(body, (bytes, bytearray)):
        return body.decode("utf-8", errors="replace"), None, None
    if isinstance(body, str):
        return body, None, None
    if isinstance(body, dict):
        return json.dumps(body, ensure_ascii=True), "application/json", None
    if isinstance(body, list):
        return json.dumps(body, ensure_ascii=True), "application/json", None
    return None, None, None


def _classify_exception(exc: Exception) -> ErrorDecision:
    status_code = getattr(exc, "status_code", None) or getattr(exc, "status", None)
    if isinstance(status_code, str):
        try:
            status_code = int(status_code)
        except ValueError:
            status_code = None
    if isinstance(exc, httpx.TimeoutException):
        status_code = 504
    if status_code is None:
        status_code = 502
    error_body, media_type, response_headers = _extract_exception_payload(exc)
    allow_passthrough = error_body is not None
    if error_body is None:
        error_body = str(exc)
        allow_passthrough = False
    if 400 <= status_code < 500:
        return ErrorDecision(
            status_code=status_code,
            error_body=error_body,
            retryable=False,
            freeze=False,
            allow_passthrough=allow_passthrough,
            response_headers=response_headers,
            media_type=media_type,
        )
    return ErrorDecision(
        status_code=status_code,
        error_body=error_body,
        retryable=True,
        freeze=True,
        allow_passthrough=allow_passthrough,
        response_headers=response_headers,
        media_type=media_type,
    )


def _finalize_error(
    ctx: GatewayContext,
    *,
    status_code: int,
    error_body: str,
    provider_id: Optional[int],
    model_alias: Optional[str],
    model_id: Optional[str],
    translated: bool,
    protocol: str,
    response_headers: Optional[Dict[str, str]] = None,
    media_type: Optional[str] = None,
    error_code: Optional[str] = None,
    allow_passthrough: bool = False,
) -> Dict[str, Any]:
    if allow_passthrough:
        normalized_body = error_body if error_body is not None else ""
        normalized_media_type = media_type
    else:
        normalized_body, normalized_media_type = normalize_error_body(
            protocol,
            status_code,
            error_body,
            content_type=media_type,
            code=error_code,
            allow_passthrough=False,
        )
    if response_headers and not allow_passthrough:
        response_headers = {
            key: value
            for key, value in response_headers.items()
            if key.lower() != "content-type"
        }
    latency_ms = ctx.latency_ms()
    log_service.update_log(
        ctx.log_id,
        {
            "status": "error",
            "response_body": normalized_body,
            "latency_ms": latency_ms,
            "provider_id": provider_id,
            "model_alias": model_alias,
            "model_id": model_id,
            "translated": translated,
        },
    )

    if ctx.return_response:
        return {
            "response": Response(
                content=normalized_body,
                status_code=status_code,
                headers=_with_request_id(response_headers, ctx.request_id),
                media_type=normalized_media_type,
            ),
            "status": "error",
            "latency_ms": latency_ms,
            "first_token_ms": None,
            "error": normalized_body,
        }

    return {
        "status": "error",
        "latency_ms": latency_ms,
        "first_token_ms": None,
        "error": normalized_body,
    }


async def handle_gateway_request(
    path: str,
    method: str,
    headers: Dict[str, str],
    body_bytes: bytes,
    query_string: Optional[str] = None,
) -> Response:
    result = await _process_gateway_request(
        path=path,
        method=method,
        headers=headers,
        body_bytes=body_bytes,
        query_string=query_string,
        return_response=True,
    )
    return result["response"]


async def run_gateway_request(
    path: str,
    method: str,
    headers: Dict[str, str],
    json_body: Dict[str, Any],
    query_string: Optional[str] = None,
) -> Dict[str, Any]:
    body_bytes = json.dumps(json_body).encode("utf-8")
    result = await _process_gateway_request(
        path=path,
        method=method,
        headers=headers,
        body_bytes=body_bytes,
        query_string=query_string,
        return_response=False,
    )
    return {
        "status": result["status"],
        "latency_ms": result["latency_ms"],
        "first_token_ms": result["first_token_ms"],
        "error": result.get("error"),
    }


def _parse_stream_flag(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False
    value = payload.get("stream")
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value == 1
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes"}
    return False


def _extract_model_from_path(path: str) -> Optional[tuple[str, str, str]]:
    for version_prefix in ("/v1beta/", "/v1/"):
        if path.startswith(version_prefix):
            rest = urllib.parse.unquote(path[len(version_prefix) :])
            if ":" in rest:
                model_part, suffix = rest.split(":", 1)
                return version_prefix, model_part, f":{suffix}"
            if version_prefix == "/v1beta/" and rest.startswith("models/") and rest != "models/":
                return version_prefix, rest, ""
            break

    marker = "/v1/models/"
    idx = path.find(marker)
    if idx != -1:
        start = idx + len(marker)
        rest = path[start:]
        if not rest:
            return None
        parts = rest.split("/", 1)
        model_part = parts[0]
        suffix = f"/{parts[1]}" if len(parts) > 1 else ""
        return path[:start], urllib.parse.unquote(model_part), suffix

    return None


def _is_gemini_stream_path(path: str) -> bool:
    lower = path.lower()
    return lower.endswith(":streamgeneratecontent") or lower.endswith("%3astreamgeneratecontent")


def _model_match_candidates(model_name: str, protocol: str) -> list[str]:
    if not model_name:
        return []
    if protocol != "gemini":
        return [model_name]
    candidates = [model_name]
    if model_name.startswith("models/"):
        trimmed = model_name[len("models/") :]
        if trimmed:
            candidates.append(trimmed)
    else:
        candidates.append(f"models/{model_name}")
    return list(dict.fromkeys(candidates))


async def _process_gateway_request(
    path: str,
    method: str,
    headers: Dict[str, str],
    body_bytes: bytes,
    query_string: Optional[str],
    return_response: bool,
) -> Dict[str, Any]:
    start_time = time.monotonic()
    request_id = str(uuid.uuid4())
    lower_headers = {k.lower(): v for k, v in headers.items()}
    protocol = detect_protocol(path, lower_headers)
    query_string = query_string or ""

    if not is_authorized(lower_headers):
        error_body = format_error_body(protocol, 401, "unauthorized", code="unauthorized")
        if return_response:
            return {
                "response": Response(
                    content=error_body,
                    status_code=401,
                    headers=_with_request_id(None, request_id),
                    media_type="application/json",
                ),
                "status": "error",
                "latency_ms": None,
                "first_token_ms": None,
                "error": error_body,
            }
        return {
            "status": "error",
            "latency_ms": None,
            "first_token_ms": None,
            "error": error_body,
        }

    json_body = None
    json_error = None
    if body_bytes:
        try:
            json_body = json.loads(body_bytes.decode("utf-8"))
        except json.JSONDecodeError:
            if "application/json" in lower_headers.get("content-type", ""):
                json_error = "invalid json"

    stream = _parse_stream_flag(json_body)
    if protocol == "gemini" and _is_gemini_stream_path(path):
        stream = True

    requested_model = None
    if isinstance(json_body, dict):
        requested_model = json_body.get("model")
    path_model = _extract_model_from_path(path)
    if protocol == "gemini" and path_model:
        requested_model = path_model[1]
    elif not requested_model and path_model:
        requested_model = path_model[1]

    log_entry = log_service.create_log(
        {
            "request_id": request_id,
            "model_id": requested_model,
            "endpoint": path,
            "request_body": body_bytes.decode("utf-8", errors="replace") if body_bytes else None,
            "status": "pending",
            "is_streaming": stream,
        }
    )
    ctx = GatewayContext(
        request_id=request_id,
        start_time=start_time,
        log_id=log_entry["id"],
        return_response=return_response,
    )
    if json_error:
        return _finalize_error(
            ctx,
            status_code=400,
            error_body=json_error,
            provider_id=None,
            model_alias=None,
            model_id=None,
            translated=False,
            protocol=protocol,
            error_code="invalid_json",
        )

    try:
        providers = provider_service.list_providers()
        last_error = None
        last_error_status = None
        last_provider_id = None
        last_model_alias = None
        last_model_id = None
        last_translated = False
        last_error_headers = None
        last_error_media_type = None
        last_error_allow_passthrough = False
        model_match_seen = False

        for provider in providers:
            if not provider.get("enabled"):
                continue

            match = None
            if requested_model:
                for candidate in _model_match_candidates(requested_model, protocol):
                    match = provider_service.find_model_match(provider["id"], candidate)
                    if match:
                        model_match_seen = True
                        break

            if freeze_manager.is_frozen(provider["id"]):
                continue

            translated = False
            request_body_bytes = body_bytes
            request_path = path
            request_json = json_body

            model_alias = None
            model_id = None
            if protocol == "openai":
                if not requested_model:
                    return _finalize_error(
                        ctx,
                        status_code=400,
                        error_body="missing model",
                        provider_id=provider["id"],
                        model_alias=None,
                        model_id=None,
                        translated=translated,
                        protocol=protocol,
                        error_code="missing_model",
                    )
                if not match:
                    continue
                model_alias = match.get("alias")
                model_id = match.get("model_id")
                if isinstance(request_json, dict):
                    model_name = request_json.get("model")
                    if model_name:
                        request_json = dict(request_json)
                        request_json["model"] = model_id
                        request_body_bytes = json.dumps(request_json).encode("utf-8")
                    elif path_model:
                        prefix, path_model_name, suffix = path_model
                        if model_id and model_id != path_model_name:
                            encoded_model_id = urllib.parse.quote(model_id, safe=":/")
                            request_path = f"{prefix}{encoded_model_id}{suffix}"
                elif path_model:
                    prefix, path_model_name, suffix = path_model
                    if model_id and model_id != path_model_name:
                        encoded_model_id = urllib.parse.quote(model_id, safe=":/")
                        request_path = f"{prefix}{encoded_model_id}{suffix}"
            else:
                if requested_model and not match:
                    continue
                if match:
                    model_id = match.get("model_id") or requested_model
                elif requested_model:
                    model_id = requested_model

            if (
                protocol == "openai"
                and provider.get("type") != "openai"
                and provider.get("translate_enabled")
            ):
                if not isinstance(request_json, dict):
                    return _finalize_error(
                        ctx,
                        status_code=400,
                        error_body="translation requires json body",
                        provider_id=provider["id"],
                        model_alias=model_alias,
                        model_id=model_id,
                        translated=translated,
                        protocol=protocol,
                        error_code="invalid_request",
                    )

                translated = True
                model_name = request_json.get("model")
                if not model_name:
                    return _finalize_error(
                        ctx,
                        status_code=400,
                        error_body="missing model for translation",
                        provider_id=provider["id"],
                        model_alias=model_alias,
                        model_id=model_id,
                        translated=translated,
                        protocol=protocol,
                        error_code="missing_model",
                    )

                try:
                    response = await litellm_completion(
                        provider=provider,
                        request_json=request_json,
                        stream=stream,
                    )
                except Exception as exc:
                    decision = _classify_exception(exc)
                    if decision.freeze:
                        freeze_manager.freeze(provider["id"])
                    if not decision.retryable:
                        return _finalize_error(
                            ctx,
                            status_code=decision.status_code,
                            error_body=decision.error_body,
                            provider_id=provider["id"],
                            model_alias=model_alias,
                            model_id=model_id,
                            translated=translated,
                            protocol=protocol,
                            response_headers=decision.response_headers,
                            media_type=decision.media_type,
                            allow_passthrough=decision.allow_passthrough,
                        )
                    last_error = decision.error_body
                    last_error_status = decision.status_code
                    last_provider_id = provider["id"]
                    last_model_alias = model_alias
                    last_model_id = model_id
                    last_translated = translated
                    last_error_headers = decision.response_headers
                    last_error_media_type = decision.media_type
                    last_error_allow_passthrough = decision.allow_passthrough
                    continue

                if stream:
                    streaming = await litellm_streaming_response(
                        response=response,
                        provider_id=provider["id"],
                        log_id=log_entry["id"],
                        model_alias=model_alias,
                        model_id=model_id,
                        translated=translated,
                        start_time=start_time,
                        protocol=protocol,
                        extra_headers=_with_request_id(None, ctx.request_id),
                    )
                    if ctx.return_response:
                        return {
                            "response": streaming,
                            "status": "success",
                            "latency_ms": None,
                            "first_token_ms": None,
                        }

                    return {
                        "status": "success",
                        "latency_ms": None,
                        "first_token_ms": None,
                    }

                latency_ms = ctx.latency_ms()
                response_payload = litellm_service._response_to_dict(response)
                response_body = json.dumps(response_payload, ensure_ascii=True)
                usage_stats = litellm_service._extract_usage(
                    response_payload if isinstance(response_payload, dict) else {}
                )
                log_service.update_log(
                    log_entry["id"],
                    {
                        "status": "success",
                        "response_body": response_body,
                        "latency_ms": latency_ms,
                        "provider_id": provider["id"],
                        "model_alias": model_alias,
                        "model_id": model_id,
                        "translated": translated,
                        **usage_stats,
                    },
                )
                if ctx.return_response:
                    return {
                        "response": Response(
                            content=response_body.encode("utf-8"),
                            status_code=200,
                            headers=_with_request_id(None, ctx.request_id),
                            media_type="application/json",
                        ),
                        "status": "success",
                        "latency_ms": latency_ms,
                        "first_token_ms": None,
                    }

                return {
                    "status": "success",
                    "latency_ms": latency_ms,
                    "first_token_ms": None,
                }

            url = join_base_url(provider["base_url"], request_path)
            url = _append_query(url, query_string)
            forward_headers = _filtered_headers(headers)
            forward_headers.update(_provider_auth_headers(provider))
            if REQUEST_ID_HEADER not in forward_headers:
                forward_headers[REQUEST_ID_HEADER] = ctx.request_id
            if isinstance(request_json, dict):
                has_content_type = any(
                    header_key.lower() == "content-type" for header_key in forward_headers
                )
                if not has_content_type:
                    forward_headers["Content-Type"] = "application/json"

            try:
                timeout = httpx.Timeout(30.0, read=None) if stream else httpx.Timeout(30.0)
                if stream:
                    client = httpx.AsyncClient(timeout=timeout)
                    stream_cm = client.stream(
                        method,
                        url,
                        headers=forward_headers,
                        content=request_body_bytes,
                    )
                    response = await stream_cm.__aenter__()
                    if response.status_code >= 400:
                        body = await response.aread()
                        await stream_cm.__aexit__(None, None, None)
                        await client.aclose()
                        body_text = body.decode("utf-8", errors="replace")
                        response_headers = _response_headers(response.headers)
                        decision = _classify_status_error(
                            response.status_code,
                            body_text,
                            response_headers=response_headers,
                            media_type=response.headers.get("content-type"),
                        )
                        if not decision.retryable:
                            return _finalize_error(
                                ctx,
                                status_code=decision.status_code,
                                error_body=decision.error_body,
                                provider_id=provider["id"],
                                model_alias=model_alias,
                                model_id=model_id,
                                translated=translated,
                                protocol=protocol,
                                response_headers=decision.response_headers,
                                media_type=decision.media_type,
                                allow_passthrough=decision.allow_passthrough,
                            )

                        if decision.freeze:
                            freeze_manager.freeze(provider["id"])
                        last_error = decision.error_body
                        last_error_status = decision.status_code
                        last_provider_id = provider["id"]
                        last_model_alias = model_alias
                        last_model_id = model_id
                        last_translated = translated
                        last_error_headers = decision.response_headers
                        last_error_media_type = decision.media_type
                        last_error_allow_passthrough = decision.allow_passthrough
                        continue

                    result = await _stream_response(
                        response=response,
                        stream_cm=stream_cm,
                        client=client,
                        provider_id=provider["id"],
                        log_id=log_entry["id"],
                        model_alias=model_alias,
                        model_id=model_id,
                        translated=translated,
                        start_time=start_time,
                        protocol=protocol,
                        extra_headers=_with_request_id(None, ctx.request_id),
                    )
                    if ctx.return_response:
                        return {
                            "response": result,
                            "status": "success",
                            "latency_ms": None,
                            "first_token_ms": None,
                        }

                    return {
                        "status": "success",
                        "latency_ms": None,
                        "first_token_ms": None,
                    }

                async with httpx.AsyncClient(timeout=timeout) as client:
                    response = await client.request(
                        method,
                        url,
                        headers=forward_headers,
                        content=request_body_bytes,
                    )
            except httpx.RequestError as exc:
                decision = _classify_exception(exc)
                if decision.freeze:
                    freeze_manager.freeze(provider["id"])
                if not decision.retryable:
                    return _finalize_error(
                        ctx,
                        status_code=decision.status_code,
                        error_body=decision.error_body,
                        provider_id=provider["id"],
                        model_alias=model_alias,
                        model_id=model_id,
                        translated=translated,
                        protocol=protocol,
                        response_headers=decision.response_headers,
                        media_type=decision.media_type,
                        allow_passthrough=decision.allow_passthrough,
                    )
                last_error = decision.error_body
                last_error_status = decision.status_code
                last_provider_id = provider["id"]
                last_model_alias = model_alias
                last_model_id = model_id
                last_translated = translated
                last_error_headers = decision.response_headers
                last_error_media_type = decision.media_type
                last_error_allow_passthrough = decision.allow_passthrough
                continue

            if response.status_code >= 400:
                response_headers = _response_headers(response.headers)
                decision = _classify_status_error(
                    response.status_code,
                    response.text,
                    response_headers=response_headers,
                    media_type=response.headers.get("content-type"),
                )
                if not decision.retryable:
                    return _finalize_error(
                        ctx,
                        status_code=decision.status_code,
                        error_body=decision.error_body,
                        provider_id=provider["id"],
                        model_alias=model_alias,
                        model_id=model_id,
                        translated=translated,
                        protocol=protocol,
                        response_headers=decision.response_headers,
                        media_type=decision.media_type,
                        allow_passthrough=decision.allow_passthrough,
                    )

                if decision.freeze:
                    freeze_manager.freeze(provider["id"])
                last_error = decision.error_body
                last_error_status = decision.status_code
                last_provider_id = provider["id"]
                last_model_alias = model_alias
                last_model_id = model_id
                last_translated = translated
                last_error_headers = decision.response_headers
                last_error_media_type = decision.media_type
                last_error_allow_passthrough = decision.allow_passthrough
                continue

            latency_ms = ctx.latency_ms()
            usage_stats = {}
            try:
                response_json = response.json()
            except ValueError:
                response_json = None
            if isinstance(response_json, dict):
                usage_stats = _extract_usage(response_json)

            log_service.update_log(
                log_entry["id"],
                {
                    "status": "success",
                    "response_body": response.text,
                    "latency_ms": latency_ms,
                    "provider_id": provider["id"],
                    "model_alias": model_alias,
                    "model_id": model_id,
                    "translated": translated,
                    **usage_stats,
                },
            )

            if ctx.return_response:
                return {
                    "response": Response(
                        content=response.content,
                        status_code=response.status_code,
                        headers=_with_request_id(
                            _response_headers(response.headers),
                            ctx.request_id,
                        ),
                        media_type=response.headers.get("content-type"),
                    ),
                    "status": "success",
                    "latency_ms": latency_ms,
                    "first_token_ms": None,
                }

            return {
                "status": "success",
                "latency_ms": latency_ms,
                "first_token_ms": None,
            }

        if requested_model and not model_match_seen:
            return _finalize_error(
                ctx,
                status_code=400,
                error_body=f"model not found: {requested_model}",
                provider_id=None,
                model_alias=None,
                model_id=requested_model,
                translated=False,
                protocol=protocol,
                error_code="model_not_found",
            )

        final_error = last_error or "no providers available"
        return _finalize_error(
            ctx,
            status_code=last_error_status or 503,
            error_body=final_error,
            provider_id=last_provider_id,
            model_alias=last_model_alias,
            model_id=last_model_id,
            translated=last_translated,
            protocol=protocol,
            response_headers=last_error_headers,
            media_type=last_error_media_type,
            allow_passthrough=last_error_allow_passthrough,
            error_code=None if last_error else "no_providers",
        )
    except Exception as exc:
        return _finalize_error(
            ctx,
            status_code=500,
            error_body=str(exc),
            provider_id=None,
            model_alias=None,
            model_id=requested_model,
            translated=False,
            protocol=protocol,
            error_code="internal_error",
        )


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


def _extract_usage_from_stream(stream_text: str) -> Dict[str, Optional[int]]:
    if not stream_text:
        return {}

    usage_source = None
    for line in stream_text.splitlines():
        stripped = line.lstrip()
        if not stripped.startswith("data:"):
            continue
        payload = stripped[5:].strip()
        if not payload or payload == "[DONE]":
            continue
        try:
            parsed = json.loads(payload)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict) and ("usage" in parsed or "usageMetadata" in parsed or "usage_metadata" in parsed):
            usage_source = parsed

    if usage_source is None:
        try:
            parsed = json.loads(stream_text)
        except json.JSONDecodeError:
            parsed = None
        if isinstance(parsed, dict) and ("usage" in parsed or "usageMetadata" in parsed or "usage_metadata" in parsed):
            usage_source = parsed

    return _extract_usage(usage_source) if usage_source else {}


def _try_json_body(raw_body: str) -> str:
    stripped = raw_body.strip()
    if not stripped:
        return ""
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError:
        return ""
    return json.dumps(parsed, ensure_ascii=True)


def _filtered_headers(headers: Dict[str, str]) -> Dict[str, str]:
    filtered = {}
    for key, value in headers.items():
        key_lower = key.lower()
        if key_lower in HOP_BY_HOP_HEADERS or key_lower in AUTH_HEADERS:
            continue
        filtered[key] = value
    return filtered


def _provider_auth_headers(provider: dict) -> Dict[str, str]:
    api_key = provider["api_key"]
    if provider["type"] == "anthropic":
        return {
            "Authorization": f"Bearer {api_key}",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        }
    if provider["type"] == "gemini":
        return {"x-goog-api-key": api_key}
    return {"Authorization": f"Bearer {api_key}"}


def _response_headers(headers: httpx.Headers) -> Dict[str, str]:
    filtered = {}
    for key, value in headers.items():
        key_lower = key.lower()
        if key_lower in HOP_BY_HOP_HEADERS or key_lower == "content-encoding":
            continue
        filtered[key] = value
    return filtered


async def _stream_response(
    response: httpx.Response,
    stream_cm: Optional[object],
    client: Optional[httpx.AsyncClient],
    provider_id: int,
    log_id: int,
    model_alias: Optional[str],
    model_id: Optional[str],
    translated: bool,
    start_time: float,
    protocol: str,
    extra_headers: Optional[Dict[str, str]] = None,
) -> StreamingResponse:
    chunks: list[bytes] = []
    first_chunk_time: Optional[float] = None

    async def generator():
        nonlocal first_chunk_time
        completed = False
        error_message: Optional[str] = None
        try:
            async for chunk in response.aiter_bytes():
                if first_chunk_time is None:
                    first_chunk_time = time.monotonic()
                chunks.append(chunk)
                yield chunk
            completed = True
        except (httpx.ReadError, httpx.StreamError, httpx.ReadTimeout, httpx.RemoteProtocolError) as exc:
            error_message = str(exc)
            if not chunks:
                frames = build_stream_error_frames(protocol, 502, error_message)
                chunks.extend(frames)
                for frame in frames:
                    yield frame
        except asyncio.CancelledError:
            error_message = "client disconnected"
        except Exception as exc:
            error_message = str(exc)
            if not chunks:
                frames = build_stream_error_frames(protocol, 502, error_message)
                chunks.extend(frames)
                for frame in frames:
                    yield frame
        finally:
            if stream_cm is not None:
                await stream_cm.__aexit__(None, None, None)
            else:
                await response.aclose()
            if client is not None:
                await client.aclose()

        latency_ms = int((time.monotonic() - start_time) * 1000)
        first_token_ms = (
            int((first_chunk_time - start_time) * 1000) if first_chunk_time else None
        )
        is_success = completed
        response_body_raw = b"".join(chunks).decode("utf-8", errors="replace")
        usage_stats = _extract_usage_from_stream(response_body_raw)
        if error_message and not is_success:
            response_body = format_error_body(protocol, 502, error_message)
        else:
            parsed_chunks = collect_stream_chunks(response_body_raw)
            final_payload = aggregate_stream_chunks(parsed_chunks, protocol)
            if final_payload is not None:
                response_body = json.dumps(final_payload, ensure_ascii=True)
            else:
                response_body = _try_json_body(response_body_raw)
        log_service.update_log(
            log_id,
            {
                "status": "success" if is_success else "error",
                "response_body": response_body,
                "latency_ms": latency_ms,
                "first_token_ms": first_token_ms,
                "provider_id": provider_id,
                "model_alias": model_alias,
                "model_id": model_id,
                "translated": translated,
                **usage_stats,
            },
        )

        if error_message is not None and not is_success:
            return

    response_headers = _response_headers(response.headers)
    if extra_headers:
        response_headers.update(extra_headers)
    return StreamingResponse(
        generator(),
        status_code=response.status_code,
        headers=response_headers,
        media_type=response.headers.get("content-type"),
    )
