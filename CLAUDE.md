# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

UniAPI is a lightweight API proxy gateway for managing multiple LLM provider channels. It automatically selects providers by model and priority, with automatic retry and cooldown mechanisms when providers fail. All requests and responses are transparently proxied.

## Development Commands

**Install dependencies and setup virtual environment:**
```bash
uv sync
```

**Run the service:**
```bash
uv run uniapi --config config.yaml --host 0.0.0.0 --port 8000
```

**Run with uvicorn in development mode:**
```bash
uv run uvicorn uniapi.app:create_app --factory --host 0.0.0.0 --port 8000 --reload
```

**Syntax check:**
```bash
uv run python -m compileall uniapi
```

## Configuration

Before running, copy `config.yaml.template` to `config.yaml` and configure:
- Top-level `api_key`: Required for authenticating incoming requests
- `providers`: List of LLM provider endpoints with their API keys, priorities, and supported models
- `preferences`: Timeout, cooldown period, and optional global proxy settings

## Architecture

### Core Components

**ProxyEngine (`app.py:239-523`)**
- Central orchestration layer managing the full request lifecycle
- Maintains a `ProviderPool` instance for provider selection and health tracking
- Handles configuration reloading via file watching (every 2 seconds)
- Authentication enforcement via middleware using `api_key` from config
- Dispatches requests to providers with automatic retry and transparent response proxying

**ProviderPool (`provider_pool.py`)**
- Manages provider states including cooldown tracking and model pattern matching
- Selects candidates by filtering: enabled providers → not on cooldown → supports requested model → highest priority
- Shuffles providers within the same priority tier for load balancing
- Auto-fetches model lists from providers lacking explicit configuration via `models_endpoint` (default `/v1/models`)
- Marks providers as failed (triggers cooldown) on 5xx or 429 responses; 4xx errors propagate immediately to client

**Request Flow**
1. Client request arrives with `model` field (JSON body or query param) and API key header (`X-API-Key` or `Authorization: Bearer`)
2. Middleware validates API key against config
3. `ProxyEngine.dispatch()` extracts model and queries `ProviderPool` for candidates
4. For each candidate in priority order:
   - Forwards request with provider's API key, preserving client headers (except auth/hop-by-hop)
   - On 5xx/429: mark failure, enter cooldown, try next provider
   - On 4xx: immediately return error to client (considered client fault)
   - On success: return response (streaming or buffered based on content-type)
5. If all providers fail, return 502 with aggregated error messages

**Cooldown Mechanism (`provider_pool.py:34-47`)**
- Failed providers enter cooldown for `preferences.cooldown_period` seconds (default 300s)
- During cooldown, provider is excluded from candidate selection
- Automatically restored after cooldown expires
- Set `cooldown_period: 0` to disable

**Model Selection (`provider_pool.py:215-233`)**
- Providers specify supported models via `model` list in config (supports `*` wildcards)
- If no models configured, pool fetches from provider's `models_endpoint` at startup
- Pattern matching uses `fnmatch` for wildcard support (e.g., `*gemini`, `gpt-4*`)

**Admin Interface**
- Web UI at `/` (served from `uniapi/static/`) for configuration management
- API endpoints under `/admin/`:
  - `GET /admin/config`: Retrieve current config
  - `POST /admin/config`: Update config (triggers hot reload)
  - `GET /admin/providers/status`: Provider health and cooldown status
  - `GET /admin/logs/recent`: Recent logs buffer
  - `GET /admin/logs/stream`: SSE stream of real-time logs
- Admin endpoints require API key authentication

**OpenAI Compatibility**
- `GET /v1/models`: Returns aggregated model list across all enabled providers (excludes wildcard patterns)
- All other paths: Universal proxy that requires `model` field for routing

## Key Implementation Details

- **Streaming detection** (`app.py:117-159`, `app.py:206-226`): Checks `Accept` header, `stream`/`streaming` query params or JSON body fields, and response content-type
- **Header handling**: Strips hop-by-hop headers, auth headers, and `Host`; preserves all other client headers
- **Auth header forwarding** (`app.py:189-203`): Detects client's auth scheme (Bearer/x-api-key/x-goog-api-key) and applies provider's API key using same scheme
- **Hot reload**: Config file changes automatically trigger provider pool rebuild and HTTP client recreation
- **Logging**: Admin log handler broadcasts to in-memory buffer (500 lines) and SSE subscribers for real-time monitoring
