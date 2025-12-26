from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class RequestLogResponse(BaseModel):
    id: int
    request_id: str
    endpoint: str
    method: str
    model: Optional[str]
    is_stream: bool
    provider_name: Optional[str]
    is_passthrough: bool
    status_code: Optional[int]
    latency_ms: Optional[float]
    first_token_latency_ms: Optional[float]
    input_tokens: Optional[int]
    output_tokens: Optional[int]
    total_tokens: Optional[int]
    cache_tokens: Optional[int]
    is_success: bool
    created_at: datetime

    class Config:
        from_attributes = True


class RequestLogDetailResponse(RequestLogResponse):
    request_body: Optional[str]
    response_body: Optional[str]
    error_message: Optional[str]
    failover_count: int
    failover_providers: Optional[str]


class RequestLogListParams(BaseModel):
    page: int = 1
    page_size: int = 20
    provider_id: Optional[int] = None
    model: Optional[str] = None
    is_success: Optional[bool] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None


class PaginatedResponse(BaseModel):
    items: List[RequestLogResponse]
    total: int
    page: int
    page_size: int
    total_pages: int
