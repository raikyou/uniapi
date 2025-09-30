from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException, Request, Response
from starlette.responses import StreamingResponse
from starlette.datastructures import Headers, MutableHeaders

from .config import AppConfig, ConfigError, load_config
from .provider_pool import ProviderPool
from .http_client import create_async_client

# Ensure our logs are visible even when the host application (for example uvicorn
# started via CLI) did not configure the root logger for INFO-level output.
logger = logging.getLogger(__name__)
if logging.getLogger().getEffectiveLevel() > logging.INFO and not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(levelname)s: %(message)s"))
    logger.addHandler(handler)
    logger.propagate = False
logger.setLevel(logging.INFO)

HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "content-length",
}


def _extract_model_from_body(body_bytes: bytes, headers: Headers) -> Optional[str]:
    content_type = headers.get("content-type", "").lower()
    if "application/json" not in content_type:
        return None
    if not body_bytes:
        return None
    try:
        payload = json.loads(body_bytes)
    except json.JSONDecodeError:
        return None
    if isinstance(payload, dict):
        model_value = payload.get("model")
        if isinstance(model_value, str):
            return model_value
    return None


def _extract_api_key(headers: Headers) -> Optional[str]:
    api_key = headers.get("x-api-key")
    if api_key:
        return api_key
    authorization = headers.get("authorization")
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() == "bearer" and token:
        return token
    return None


def _clean_headers(headers: Headers, *, skip: Optional[set[str]] = None) -> dict:
    skip_lower = {item.lower() for item in skip} if skip else set()
    skip_lower.update({"authorization", "x-api-key", "x-goog-api-key", "host"})
    filtered = {}
    for key, value in headers.items():
        key_lower = key.lower()
        if key_lower in HOP_BY_HOP_HEADERS:
            continue
        if key_lower in skip_lower:
            continue
        filtered[key] = value
    return filtered


def _determine_auth_header(headers: Headers) -> tuple[str, str]:
    # Prefer explicit API key headers from the client; fall back to authorization scheme.
    for candidate in ("x-goog-api-key", "x-api-key"):
        if headers.get(candidate):
            return candidate, ""

    authorization = headers.get("authorization")
    if authorization:
        scheme, sep, _ = authorization.partition(" ")
        if sep:
            return "Authorization", f"{scheme} "
        return "Authorization", ""

    # Default to Bearer for providers that expect standard API keys.
    return "Authorization", "Bearer "


def _should_stream_response(response: httpx.Response, request: Request) -> bool:
    content_type = response.headers.get("content-type", "").lower()
    streaming_markers = (
        "text/event-stream",
        "application/event-stream",
        "application/x-ndjson",
    )
    if any(marker in content_type for marker in streaming_markers):
        return True

    accept_header = request.headers.get("accept", "").lower()
    expects_stream = any(marker in accept_header for marker in ("text/event-stream", "application/event-stream"))
    if not expects_stream:
        return False

    transfer_encoding = response.headers.get("transfer-encoding", "").lower()
    if "chunked" in transfer_encoding:
        return True
    if "content-length" not in response.headers:
        return True
    return False


def _apply_response_headers(target: MutableHeaders, source: Headers) -> None:
    for key, value in source.items():
        if key.lower() in HOP_BY_HOP_HEADERS:
            continue
        target[key] = value


CONFIG_WATCH_INTERVAL = 2.0


