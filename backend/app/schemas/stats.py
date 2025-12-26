from typing import Dict, List, Optional

from pydantic import BaseModel


class OverviewStats(BaseModel):
    total_requests: int
    successful_requests: int
    failed_requests: int
    total_tokens: int
    avg_latency_ms: float
    avg_first_token_latency_ms: float
    active_providers: int
    total_models: int


class TimeSeriesPoint(BaseModel):
    timestamp: str
    value: float


class RequestStats(BaseModel):
    total: int
    by_time: List[TimeSeriesPoint]


class TokenStats(BaseModel):
    total_input: int
    total_output: int
    total_cache: int
    by_time: List[TimeSeriesPoint]


class LatencyStats(BaseModel):
    avg_latency_ms: float
    avg_first_token_latency_ms: float
    p50_latency_ms: float
    p90_latency_ms: float
    p99_latency_ms: float


class ProviderStats(BaseModel):
    provider_id: int
    provider_name: str
    request_count: int
    success_rate: float
    avg_latency_ms: float
    total_tokens: int
