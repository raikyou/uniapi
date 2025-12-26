from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas import SettingsResponse, SettingsUpdate
from app.services.settings_service import SettingsService

router = APIRouter()


@router.get("", response_model=SettingsResponse)
async def get_settings(db: AsyncSession = Depends(get_db)):
    """Get system settings"""
    service = SettingsService(db)
    settings = await service.get_all()
    return SettingsResponse(**settings)


@router.put("", response_model=SettingsResponse)
async def update_settings(
    data: SettingsUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update system settings"""
    service = SettingsService(db)
    settings = await service.update(
        log_retention_days=data.log_retention_days,
        default_freeze_duration=data.default_freeze_duration,
    )
    return SettingsResponse(**settings)
