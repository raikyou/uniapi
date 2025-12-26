from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas import PaginatedResponse, RequestLogDetailResponse, RequestLogResponse
from app.services.log_service import RequestLogService
from app.services.settings_service import SettingsService

router = APIRouter()


@router.get("")
async def list_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    provider_id: Optional[int] = None,
    model: Optional[str] = None,
    is_success: Optional[bool] = None,
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
    db: AsyncSession = Depends(get_db),
):
    """List request logs with pagination"""
    service = RequestLogService(db)

    result = await service.get_logs(
        page=page,
        page_size=page_size,
        provider_id=provider_id,
        model=model,
        is_success=is_success,
        start_time=start_time,
        end_time=end_time,
    )

    return PaginatedResponse(
        items=[RequestLogResponse.model_validate(log) for log in result["items"]],
        total=result["total"],
        page=result["page"],
        page_size=result["page_size"],
        total_pages=result["total_pages"],
    )


@router.get("/{log_id}", response_model=RequestLogDetailResponse)
async def get_log(log_id: int, db: AsyncSession = Depends(get_db)):
    """Get log details"""
    service = RequestLogService(db)
    log = await service.get_by_id(log_id)

    if not log:
        raise HTTPException(status_code=404, detail="Log not found")

    return RequestLogDetailResponse.model_validate(log)


@router.delete("/cleanup")
async def cleanup_logs(db: AsyncSession = Depends(get_db)):
    """Cleanup expired logs based on retention settings"""
    settings_service = SettingsService(db)
    retention_days = await settings_service.get_log_retention_days()

    log_service = RequestLogService(db)
    deleted_count = await log_service.cleanup_old_logs(retention_days)

    return {
        "message": f"Deleted {deleted_count} logs older than {retention_days} days",
        "deleted_count": deleted_count,
    }
