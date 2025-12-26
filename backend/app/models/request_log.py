from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text

from app.db.session import Base


class RequestLog(Base):
    __tablename__ = "request_logs"

    id = Column(Integer, primary_key=True, index=True)
    request_id = Column(String(50), nullable=False, unique=True, index=True)

    # Request info
    endpoint = Column(String(200), nullable=False)
    method = Column(String(10), default="POST")
    model = Column(String(200), nullable=True)
    is_stream = Column(Boolean, default=False)
    request_body = Column(Text, nullable=True)  # JSON string
    response_body = Column(Text, nullable=True)  # JSON string or final streamed result

    # Provider info
    provider_id = Column(Integer, ForeignKey("providers.id", ondelete="SET NULL"), nullable=True)
    provider_name = Column(String(100), nullable=True)
    is_passthrough = Column(Boolean, default=False)

    # Performance metrics
    status_code = Column(Integer, nullable=True)
    latency_ms = Column(Float, nullable=True)  # Total latency
    first_token_latency_ms = Column(Float, nullable=True)  # First token latency

    # Token stats
    input_tokens = Column(Integer, nullable=True)
    output_tokens = Column(Integer, nullable=True)
    total_tokens = Column(Integer, nullable=True)
    cache_tokens = Column(Integer, nullable=True)

    # Failover info
    is_success = Column(Boolean, default=True)
    error_message = Column(String(1000), nullable=True)
    failover_count = Column(Integer, default=0)
    failover_providers = Column(Text, nullable=True)  # JSON array

    # Timestamp
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
