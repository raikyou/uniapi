# Repository Guidelines

## Project Structure & Module Organization
- Source lives in `uniapi/`:
  - `app.py` (FastAPI app, routes, proxy engine), `__main__.py` (CLI), `config.py` (YAML parsing/validation), `provider_pool.py` (provider selection, retries/cooldowns), `http_client.py` (shared httpx client), `static/` (admin UI assets).
- Config: `config.yaml` (local, untracked) and `config.yaml.template` (reference). Build/runtime: `pyproject.toml`, `Dockerfile`.
- Add new endpoints in `uniapi/app.py`; keep provider logic and helpers in dedicated modules. Prefer small, testable functions and avoid implicit global state.

## Build, Test, and Development Commands
- `uv sync` — create the venv and install dependencies.
- `uv run uniapi --config config.yaml --host 0.0.0.0 --port 8000` — run via CLI.
- `uv run uvicorn uniapi.app:create_app --factory --reload` — dev server with hot reload.
- `uv run python -m compileall uniapi` — quick syntax check.
- Docker:
  - `docker build -t uniapi .`
  - `docker run -p 8000:8000 -v "$PWD/config.yaml:/app/config.yaml" uniapi`

## Coding Style & Naming Conventions
- Python 3.10+, PEP 8, 4‑space indent; use type hints and docstrings for public functions.
- Names: `snake_case` for functions/vars/modules, `PascalCase` for classes, `UPPER_CASE` for constants.
- Keep request/response pass‑through behavior intact; never log API keys or sensitive payloads. Use the module‑level logger; INFO is the default.
- Prefer `dataclasses` for config‑like data.

## Testing Guidelines
- No formal test suite yet. If adding tests, use `pytest`:
  - Place tests in `tests/` with files named `test_*.py`.
  - Run with `uv run pytest`.
- Minimum e2e check: list models with API key:
  - `curl -H "X-API-Key: <local_api_key>" http://localhost:8000/v1/models`

## Commit & Pull Request Guidelines
- Commits: imperative mood with optional scope (e.g., `app:`, `config:`, `docs:`).
  - Example: `config: validate cooldown >= 0`.
- PRs: clear description, linked issues, verification steps, and screenshots for UI/static changes. Note any `config.yaml` changes. Do not commit secrets.

## Security & Configuration Tips
- Never commit `config.yaml`; use `config.yaml.template` as the reference.
- Non‑admin requests require `X-API-Key` or a Bearer token; mismatches return 401.
- Provider API keys are only forwarded upstream; do not persist or log them.

