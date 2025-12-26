from typing import Optional

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models import ApiKey
from app.services.api_key_service import ApiKeyService

security = HTTPBearer(auto_error=False)


async def get_api_key(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> Optional[ApiKey]:
    """
    Validate API key from Authorization header.
    Returns None if no key provided (for public endpoints).
    Raises HTTPException if key is invalid.
    """
    if not credentials:
        return None

    key = credentials.credentials
    service = ApiKeyService(db)
    api_key = await service.validate(key)

    if not api_key:
        raise HTTPException(
            status_code=401,
            detail="Invalid or inactive API key",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return api_key


async def require_api_key(
    api_key: Optional[ApiKey] = Depends(get_api_key),
) -> ApiKey:
    """
    Require a valid API key for protected endpoints.
    """
    if not api_key:
        raise HTTPException(
            status_code=401,
            detail="API key required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return api_key


async def optional_api_key(
    api_key: Optional[ApiKey] = Depends(get_api_key),
) -> Optional[ApiKey]:
    """
    Optional API key validation.
    Returns None if no key provided, validates if provided.
    """
    return api_key
