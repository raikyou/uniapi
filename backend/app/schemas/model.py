import json
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


class ModelBase(BaseModel):
    model_id: str = Field(..., min_length=1, max_length=200)
    display_name: Optional[str] = None
    alias: Optional[str] = None
    capabilities: List[str] = []
    max_tokens: Optional[int] = None
    context_window: Optional[int] = None
    is_enabled: bool = True


class ModelCreate(ModelBase):
    pass


class ModelUpdate(BaseModel):
    display_name: Optional[str] = None
    alias: Optional[str] = None
    capabilities: Optional[List[str]] = None
    max_tokens: Optional[int] = None
    context_window: Optional[int] = None
    is_enabled: Optional[bool] = None


class ModelStatusUpdate(BaseModel):
    is_enabled: bool


class ModelResponse(BaseModel):
    id: int
    provider_id: int
    model_id: str
    display_name: Optional[str]
    alias: Optional[str]
    capabilities: List[str]
    max_tokens: Optional[int]
    context_window: Optional[int]
    is_enabled: bool
    last_tested_at: Optional[datetime]
    avg_tps: Optional[float]
    avg_first_token_latency: Optional[float]
    created_at: datetime
    updated_at: datetime

    @field_validator("capabilities", mode="before")
    @classmethod
    def parse_capabilities(cls, v):
        if isinstance(v, str):
            return json.loads(v)
        return v

    class Config:
        from_attributes = True


class ModelBenchmarkResult(BaseModel):
    model_id: int
    tps: float
    first_token_latency_ms: float
    total_latency_ms: float
    output_tokens: int
