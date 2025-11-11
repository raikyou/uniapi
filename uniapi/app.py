from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx
import yaml
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.staticfiles import StaticFiles
from starlette.responses import StreamingResponse, FileResponse
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

# --- In-memory log broadcasting for admin log viewer ---
import contextlib
from collections import deque
from typing import Deque, Set


class _AdminLogHandler(logging.Handler):
    def __init__(self, buffer_size: int = 500) -> None:
        super().__init__(level=logging.INFO)
        self.buffer_size = buffer_size
        self.buffer: Deque[dict] = deque(maxlen=buffer_size)
        self.subscribers: Set[asyncio.Queue] = set()
        self._formatter = logging.Formatter(
            fmt="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )

    def emit(self, record: logging.LogRecord) -> None:  # sync context
        # Avoid duplicate handling when attached to multiple loggers
        if getattr(record, "_admin_emitted", False):
            return
        setattr(record, "_admin_emitted", True)
        try:
            msg = self._formatter.format(record)
        except Exception:  # pragma: no cover - defensive
            msg = record.getMessage()
        item = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": msg,
        }
        self.buffer.append(item)
        for q in list(self.subscribers):
            # best-effort put_nowait; drop if back-pressured
            with contextlib.suppress(asyncio.QueueFull):
                q.put_nowait(item)

    def subscribe(self, max_queue: int = 1000) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=max_queue)
        self.subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self.subscribers.discard(q)


_admin_log_handler = _AdminLogHandler()
logging.getLogger().addHandler(_admin_log_handler)
# Also attach to this module logger in case propagation is disabled
logging.getLogger(__name__).addHandler(_admin_log_handler)

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


TRUTHY_STRINGS = {"1", "true", "yes", "on"}
FALSY_STRINGS = {"0", "false", "no", "off"}


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


