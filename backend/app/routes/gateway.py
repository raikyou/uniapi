from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Request, Response
from fastapi.responses import FileResponse

from ..services.gateway_service import handle_gateway_request
from ..services.error_format import format_error_body
from ..services import provider_service
from ..services.auth import is_authorized

router = APIRouter()
STATIC_DIR = (Path(__file__).resolve().parent.parent / "static").resolve()


def _apply_query_api_key(headers: dict, request: Request) -> dict:
    api_key = request.query_params.get("key")
    if not api_key:
        return headers
    lower_keys = {key.lower() for key in headers.keys()}
    if {"authorization", "x-api-key", "x-goog-api-key"} & lower_keys:
        return headers
    merged = dict(headers)
    merged["x-goog-api-key"] = api_key
    return merged


def _is_html_request(request: Request) -> bool:
    accept = request.headers.get("accept", "")
    return "text/html" in accept.lower()


def _resolve_static_path(path: str) -> Path | None:
    if not path or not STATIC_DIR.is_dir():
        return None
    candidate = (STATIC_DIR / path.lstrip("/")).resolve()
    if candidate != STATIC_DIR and STATIC_DIR not in candidate.parents:
        return None
    return candidate if candidate.is_file() else None


def _maybe_serve_frontend(path: str, request: Request) -> Response | None:
    if request.method not in {"GET", "HEAD"}:
        return None
    static_path = _resolve_static_path(path)
    if static_path:
        return FileResponse(static_path)
    if _is_html_request(request):
        index_path = STATIC_DIR / "index.html"
        if index_path.is_file():
            return FileResponse(index_path)
    return None


@router.get("/v1/models")
async def list_models(request: Request):
    headers = _apply_query_api_key(
        {k.lower(): v for k, v in request.headers.items()},
        request,
    )
    if not is_authorized(headers):
        error_body = format_error_body("openai", 401, "unauthorized", code="unauthorized")
        return Response(content=error_body, status_code=401, media_type="application/json")

    providers = provider_service.list_providers()
    seen: set[str] = set()
    data = []
    for provider in providers:
        if not provider.get("enabled"):
            continue
        models = provider_service.list_provider_models(provider["id"])
        for model in models:
            model_id = (model.get("alias") or "").strip() or model.get("model_id")
            if not model_id or model_id in seen:
                continue
            seen.add(model_id)
            data.append(
                {
                    "id": model_id,
                    "object": "model",
                    "owned_by": provider.get("name") or "uniapi",
                }
            )

    return {"object": "list", "data": data}


@router.get("/v1beta/models")
async def list_gemini_models(request: Request):
    headers = _apply_query_api_key(
        {k.lower(): v for k, v in request.headers.items()},
        request,
    )
    if not is_authorized(headers):
        error_body = format_error_body("gemini", 401, "unauthorized", code="unauthorized")
        return Response(content=error_body, status_code=401, media_type="application/json")

    providers = provider_service.list_providers()
    seen: set[str] = set()
    models = []
    for provider in providers:
        if not provider.get("enabled"):
            continue
        provider_models = provider_service.list_provider_models(provider["id"])
        for model in provider_models:
            model_id = (model.get("alias") or "").strip() or model.get("model_id")
            if not model_id or model_id in seen:
                continue
            seen.add(model_id)
            models.append({"name": model_id, "displayName": model_id})

    return {"models": models}


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"])
async def gateway_handler(path: str, request: Request):
    static_response = _maybe_serve_frontend(path, request)
    if static_response:
        return static_response
    body = await request.body()
    headers = _apply_query_api_key(dict(request.headers), request)
    return await handle_gateway_request(
        path=f"/{path}",
        method=request.method,
        headers=headers,
        body_bytes=body,
        query_string=request.url.query,
    )
