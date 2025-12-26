from fastapi import APIRouter

api_router = APIRouter()

# Gateway API (OpenAI compatible)
from app.api.v1 import gateway, passthrough

api_router.include_router(gateway.router, prefix="/v1", tags=["Gateway"])
api_router.include_router(passthrough.router, prefix="/v1/passthrough", tags=["Passthrough"])

# Admin API
from app.api.v1 import providers, models, api_keys, logs, stats, settings

api_router.include_router(providers.router, prefix="/api/providers", tags=["Providers"])
api_router.include_router(models.router, prefix="/api/models", tags=["Models"])
api_router.include_router(api_keys.router, prefix="/api/keys", tags=["API Keys"])
api_router.include_router(logs.router, prefix="/api/logs", tags=["Logs"])
api_router.include_router(stats.router, prefix="/api/stats", tags=["Stats"])
api_router.include_router(settings.router, prefix="/api/settings", tags=["Settings"])
