# Repository Guidelines

## Project Structure & Module Organization

- `backend/` holds the FastAPI gateway service (entrypoint `backend/app/main.py`).
- `backend/app/services/` contains provider routing, auth, logging, and runtime helpers.
- `backend/app/routes/` defines gateway and admin API routes.
- `frontend/` is the Vite + React UI; source lives in `frontend/src/`.
- `scripts/` includes operational helpers like `gateway_matrix_test.mjs`.
- Runtime SQLite data defaults to `backend/app/data/` (created at runtime).

## Build, Test, and Development Commands

Backend (from repo root):
```bash
cd backend
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
Starts the FastAPI server with reload.

Frontend:
```bash
cd frontend
npm install
npm run dev
```
Runs the Vite dev server (default `http://localhost:5173`).

Build/preview UI:
```bash
cd frontend
npm run build
npm run preview
```

## Coding Style & Naming Conventions

- Python uses 4-space indentation and type hints where practical.
- Frontend TypeScript uses 2-space indentation and no semicolons (match existing files).
- React components are `PascalCase` (`AppLayout.tsx`); variables/functions are `camelCase`.
- Keep imports sorted into external first, then local.

## Testing Guidelines

- No dedicated test runner is configured yet.
- Use `scripts/gateway_matrix_test.mjs` for a basic gateway parity check:
```bash
node scripts/gateway_matrix_test.mjs --base-url http://localhost:8000 --base-url-2 http://localhost:8001 --api-key your-key
```
- Add targeted tests alongside new features if you introduce a framework.

## Commit & Pull Request Guidelines

- Commit messages follow short conventional prefixes seen in history: `feat:`, `bugfix:`,
  `refactor`, or `feat(scope):`.
- PRs should include: a concise summary, testing notes, and screenshots for UI changes.
- Link relevant issues or tickets when applicable.

## Configuration & Security Tips

- Set `API_KEY` for gateway and admin access; avoid committing keys.
- Optional envs: `UNIAPI_DB_PATH`, `UNIAPI_LOG_RETENTION_DAYS`,
  `UNIAPI_FREEZE_DURATION_SECONDS`.