class ProxyEngine:
    def __init__(self, app_config: AppConfig, *, config_path: Optional[Path] = None) -> None:
        self._config = app_config
        self._config_path = config_path.resolve() if config_path else None
        self._pool = ProviderPool(app_config)
        self._client: Optional[httpx.AsyncClient] = None
        self._client_lock = asyncio.Lock()
        self._reload_lock = asyncio.Lock()
        self._config_watch_task: Optional[asyncio.Task[None]] = None
        self._config_watch_stop: Optional[asyncio.Event] = None
        self._config_mtime = self._current_config_mtime()
        self._model_listing_paths = {provider.normalized_models_endpoint() for provider in app_config.providers}

    def _current_config_mtime(self) -> Optional[float]:
        if not self._config_path:
            return None
        try:
            return self._config_path.stat().st_mtime
        except OSError:
            return None

    def _update_model_listing_paths(self, providers: list[ProviderConfig]) -> None:
        self._model_listing_paths = {
            provider.normalized_models_endpoint() for provider in providers
        }

    async def start_config_watcher(self) -> None:
        if self._config_path is None:
            return
        if self._config_watch_task is not None:
            return
        self._config_watch_stop = asyncio.Event()
        self._config_watch_task = asyncio.create_task(self._watch_config_file())

    async def stop_config_watcher(self) -> None:
        if self._config_watch_task is None or self._config_watch_stop is None:
            return
        self._config_watch_stop.set()
        try:
            await self._config_watch_task
        finally:
            self._config_watch_task = None
            self._config_watch_stop = None

    async def _watch_config_file(self) -> None:
        assert self._config_path is not None
        while True:
            event = self._config_watch_stop
            if event is None:
                return
            try:
                await asyncio.wait_for(event.wait(), timeout=CONFIG_WATCH_INTERVAL)
                return
            except asyncio.TimeoutError:
                pass

            mtime = self._current_config_mtime()
            if mtime is None:
                continue
            if self._config_mtime is None or mtime > self._config_mtime:
                await self._handle_config_reload(mtime)

    async def _handle_config_reload(self, new_mtime: float) -> None:
        if self._config_path is None:
            return
        async with self._reload_lock:
            try:
                updated = load_config(self._config_path)
            except ConfigError as exc:
                logger.error("Failed to reload configuration from %s: %s", self._config_path, exc)
                return
            except Exception as exc:  # pragma: no cover - defensive
                logger.error("Unexpected error reloading configuration from %s: %s", self._config_path, exc)
                return

            await self._apply_new_config(updated)
            self._config_mtime = new_mtime

    async def _apply_new_config(self, new_config: AppConfig) -> None:
        if self._config_path:
            logger.info("Applying updated configuration from %s", self._config_path)
        else:
            logger.info("Applying updated configuration")
        await self._pool.shutdown()
        self._pool.rebuild_on_config_change(new_config)
        async with self._client_lock:
            if self._client is not None:
                await self._client.aclose()
                self._client = None
        self._config = new_config
        self._update_model_listing_paths(new_config.providers)
        await self._pool.initialize()
        await self.ensure_client()

    @property
    def pool(self) -> ProviderPool:
        return self._pool

    @property
    def config(self) -> AppConfig:
        return self._config

    def is_model_listing_path(self, path: str) -> bool:
        normalized = path if path.startswith("/") else f"/{path}"
        return normalized in self._model_listing_paths

    async def ensure_client(self) -> httpx.AsyncClient:
        async with self._client_lock:
            if self._client is None:
                self._client = create_async_client(
                    timeout=self._config.preferences.model_timeout,
                    proxy=self._config.preferences.proxy,
                )
            return self._client

    async def close(self) -> None:
        await self.stop_config_watcher()
        async with self._client_lock:
            if self._client is not None:
                await self._client.aclose()
                self._client = None
        await self._pool.shutdown()

    async def dispatch(
        self,
        request: Request,
        *,
        model: Optional[str],
        body_bytes: Optional[bytes] = None,
    ) -> Response:
        candidates = (
            await self._pool.iter_candidates(model)
            if model
            else self._pool.candidates_for_any()
        )
        if not candidates:
            message = (
                f"No providers available for model '{model}'" if model else "No providers available"
            )
            raise HTTPException(status_code=503, detail=message)

        client = await self.ensure_client()
        if body_bytes is None:
            body_bytes = await request.body()

        auth_header_name, auth_value_prefix = _determine_auth_header(request.headers)
        cleaned_headers = _clean_headers(request.headers, skip={auth_header_name})
        query_items = list(request.query_params.multi_items())
        failures: list[str] = []

        for state in candidates:
            provider = state.config
            url = f"{provider.normalized_base_url()}/{request.url.path.lstrip('/')}"
            headers = dict(cleaned_headers)
            headers[auth_header_name] = f"{auth_value_prefix}{provider.api_key}".strip()
            try:
                logger.info(
                    "Dispatching request %s %s to provider %s using model %s",
                    request.method,
                    request.url.path,
                    provider.name,
                    model or "<unspecified>"
                )
                upstream_request = client.build_request(
                    request.method,
                    url,
                    headers=headers,
                    content=body_bytes if body_bytes else None,
                    params=query_items,
                )
                response = await client.send(upstream_request, stream=True)
            except httpx.RequestError as exc:
                reason = f"{type(exc).__name__}: {exc}"
                failures.append(f"{provider.name}: {reason}")
                self._pool.mark_failure(state, reason)
                continue

            streaming_selected = False
            try:
                if response.status_code >= 500 or response.status_code == 429:
                    reason = f"HTTP {response.status_code}"
                    failures.append(f"{provider.name}: {reason}")
                    self._pool.mark_failure(state, reason)
                    continue

                if response.status_code >= 400:
                    # client-side error; propagate immediately without trying other providers
                    payload = await response.aread()
                    preview = payload.decode("utf-8", "ignore")[:400]
                    upstream_url = str(response.request.url)
                    logger.warning(
                        "Provider %s returned client error %s for %s %s (upstream %s); body preview: %s",
                        provider.name,
                        response.status_code,
                        request.method,
                        request.url.path,
                        upstream_url,
                        preview,
                    )
                    return self._build_response(response, content=payload)

                if _should_stream_response(response, request):
                    self._pool.mark_success(state)
                    streaming_selected = True
                    return self._build_streaming_response(response)

                payload = await response.aread()
                self._pool.mark_success(state)
                return self._build_response(response, content=payload)
            finally:
                if not streaming_selected:
                    await response.aclose()

        if failures:
            detail = "; ".join(failures)
        else:
            detail = "All providers failed"
        raise HTTPException(status_code=502, detail=detail)

    @staticmethod
    def _build_response(origin: httpx.Response, *, content: Optional[bytes] = None) -> Response:
        headers = Headers(origin.headers)
        body = origin.content if content is None else content
        response = Response(content=body, status_code=origin.status_code)
        _apply_response_headers(response.headers, headers)
        return response

    @staticmethod
    def _build_streaming_response(origin: httpx.Response) -> StreamingResponse:
        headers = Headers(origin.headers)

        async def iterator():
            try:
                async for chunk in origin.aiter_bytes():
                    yield chunk
            finally:
                await origin.aclose()

        response = StreamingResponse(iterator(), status_code=origin.status_code)
        _apply_response_headers(response.headers, headers)
        return response


