from __future__ import annotations

from typing import List, Optional
import time
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request

from ..schemas import (
    ProviderCreate,
    ProviderOut,
    ProviderWithModels,
    ProviderUpdate,
    ProviderModelCreate,
    ProviderModelOut,
    ProviderModelUpdate,
    ModelSyncResult,
    ModelTestResponse,
    ConfigItem,
    LogEntryOut,
    MetricsSummary,
)
from ..services import provider_service, log_service, config_service
from ..services.runtime import freeze_manager
from ..services import litellm_service
from ..services.litellm_service import litellm_completion
from ..services.auth import is_authorized
from ..services.url_service import join_base_url

router = APIRouter(prefix="/admin")


def require_admin(request: Request) -> None:
    headers = {k.lower(): v for k, v in request.headers.items()}
    if not is_authorized(headers):
        raise HTTPException(status_code=401, detail="unauthorized")


def _normalize_provider(provider: dict) -> dict:
    provider["enabled"] = bool(provider["enabled"])
    provider["translate_enabled"] = bool(provider["translate_enabled"])
    provider["frozen"] = freeze_manager.is_frozen(provider["id"])
    provider["freeze_remaining_seconds"] = freeze_manager.remaining_seconds(provider["id"])
    return provider


@router.get("/providers", response_model=List[ProviderOut])
async def list_providers(limit: int = 50, offset: int = 0, _: None = Depends(require_admin)):
    providers = provider_service.list_providers(limit=limit, offset=offset)
    return [_normalize_provider(provider) for provider in providers]


@router.get("/providers/with-models", response_model=List[ProviderWithModels])
async def list_providers_with_models(
    limit: int = 50, offset: int = 0, _: None = Depends(require_admin)
):
    providers = provider_service.list_providers(limit=limit, offset=offset)
    provider_ids = [provider["id"] for provider in providers]
    models_by_provider = provider_service.list_provider_models_by_provider_ids(provider_ids)

    result = []
    for provider in providers:
        normalized = _normalize_provider(provider)
        normalized["models"] = models_by_provider.get(provider["id"], [])
        result.append(normalized)
    return result


@router.post("/providers", response_model=ProviderOut)
async def create_provider(payload: ProviderCreate, _: None = Depends(require_admin)):
    provider = provider_service.create_provider(payload.model_dump())
    return _normalize_provider(provider)


@router.patch("/providers/{provider_id}", response_model=ProviderOut)
async def update_provider(provider_id: int, payload: ProviderUpdate, _: None = Depends(require_admin)):
    update_payload = payload.model_dump()
    provider = provider_service.update_provider(provider_id, update_payload)
    if not provider:
        raise HTTPException(status_code=404, detail="provider not found")
    if update_payload.get("enabled") is True:
        freeze_manager.unfreeze(provider_id)
    return _normalize_provider(provider)


@router.delete("/providers/{provider_id}")
async def delete_provider(provider_id: int, _: None = Depends(require_admin)):
    deleted = provider_service.delete_provider(provider_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="provider not found")
    freeze_manager.unfreeze(provider_id)
    return {"deleted": True}


@router.get("/providers/{provider_id}/models", response_model=List[ProviderModelOut])
async def list_models(provider_id: int, _: None = Depends(require_admin)):
    models = provider_service.list_provider_models(provider_id)
    return models


@router.post("/providers/{provider_id}/models", response_model=ProviderModelOut)
async def create_model(provider_id: int, payload: ProviderModelCreate, _: None = Depends(require_admin)):
    model = provider_service.create_provider_model(provider_id, payload.model_dump())
    return model


@router.patch("/providers/{provider_id}/models/{model_id}", response_model=ProviderModelOut)
async def update_model(provider_id: int, model_id: int, payload: ProviderModelUpdate, _: None = Depends(require_admin)):
    model = provider_service.update_provider_model(model_id, payload.model_dump(exclude_unset=True))
    if not model:
        raise HTTPException(status_code=404, detail="model not found")
    if model["provider_id"] != provider_id:
        raise HTTPException(status_code=400, detail="provider mismatch")
    return model


@router.delete("/providers/{provider_id}/models/{model_id}")
async def delete_model(provider_id: int, model_id: int, _: None = Depends(require_admin)):
    model = provider_service.get_provider_model(model_id)
    if not model or model["provider_id"] != provider_id:
        raise HTTPException(status_code=404, detail="model not found")
    deleted = provider_service.delete_provider_model(model_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="model not found")
    return {"deleted": True}


@router.post("/providers/{provider_id}/models/sync", response_model=ModelSyncResult)
async def sync_models(provider_id: int, _: None = Depends(require_admin)):
    provider = provider_service.get_provider(provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="provider not found")

    base_url = provider["base_url"]
    if not base_url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="base_url must start with http:// or https://")
    if provider["type"] in ("openai", "anthropic"):
        url = join_base_url(base_url, "/v1/models")
    else:
        url = join_base_url(base_url, "/v1beta/models")

    headers = _provider_auth_headers(provider)
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.get(url, headers=headers)
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)

    data = resp.json()
    models = []
    if provider["type"] in ("openai", "anthropic"):
        for item in data.get("data", []):
            model_id = item.get("id")
            if model_id:
                models.append(model_id)
    else:
        for item in data.get("models", []):
            name = item.get("name")
            if name:
                models.append(name.replace("models/", ""))

    created_models = []
    existing = {m["model_id"] for m in provider_service.list_provider_models(provider_id)}
    for model_id in models:
        if model_id in existing:
            continue
        created = provider_service.create_provider_model(
            provider_id,
            {"model_id": model_id, "alias": None},
        )
        created_models.append(created)

    return {"count": len(created_models), "models": created_models}


