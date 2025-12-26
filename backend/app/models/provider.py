import enum
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Enum, Integer, String, Text
from sqlalchemy.orm import relationship

from app.db.session import Base


class ProviderType(str, enum.Enum):
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    GEMINI = "gemini"
    AZURE_OPENAI = "azure_openai"
    BEDROCK = "bedrock"
    VERTEX_AI = "vertex_ai"
    OLLAMA = "ollama"
    GROQ = "groq"
    DEEPSEEK = "deepseek"
    MISTRAL = "mistral"
    COHERE = "cohere"
    CUSTOM = "custom"


class ProviderStatus(str, enum.Enum):
    ACTIVE = "active"
    DISABLED = "disabled"
    FROZEN = "frozen"


class Provider(Base):
    __tablename__ = "providers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, unique=True, index=True)
    type = Column(Enum(ProviderType), nullable=False)

    # Connection config
    base_url = Column(String(500), nullable=True)
    api_key = Column(Text, nullable=False)  # Encrypted in production
    extra_config = Column(Text, nullable=True)  # JSON string for extra config

    # Priority and status
    priority = Column(Integer, default=0, index=True)
    status = Column(Enum(ProviderStatus), default=ProviderStatus.ACTIVE)
    is_passthrough = Column(Boolean, default=False)

    # Freeze related
    frozen_at = Column(DateTime, nullable=True)
    freeze_duration = Column(Integer, default=300)  # Seconds
    freeze_reason = Column(String(500), nullable=True)

    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    models = relationship("Model", back_populates="provider", cascade="all, delete-orphan")
