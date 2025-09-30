FROM ghcr.io/astral-sh/uv:python3.12-alpine

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY pyproject.toml uv.lock README.md ./
COPY uniapi ./uniapi

RUN uv sync --frozen --no-dev --no-editable

ENV VIRTUAL_ENV=/app/.venv
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

RUN mkdir -p /config
COPY config.yaml.template /config/config.yaml

EXPOSE 8000

ENTRYPOINT ["uniapi"]
CMD ["--config", "/config/config.yaml", "--host", "0.0.0.0", "--port", "8000"]