def create_app(config_path: str | Path = "config.yaml") -> FastAPI:
    config_path = Path(config_path)
    try:
        config = load_config(config_path)
    except ConfigError as exc:
        logger.error("Failed to load configuration: %s", exc)
        raise

    engine = ProxyEngine(config, config_path=config_path)

    app = FastAPI(title="UniAPI", version="0.1.0")

    @app.on_event("startup")
    async def _startup() -> None:
        await engine.pool.initialize()
        await engine.ensure_client()
        await engine.start_config_watcher()
        logger.info("UniAPI ready with %d providers", len(engine.pool.states))

    @app.on_event("shutdown")
    async def _shutdown() -> None:
        await engine.close()

    @app.middleware("http")
    async def _enforce_api_key(request: Request, call_next):
        if engine.config.api_key:
            provided = _extract_api_key(request.headers)
            if provided != engine.config.api_key:
                raise HTTPException(status_code=401, detail="Invalid or missing API key")
        return await call_next(request)

    def _build_model_entries(models_by_provider: dict[str, list[str]]) -> list[dict[str, object]]:
        entries: list[dict[str, object]] = []
        for _, models in models_by_provider.items():
            for model_id in models:
                if "*" in model_id or "?" in model_id:
                    continue
                entries.append({"id": model_id, "name": model_id})
        entries.sort(key=lambda item: str(item["id"]))
        return entries

    @app.get("/v1/models")
    async def list_supported_models_v1() -> dict:
        models_by_provider = await engine.pool.list_models()
        entries = _build_model_entries(models_by_provider)
        return {"data": entries}

    @app.api_route("/{full_path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])
    async def universal_proxy(full_path: str, request: Request) -> Response:
        body_bytes = await request.body()
        model = _extract_model_from_body(body_bytes, request.headers) or request.query_params.get("model")
        if model is None and not engine.is_model_listing_path(request.url.path):
            raise HTTPException(status_code=400, detail="Request must include a model field")
        return await engine.dispatch(request, model=model, body_bytes=body_bytes)

    return app


__all__ = ["create_app"]
