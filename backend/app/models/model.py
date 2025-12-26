from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.db.session import Base


class Model(Base):
    __tablename__ = "models"

    id = Column(Integer, primary_key=True, index=True)
    provider_id = Column(Integer, ForeignKey("providers.id"), nullable=False)

    # Model identification
    model_id = Column(String(200), nullable=False)  # Actual model ID (e.g., gpt-4o)
    display_name = Column(String(200), nullable=True)  # Display name
    alias = Column(String(200), nullable=True, index=True)  # Unified alias

    # Capabilities (JSON string: ["chat", "embedding", "image_gen", "image_recognition"])
    capabilities = Column(Text, default="[]")

    # Limits
    max_tokens = Column(Integer, nullable=True)
    context_window = Column(Integer, nullable=True)

    # Status
    is_enabled = Column(Boolean, default=True)

    # Test metrics
    last_tested_at = Column(DateTime, nullable=True)
    avg_tps = Column(Float, nullable=True)  # Average tokens per second
    avg_first_token_latency = Column(Float, nullable=True)  # First token latency in ms

    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    provider = relationship("Provider", back_populates="models")