@router.post("/providers/models/preview")
async def preview_models(payload: dict, _: None = Depends(require_admin)):
    provider_type = payload.get("type")
    base_url = payload.get("base_url") or ""
    api_key = payload.get("api_key")

    if provider_type not in ("openai", "anthropic", "gemini"):
        raise HTTPException(status_code=400, detail="invalid provider type")
    if not base_url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="base_url must start with http:// or https://")
    if not api_key:
        raise HTTPException(status_code=400, detail="api_key is required")

    if provider_type in ("openai", "anthropic"):
        url = join_base_url(base_url, "/v1/models")
    else:
        url = join_base_url(base_url, "/v1beta/models")

    headers = _provider_auth_headers(
        {"type": provider_type, "api_key": api_key, "base_url": base_url}
    )
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.get(url, headers=headers)
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)

    data = resp.json()
    models = []
    if provider_type in ("openai", "anthropic"):
        for item in data.get("data", []):
            model_id = item.get("id")
            if model_id:
                models.append(model_id)
    else:
        for item in data.get("models", []):
            name = item.get("name")
            if name:
                models.append(name.replace("models/", ""))

    return {"count": len(models), "models": models}


@router.post("/providers/{provider_id}/models/{model_id}/test", response_model=ModelTestResponse)
async def test_model(provider_id: int, model_id: int, _: None = Depends(require_admin)):
    model = provider_service.get_provider_model(model_id)
    if not model or model["provider_id"] != provider_id:
        raise HTTPException(status_code=404, detail="model not found")

    provider = provider_service.get_provider(provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="provider not found")

    start_time = time.monotonic()
    try:
        payload = {
            "model": model["model_id"],
            "messages": [{"role": "user", "content": "hi"}],
            "max_tokens": 64,
        }
        if provider["type"] in ("openai", "anthropic"):
            url = _build_test_url(provider)
            headers = _provider_auth_headers(provider)
            headers["Content-Type"] = "application/json"
            if provider["type"] == "anthropic":
                headers["anthropic-version"] = "2023-06-01"
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code >= 400:
                raise RuntimeError(resp.text)
            response_payload = resp.json()
        else:
            response = await litellm_completion(
                provider=provider,
                request_json=payload,
                stream=False,
            )
            response_payload = litellm_service._response_to_dict(response)
        latency_ms = int((time.monotonic() - start_time) * 1000)
        usage = litellm_service._extract_usage(response_payload)
        tokens_out = usage.get("tokens_out")
        tps = None
        if tokens_out is not None and latency_ms > 0:
            tps = tokens_out / (latency_ms / 1000)
        provider_service.update_provider_test_performance(
            provider_id,
            last_tested_at=datetime.now(timezone.utc).isoformat(),
            last_ftl_ms=latency_ms,
            last_tps=tps,
        )
        return {
            "tps": tps,
            "first_token_ms": latency_ms,
            "latency_ms": latency_ms,
            "status": "success",
            "error": None,
        }
    except Exception as exc:
        latency_ms = int((time.monotonic() - start_time) * 1000)
        return {
            "tps": None,
            "first_token_ms": None,
            "latency_ms": latency_ms,
            "status": "error",
            "error": str(exc),
        }


@router.get("/logs", response_model=List[LogEntryOut])
async def list_logs(
    limit: int = 20,
    offset: int = 0,
    include_bodies: bool = True,
    status: Optional[str] = None,
    _: None = Depends(require_admin),
):
    logs = log_service.list_logs(
        limit=limit,
        offset=offset,
        include_bodies=include_bodies,
        status=status,
    )
    for log in logs:
        log["is_streaming"] = bool(log["is_streaming"])
        log["translated"] = bool(log["translated"])
    return logs


@router.get("/logs/{log_id}", response_model=LogEntryOut)
async def get_log(log_id: int, _: None = Depends(require_admin)):
    log = log_service.get_log(log_id)
    if not log:
        raise HTTPException(status_code=404, detail="log not found")
    log["is_streaming"] = bool(log["is_streaming"])
    log["translated"] = bool(log["translated"])
    return log


@router.get("/metrics/summary", response_model=MetricsSummary)
async def metrics_summary(_: None = Depends(require_admin)):
    return log_service.metrics_summary()


@router.get("/metrics/providers")
async def metrics_providers(_: None = Depends(require_admin)):
    return log_service.metrics_by_provider()

@router.get("/metrics/top-models")
async def metrics_top_models(limit: int = 10, _: None = Depends(require_admin)):
    return log_service.metrics_top_models(limit=limit)


@router.get("/metrics/top-providers")
async def metrics_top_providers(limit: int = 10, _: None = Depends(require_admin)):
    return log_service.metrics_top_providers(limit=limit)


@router.get("/metrics/by-date")
async def metrics_by_date(limit: int = 10, _: None = Depends(require_admin)):
    return log_service.metrics_by_date(limit=limit)


@router.get("/configs", response_model=List[ConfigItem])
async def list_configs(_: None = Depends(require_admin)):
    return config_service.list_configs()


@router.patch("/configs", response_model=List[ConfigItem])
async def update_configs(payload: List[ConfigItem], _: None = Depends(require_admin)):
    updated = []
    for item in payload:
        updated.append(config_service.set_config(item.key, item.value))
    return updated


def _provider_auth_headers(provider: dict) -> dict:
    api_key = provider["api_key"]
    if provider["type"] == "openai":
        return {"Authorization": f"Bearer {api_key}"}
    if provider["type"] == "anthropic":
        return {
            "Authorization": f"Bearer {api_key}",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        }
    return {"x-goog-api-key": api_key}


def _build_test_url(provider: dict) -> str:
    if provider["type"] == "anthropic":
        return join_base_url(provider["base_url"], "/v1/messages")
    return join_base_url(provider["base_url"], "/v1/chat/completions")