def _is_streaming_request(
    body_bytes: bytes,
    headers: Headers,
    query_items: list[tuple[str, str]],
) -> bool:
    accept_header = headers.get("accept", "").lower()
    if "text/event-stream" in accept_header:
        return True

    for key, value in query_items:
        if key.lower() in {"stream", "streaming"}:
            lowered = value.lower()
            if lowered in TRUTHY_STRINGS:
                return True
            if lowered in FALSY_STRINGS:
                return False

    content_type = headers.get("content-type", "").lower()
    if "application/json" not in content_type or not body_bytes:
        return False
    try:
        payload = json.loads(body_bytes)
    except json.JSONDecodeError:
        return False
    if not isinstance(payload, dict):
        return False

    stream_value = payload.get("stream")
    if stream_value is None:
        stream_value = payload.get("streaming")

    if isinstance(stream_value, bool):
        return stream_value
    if isinstance(stream_value, (int, float)):
        return bool(stream_value)
    if isinstance(stream_value, str):
        lowered = stream_value.lower()
        if lowered in TRUTHY_STRINGS:
            return True
        if lowered in FALSY_STRINGS:
            return False

    return False


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
        # Replace in‑memory config and dependent structures
        self._config = new_config
        self._update_model_listing_paths(new_config.providers)
        await self._pool.shutdown()
        self._pool.rebuild_on_config_change(new_config)
        # Reset HTTP client so new timeout/proxy take effect on next request
        async with self._client_lock:
            if self._client is not None:
                await self._client.aclose()
                self._client = None
        # Warm up pool/client so the service stays responsive post‑reload
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

    async def provider_status_snapshot(self) -> list[dict[str, object]]:
        await self.pool.initialize()
        now = datetime.now(timezone.utc)
        snapshot: list[dict[str, object]] = []
        for state in self.pool.states:
            cooldown_remaining: Optional[float] = None
            if state.cooldown_until is not None:
                remaining = (state.cooldown_until - now).total_seconds()
                cooldown_remaining = max(0.0, remaining)
            auto_disabled = state.is_on_cooldown(now)
            if not state.config.enabled:
                status = "disabled"
            elif auto_disabled:
                status = "auto_disabled"
            else:
                status = "enabled"

            snapshot.append(
                {
                    "name": state.config.name,
                    "enabled": state.config.enabled,
                    "auto_disabled": auto_disabled,
                    "status": status,
                    "cooldown_until": state.cooldown_until.isoformat() if state.cooldown_until else None,
                    "cooldown_remaining_seconds": cooldown_remaining,
                    "last_error": state.last_error,
                    "priority": state.config.priority,
                    "last_test_latency": state.last_test_latency,
                    "last_test_time": state.last_test_time.isoformat() if state.last_test_time else None,
                }
            )
        return snapshot

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
        streaming_requested = _is_streaming_request(body_bytes, request.headers, query_items)
        timeout_value = self._config.preferences.model_timeout
        if streaming_requested:
            request_timeout = httpx.Timeout(
                connect=timeout_value,
                read=None,
                write=timeout_value,
                pool=timeout_value,
            )
        else:
            request_timeout = httpx.Timeout(timeout_value)
        failures: list[str] = []

        for state in candidates:
            provider = state.config
            url = f"{provider.normalized_base_url()}/{request.url.path.lstrip('/')}"
            headers = dict(cleaned_headers)
            headers[auth_header_name] = f"{auth_value_prefix}{provider.api_key}".strip()

            provider_model = state.get_provider_model(model) if model else None
            modified_body = body_bytes
            modified_query = query_items

            if model and provider_model != model:
                if body_bytes:
                    try:
                        payload = json.loads(body_bytes)
                        if isinstance(payload, dict) and "model" in payload:
                            payload["model"] = provider_model
                            modified_body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        pass

                modified_query = []
                for key, value in query_items:
                    if key.lower() == "model":
                        modified_query.append((key, provider_model))
                    else:
                        modified_query.append((key, value))

            try:
                logger.info(
                    "%s %s to 【%s】-【%s】%s",
                    request.method,
                    request.url.path,
                    provider.name,
                    model or "<unspecified>",
                    f" (mapped to {provider_model})" if model and provider_model != model else ""
                )
                upstream_request = client.build_request(
                    request.method,
                    url,
                    headers=headers,
                    content=modified_body if modified_body else None,
                    params=modified_query,
                    timeout=request_timeout,
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
        # Skip API key check for admin pages, static files, and common browser requests
        if (request.url.path.startswith("/admin") or
            request.url.path.startswith("/static") or
            request.url.path.startswith("/assets") or
            request.url.path.startswith("/.well-known") or
            request.url.path == "/" or
            request.url.path.endswith((".ico", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp"))):
            return await call_next(request)

        if engine.config.api_key:
            provided = _extract_api_key(request.headers)
            if provided != engine.config.api_key:
                raise HTTPException(status_code=401, detail="Invalid or missing API key")
        return await call_next(request)

    def _build_model_entries(models_by_provider: dict[str, list[str]]) -> list[dict[str, object]]:
        entries: list[dict[str, object]] = []
        seen: set[str] = set()
        for _, models in models_by_provider.items():
            for model_id in models:
                if "*" in model_id or "?" in model_id:
                    continue
                if model_id in seen:
                    continue
                seen.add(model_id)
                entries.append({"id": model_id, "name": model_id})
        entries.sort(key=lambda item: str(item["id"]))
        return entries

    @app.get("/v1/models")
    async def list_supported_models_v1() -> dict:
        models_by_provider = await engine.pool.list_models()
        entries = _build_model_entries(models_by_provider)
        return {"data": entries}

    # Admin endpoints
    @app.get("/")
    async def admin_index():
        static_dir = Path(__file__).parent / "static"
        index_file = static_dir / "index.html"
        if not index_file.exists():
            raise HTTPException(status_code=404, detail="Admin page not found")
        return FileResponse(index_file)

    @app.get("/favicon.ico")
    async def favicon():
        from fastapi.responses import Response
        return Response(status_code=204)

    # Mount static files
    static_dir = Path(__file__).parent / "static"
    if static_dir.exists():
        # Mount assets directory for Vite build files
        assets_dir = static_dir / "assets"
        if assets_dir.exists():
            app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

        app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

    @app.get("/admin/config")
    async def get_config(request: Request):
        _require_admin(request)

        # Read current config file
        if not config_path.exists():
            raise HTTPException(status_code=404, detail="Config file not found")

        try:
            with open(config_path, "r", encoding="utf-8") as f:
                config_data = yaml.safe_load(f)
            return config_data
        except Exception as exc:
            logger.error("Failed to read config file: %s", exc)
            raise HTTPException(status_code=500, detail="Failed to read config file")

    @app.post("/admin/config")
    async def update_config(request: Request):
        _require_admin(request)

        try:
            new_config_data = await request.json()
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid JSON")

        # Validate required fields
        if "api_key" not in new_config_data:
            raise HTTPException(status_code=400, detail="api_key is required")

        if "providers" not in new_config_data or not isinstance(new_config_data["providers"], list):
            raise HTTPException(status_code=400, detail="providers must be a non-empty list")

        if len(new_config_data["providers"]) == 0:
            raise HTTPException(status_code=400, detail="At least one provider is required")

        # Validate each provider
        for idx, provider in enumerate(new_config_data["providers"]):
            if not isinstance(provider, dict):
                raise HTTPException(status_code=400, detail=f"Provider at index {idx} must be an object")

            required_fields = ["provider", "base_url", "api_key"]
            for field in required_fields:
                if field not in provider or not provider[field]:
                    raise HTTPException(status_code=400, detail=f"Provider at index {idx} missing required field: {field}")

        # Write to config file
        try:
            with open(config_path, "w", encoding="utf-8") as f:
                yaml.dump(
                    new_config_data,
                    f,
                    allow_unicode=True,
                    default_flow_style=False,
                    sort_keys=False,
                )

            logger.info("Configuration updated via admin interface")
            try:
                updated_config = load_config(config_path)
            except ConfigError as exc:
                logger.error("Config written but failed to reload: %s", exc)
                raise HTTPException(status_code=500, detail="Configuration saved but failed to reload")

            await engine._apply_new_config(updated_config)
            engine._config_mtime = engine._current_config_mtime()

            return {"status": "success", "message": "Configuration saved successfully"}

        except Exception as exc:
            logger.error("Failed to write config file: %s", exc)
            raise HTTPException(status_code=500, detail="Failed to write config file")

    @app.get("/admin/providers/status")
    async def provider_status(request: Request):
        _require_admin(request)

        try:
            snapshot = await engine.provider_status_snapshot()
        except Exception as exc:  # pragma: no cover - defensive
            logger.error("Failed to build provider status snapshot: %s", exc)
            raise HTTPException(status_code=500, detail="Failed to read provider status")

        return {"providers": snapshot}

    @app.get("/admin/providers/{provider_name}/models")
    async def provider_models(provider_name: str, request: Request):
        _require_admin(request)

        try:
            models = await engine.pool.fetch_upstream_models(provider_name)
        except ValueError:
            raise HTTPException(status_code=404, detail="Provider not found")
        except RuntimeError as exc:
            logger.warning("Model fetch failed for %s: %s", provider_name, exc)
            raise HTTPException(status_code=502, detail=str(exc))
        except Exception as exc:  # pragma: no cover - defensive
            logger.error("Unexpected error fetching models for %s: %s", provider_name, exc)
            raise HTTPException(status_code=500, detail="Failed to fetch models")

        # Return simple list for admin UI selection
        return {"models": models}

    @app.post("/admin/providers/{provider_name}/test-result")
    async def update_provider_test_result(provider_name: str, request: Request):
        _require_admin(request)

        try:
            payload = await request.json()
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid JSON")

        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="Invalid payload")

        latency_ms = payload.get("latency_ms")
        if not isinstance(latency_ms, (int, float)) or latency_ms < 0:
            raise HTTPException(status_code=400, detail="latency_ms must be a non-negative number")

        engine.pool.update_provider_test_result(provider_name, int(latency_ms))
        return {"status": "success"}

    @app.post("/admin/providers/_probe_models")
    async def probe_provider_models(request: Request):
        # Allow fetching models for providers not yet saved (from modal form)
        _require_admin(request)

        try:
            payload = await request.json()
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid JSON")

        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="Invalid payload")

        base_url = str(payload.get("base_url") or "").strip()
        api_key = str(payload.get("api_key") or "").strip()
        models_endpoint = str(payload.get("models_endpoint") or "/v1/models").strip()
        if not base_url or not api_key:
            raise HTTPException(status_code=400, detail="base_url and api_key are required")

        base_url = base_url.rstrip("/")
        if not models_endpoint.startswith("/"):
            models_endpoint = f"/{models_endpoint}"
        url = f"{base_url}{models_endpoint}"

        client = await engine.ensure_client()
        headers = {"Authorization": f"Bearer {api_key}"}
        try:
            upstream = await client.get(url, headers=headers)
            upstream.raise_for_status()
            body = upstream.json()
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Failed to fetch models: {exc}")

        data = body.get("data") if isinstance(body, dict) else None
        if not isinstance(data, list):
            raise HTTPException(status_code=502, detail="Unexpected models payload format")

        models: list[str] = []
        for entry in data:
            if isinstance(entry, dict):
                mid = entry.get("id")
            else:
                mid = None
            if isinstance(mid, str) and mid:
                models.append(mid)
        return {"models": models}

    # ---------- Admin log endpoints ----------
    def _admin_key_ok(request: Request) -> bool:
        provided_key = _extract_api_key(request.headers)
        if not provided_key:
            provided_key = request.query_params.get("api_key")
        return bool(provided_key and provided_key == engine.config.api_key)

    def _require_admin(request: Request) -> None:
        if not _admin_key_ok(request):
            raise HTTPException(status_code=401, detail="Invalid or missing API key")

    @app.get("/admin/logs/recent")
    async def admin_logs_recent(request: Request):
        _require_admin(request)
        try:
            limit = int(request.query_params.get("limit", 500))
        except ValueError:
            limit = 500
        limit = max(1, min(2000, limit))
        items = list(_admin_log_handler.buffer)[-limit:]
        return {"logs": items}

    @app.get("/admin/logs/stream")
    async def admin_logs_stream(request: Request):
        _require_admin(request)

        async def event_iterator():
            queue = _admin_log_handler.subscribe()
            try:
                # Send a comment to establish stream
                yield b": ok\n\n"
                while True:
                    # If client disconnects, this raises
                    item = await queue.get()
                    payload = json.dumps(item, ensure_ascii=False)
                    yield f"data: {payload}\n\n".encode("utf-8")
            except asyncio.CancelledError:  # client disconnected
                pass
            finally:
                _admin_log_handler.unsubscribe(queue)

        return StreamingResponse(event_iterator(), media_type="text/event-stream")

    @app.api_route("/{full_path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])
    async def universal_proxy(full_path: str, request: Request) -> Response:
        body_bytes = await request.body()
        model = _extract_model_from_body(body_bytes, request.headers) or request.query_params.get("model")
        if model is None and not engine.is_model_listing_path(request.url.path):
            raise HTTPException(status_code=400, detail="Request must include a model field")
        return await engine.dispatch(request, model=model, body_bytes=body_bytes)

    return app


__all__ = ["create_app"]
