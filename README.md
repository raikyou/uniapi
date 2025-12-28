# UniAPI

## Docker

Build the single-image bundle (frontend + backend):

```sh
docker build -t uniapi .
```

Run on port 8000 (dashboard and gateway share the same port):

```sh
docker run --rm -p 8000:8000 -e API_KEY=your-key uniapi
```

Persist the SQLite database and request/response logs:

```sh
docker run --rm -p 8000:8000 \
  -e API_KEY=your-key \
  -v "$(pwd)/data:/app/backend/app/data" \
  uniapi
```

## Configuration

Environment variables:

- `API_KEY`: required for gateway + admin requests.
- `UNIAPI_DB_PATH`: override SQLite path (default: `backend/app/data/uniapi.db` inside the container).
- `UNIAPI_LOG_RETENTION_DAYS`: days to keep request/response bodies (default: 7).
- `UNIAPI_FREEZE_DURATION_SECONDS`: provider freeze duration (default: 600).

## Development

The frontend defaults to same-origin API calls. For local dev with separate hosts, set:

```
VITE_API_BASE=http://127.0.0.1:8000
```
