from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models import ProviderStatus
from app.schemas import (
    ModelCreate,
    ModelResponse,
    ProviderCreate,
    ProviderListResponse,
    ProviderResponse,
    ProviderStatusUpdate,
    ProviderUpdate,
)
from app.services.provider_service import ProviderService
from app.services.model_service import ModelService

router = APIRouter()


@router.get("", response_model=List[ProviderListResponse])
async def list_providers(db: AsyncSession = Depends(get_db)):
    """List all providers ordered by priority DESC"""
    service = ProviderService(db)
    providers = await service.get_all()

    result = []
    for provider in providers:
        models_count = await service.get_models_count(provider.id)
        result.append(
            ProviderListResponse(
                id=provider.id,
                name=provider.name,
                type=provider.type,
                priority=provider.priority,
                status=provider.status,
                is_passthrough=provider.is_passthrough,
                frozen_at=provider.frozen_at,
                models_count=models_count,
            )
        )
    return result


@router.post("", response_model=ProviderResponse)
async def create_provider(data: ProviderCreate, db: AsyncSession = Depends(get_db)):
    """Create a new provider"""
    service = ProviderService(db)

    # Check if name already exists
    existing = await service.get_by_name(data.name)
    if existing:
        raise HTTPException(status_code=400, detail="Provider name already exists")

    provider = await service.create(data)
    models_count = await service.get_models_count(provider.id)

    return ProviderResponse(
        id=provider.id,
        name=provider.name,
        type=provider.type,
        base_url=provider.base_url,
        priority=provider.priority,
        status=provider.status,
        is_passthrough=provider.is_passthrough,
        frozen_at=provider.frozen_at,
        freeze_duration=provider.freeze_duration,
        freeze_reason=provider.freeze_reason,
        models_count=models_count,
        created_at=provider.created_at,
        updated_at=provider.updated_at,
    )


@router.get("/{provider_id}", response_model=ProviderResponse)
async def get_provider(provider_id: int, db: AsyncSession = Depends(get_db)):
    """Get a provider by ID"""
    service = ProviderService(db)
    provider = await service.get_by_id(provider_id)

    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")

    models_count = await service.get_models_count(provider.id)

    return ProviderResponse(
        id=provider.id,
        name=provider.name,
        type=provider.type,
        base_url=provider.base_url,
        priority=provider.priority,
        status=provider.status,
        is_passthrough=provider.is_passthrough,
        frozen_at=provider.frozen_at,
        freeze_duration=provider.freeze_duration,
        freeze_reason=provider.freeze_reason,
        models_count=models_count,
        created_at=provider.created_at,
        updated_at=provider.updated_at,
    )


@router.put("/{provider_id}", response_model=ProviderResponse)
async def update_provider(
    provider_id: int, data: ProviderUpdate, db: AsyncSession = Depends(get_db)
):
    """Update a provider"""
    service = ProviderService(db)

    # Check if new name conflicts
    if data.name:
        existing = await service.get_by_name(data.name)
        if existing and existing.id != provider_id:
            raise HTTPException(status_code=400, detail="Provider name already exists")

    provider = await service.update(provider_id, data)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")

    models_count = await service.get_models_count(provider.id)

    return ProviderResponse(
        id=provider.id,
        name=provider.name,
        type=provider.type,
        base_url=provider.base_url,
        priority=provider.priority,
        status=provider.status,
        is_passthrough=provider.is_passthrough,
        frozen_at=provider.frozen_at,
        freeze_duration=provider.freeze_duration,
        freeze_reason=provider.freeze_reason,
        models_count=models_count,
        created_at=provider.created_at,
        updated_at=provider.updated_at,
    )


@router.delete("/{provider_id}")
async def delete_provider(provider_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a provider"""
    service = ProviderService(db)
    success = await service.delete(provider_id)

    if not success:
        raise HTTPException(status_code=404, detail="Provider not found")

    return {"message": "Provider deleted successfully"}


@router.patch("/{provider_id}/status", response_model=ProviderResponse)
async def update_provider_status(
    provider_id: int, data: ProviderStatusUpdate, db: AsyncSession = Depends(get_db)
):
    """Enable/disable a provider"""
    service = ProviderService(db)
    provider = await service.update_status(provider_id, data.status)

    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")

    models_count = await service.get_models_count(provider.id)

    return ProviderResponse(
        id=provider.id,
        name=provider.name,
        type=provider.type,
        base_url=provider.base_url,
        priority=provider.priority,
        status=provider.status,
        is_passthrough=provider.is_passthrough,
        frozen_at=provider.frozen_at,
        freeze_duration=provider.freeze_duration,
        freeze_reason=provider.freeze_reason,
        models_count=models_count,
        created_at=provider.created_at,
        updated_at=provider.updated_at,
    )


@router.post("/{provider_id}/unfreeze", response_model=ProviderResponse)
async def unfreeze_provider(provider_id: int, db: AsyncSession = Depends(get_db)):
    """Manually unfreeze a provider"""
    service = ProviderService(db)
    provider = await service.unfreeze(provider_id)

    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")

    models_count = await service.get_models_count(provider.id)

    return ProviderResponse(
        id=provider.id,
        name=provider.name,
        type=provider.type,
        base_url=provider.base_url,
        priority=provider.priority,
        status=provider.status,
        is_passthrough=provider.is_passthrough,
        frozen_at=provider.frozen_at,
        freeze_duration=provider.freeze_duration,
        freeze_reason=provider.freeze_reason,
        models_count=models_count,
        created_at=provider.created_at,
        updated_at=provider.updated_at,
    )


@router.get("/{provider_id}/models", response_model=List[ModelResponse])
async def list_provider_models(provider_id: int, db: AsyncSession = Depends(get_db)):
    """List models for a provider"""
    provider_service = ProviderService(db)
    provider = await provider_service.get_by_id(provider_id)

    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")

    model_service = ModelService(db)
    models = await model_service.get_by_provider(provider_id)

    return [ModelResponse.model_validate(m) for m in models]


@router.post("/{provider_id}/models/fetch")
async def fetch_provider_models(provider_id: int, db: AsyncSession = Depends(get_db)):
    """Fetch models from provider API"""
    provider_service = ProviderService(db)
    provider = await provider_service.get_by_id(provider_id)

    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")

    model_service = ModelService(db)
    models = await model_service.fetch_from_provider(provider)

    return {"message": f"Fetched {len(models)} models", "models": models}


@router.post("/{provider_id}/models", response_model=ModelResponse)
async def add_provider_model(
    provider_id: int, data: ModelCreate, db: AsyncSession = Depends(get_db)
):
    """Manually add a model to provider"""
    provider_service = ProviderService(db)
    provider = await provider_service.get_by_id(provider_id)

    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")

    model_service = ModelService(db)
    model = await model_service.create(provider_id, data)

    return ModelResponse.model_validate(model)
