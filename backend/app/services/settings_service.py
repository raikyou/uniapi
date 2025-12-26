from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import DEFAULT_SETTINGS, SystemSettings


class SettingsService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.config = get_settings()

    async def get_all(self) -> dict:
        """Get all settings"""
        query = select(SystemSettings)
        result = await self.db.execute(query)
        settings = result.scalars().all()

        # Start with defaults
        settings_dict = {
            "log_retention_days": self.config.log_retention_days,
            "default_freeze_duration": self.config.default_freeze_duration,
        }

        # Override with database values
        for setting in settings:
            if setting.key == "log_retention_days":
                settings_dict["log_retention_days"] = int(setting.value)
            elif setting.key == "default_freeze_duration":
                settings_dict["default_freeze_duration"] = int(setting.value)

        return settings_dict

    async def get(self, key: str) -> Optional[str]:
        """Get a specific setting"""
        query = select(SystemSettings).where(SystemSettings.key == key)
        result = await self.db.execute(query)
        setting = result.scalar_one_or_none()
        return setting.value if setting else None

    async def set(self, key: str, value: str, description: Optional[str] = None) -> SystemSettings:
        """Set a setting value"""
        query = select(SystemSettings).where(SystemSettings.key == key)
        result = await self.db.execute(query)
        setting = result.scalar_one_or_none()

        if setting:
            setting.value = value
            if description:
                setting.description = description
        else:
            setting = SystemSettings(
                key=key,
                value=value,
                description=description,
            )
            self.db.add(setting)

        await self.db.commit()
        await self.db.refresh(setting)
        return setting

    async def update(
        self,
        log_retention_days: Optional[int] = None,
        default_freeze_duration: Optional[int] = None,
    ) -> dict:
        """Update multiple settings"""
        if log_retention_days is not None:
            await self.set(
                "log_retention_days",
                str(log_retention_days),
                "Number of days to retain request logs",
            )

        if default_freeze_duration is not None:
            await self.set(
                "default_freeze_duration",
                str(default_freeze_duration),
                "Default freeze duration in seconds",
            )

        return await self.get_all()

    async def get_log_retention_days(self) -> int:
        """Get log retention days setting"""
        value = await self.get("log_retention_days")
        if value:
            return int(value)
        return self.config.log_retention_days

    async def get_default_freeze_duration(self) -> int:
        """Get default freeze duration setting"""
        value = await self.get("default_freeze_duration")
        if value:
            return int(value)
        return self.config.default_freeze_duration
