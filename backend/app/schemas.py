from typing import Optional, List
from pydantic import BaseModel, Field


class ProviderBase(BaseModel):
    name: str
    type: str = Field(..., pattern="^(openai|anthropic|gemini)$")
    base_url: str
    api_key: str
    priority: int = 0
    enabled: bool = True
    translate_enabled: bool = False


class ProviderCreate(ProviderBase):
    pass


class ProviderUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = Field(default=None, pattern="^(openai|anthropic|gemini)$")
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    priority: Optional[int] = None
    enabled: Optional[bool] = None
    translate_enabled: Optional[bool] = None


class ProviderOut(ProviderBase):
    id: int
    created_at: str
    updated_at: str
    frozen: bool = False
    freeze_remaining_seconds: int = 0
    last_tested_at: Optional[str] = None
    last_ftl_ms: Optional[int] = None
    last_tps: Optional[float] = None


class ProviderModelCreate(BaseModel):
    model_id: str
    alias: Optional[str] = None


class ProviderModelUpdate(BaseModel):
    model_id: Optional[str] = None
    alias: Optional[str] = None


class ProviderModelOut(BaseModel):
    id: int
    provider_id: int
    model_id: str
    alias: Optional[str] = None
    created_at: str


class ProviderWithModels(ProviderOut):
    models: List[ProviderModelOut]


class ModelSyncResult(BaseModel):
    count: int
    models: List[ProviderModelOut]


class ModelTestResponse(BaseModel):
    tps: Optional[float] = None
    first_token_ms: Optional[int] = None
    latency_ms: Optional[int] = None
    status: str
    error: Optional[str] = None


class ConfigItem(BaseModel):
    key: str
    value: str


class LogEntryOut(BaseModel):
    id: int
    request_id: str
    model_alias: Optional[str]
    model_id: Optional[str]
    provider_id: Optional[int]
    endpoint: str
    request_body: Optional[str]
    response_body: Optional[str]
    is_streaming: bool
    status: str
    latency_ms: Optional[int]
    first_token_ms: Optional[int]
    tokens_in: Optional[int]
    tokens_out: Optional[int]
    tokens_total: Optional[int]
    tokens_cache: Optional[int]
    translated: bool
    created_at: str


class MetricsSummary(BaseModel):
    request_count: int
    success_count: int
    error_count: int
    avg_latency_ms: Optional[float]
    tokens_total: int = 0
