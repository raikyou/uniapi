from typing import List

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models import Model, Provider, ProviderStatus
from app.services.log_service import RequestLogService

router = APIRouter()


@router.get("/overview")
async def get_overview(
    days: int = Query(7, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
):
    """Get overview statistics"""
    log_service = RequestLogService(db)
    stats = await log_service.get_overview_stats(days)

    # Get active providers count
    provider_query = select(func.count(Provider.id)).where(
        Provider.status == ProviderStatus.ACTIVE
    )
    provider_result = await db.execute(provider_query)
    active_providers = provider_result.scalar() or 0

    # Get total models count
    model_query = select(func.count(Model.id)).where(Model.is_enabled == True)
    model_result = await db.execute(model_query)
    total_models = model_result.scalar() or 0

    return {
        **stats,
        "active_providers": active_providers,
        "total_models": total_models,
    }


@router.get("/requests")
async def get_request_stats(
    days: int = Query(7, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
):
    """Get request statistics by time"""
    service = RequestLogService(db)
    by_time = await service.get_request_stats(days)

    return {
        "by_time": by_time,
    }


@router.get("/tokens")
async def get_token_stats(
    days: int = Query(7, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
):
    """Get token consumption statistics"""
    service = RequestLogService(db)
    stats = await service.get_token_stats(days)

    return stats


@router.get("/latency")
async def get_latency_stats(
    days: int = Query(7, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
):
    """Get latency distribution"""
    service = RequestLogService(db)
    overview = await service.get_overview_stats(days)

    return {
        "avg_latency_ms": overview["avg_latency_ms"],
        "avg_first_token_latency_ms": overview["avg_first_token_latency_ms"],
    }


@router.get("/providers")
async def get_provider_stats(
    days: int = Query(7, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
):
    """Get statistics by provider"""
    service = RequestLogService(db)
    stats = await service.get_provider_stats(days)

    return stats
