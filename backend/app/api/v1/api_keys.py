from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas import ApiKeyCreate, ApiKeyCreatedResponse, ApiKeyResponse
from app.services.api_key_service import ApiKeyService

router = APIRouter()


@router.get("", response_model=List[ApiKeyResponse])
async def list_api_keys(db: AsyncSession = Depends(get_db)):
    """List all API keys"""
    service = ApiKeyService(db)
    keys = await service.get_all()
    return [ApiKeyResponse.model_validate(k) for k in keys]


@router.post("", response_model=ApiKeyCreatedResponse)
async def create_api_key(data: ApiKeyCreate, db: AsyncSession = Depends(get_db)):
    """Create a new API key"""
    service = ApiKeyService(db)
    api_key = await service.create(data.name)
    return ApiKeyCreatedResponse(
        id=api_key.id,
        key=api_key.key,
        name=api_key.name,
        created_at=api_key.created_at,
    )


@router.delete("/{key_id}")
async def delete_api_key(key_id: int, db: AsyncSession = Depends(get_db)):
    """Delete an API key"""
    service = ApiKeyService(db)
    success = await service.delete(key_id)

    if not success:
        raise HTTPException(status_code=404, detail="API key not found")

    return {"message": "API key deleted successfully"}
