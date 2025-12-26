from typing import Dict, Optional

from pydantic import BaseModel


class SettingsResponse(BaseModel):
    log_retention_days: int
    default_freeze_duration: int


class SettingsUpdate(BaseModel):
    log_retention_days: Optional[int] = None
    default_freeze_duration: Optional[int] = None
