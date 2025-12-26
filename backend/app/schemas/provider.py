from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.models.provider import ProviderStatus, ProviderType


class ProviderBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    type: ProviderType
    base_url: Optional[str] = None
    api_key: str
    extra_config: Optional[str] = None
    priority: int = 0
    is_passthrough: bool = False
    freeze_duration: int = 300


class ProviderCreate(ProviderBase):
    pass


class ProviderUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    extra_config: Optional[str] = None
    priority: Optional[int] = None
    is_passthrough: Optional[bool] = None
    freeze_duration: Optional[int] = None


class ProviderStatusUpdate(BaseModel):
    status: ProviderStatus


class ProviderResponse(BaseModel):
    id: int
    name: str
    type: ProviderType
    base_url: Optional[str]
    priority: int
    status: ProviderStatus
    is_passthrough: bool
    frozen_at: Optional[datetime]
    freeze_duration: int
    freeze_reason: Optional[str]
    models_count: int = 0
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ProviderListResponse(BaseModel):
    id: int
    name: str
    type: ProviderType
    priority: int
    status: ProviderStatus
    is_passthrough: bool
    frozen_at: Optional[datetime]
    models_count: int = 0

    class Config:
        from_attributes = True
