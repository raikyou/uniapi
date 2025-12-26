from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import optional_api_key
from app.core.passthrough import PassthroughHandler
from app.db.session import get_db
from app.models import ApiKey

router = APIRouter()


@router.api_route(
    "/{provider_type}/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
)
async def passthrough(
    provider_type: str,
    path: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(optional_api_key),
):
    """
    Passthrough endpoint - forwards requests directly to provider.

    Only replaces API key, no format conversion.

    Example:
    - POST /v1/passthrough/anthropic/v1/messages
    - POST /v1/passthrough/openai/v1/chat/completions
    """
    handler = PassthroughHandler(db)
    try:
        return await handler.handle(
            provider_type=provider_type,
            path=path,
            request=request,
        )
    finally:
        await handler.close()
