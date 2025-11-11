# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# Stage 2: Build backend
FROM ghcr.io/astral-sh/uv:python3.12-alpine

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Copy Python project files
COPY pyproject.toml uv.lock README.md ./
COPY uniapi ./uniapi

# Copy frontend build artifacts (built to /uniapi/static from vite.config.ts)
COPY --from=frontend-builder /uniapi/static ./uniapi/static

# Install Python dependencies
RUN uv sync --frozen --no-dev --no-editable

ENV VIRTUAL_ENV=/app/.venv
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Setup config directory
RUN mkdir -p /config
COPY config.yaml.template /config/config.yaml

EXPOSE 8000

ENTRYPOINT ["uniapi"]
CMD ["--config", "/config/config.yaml", "--host", "0.0.0.0", "--port", "8000"]
