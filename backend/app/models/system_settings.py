from datetime import datetime

from sqlalchemy import Column, DateTime, String, Text

from app.db.session import Base


class SystemSettings(Base):
    __tablename__ = "system_settings"

    key = Column(String(100), primary_key=True)
    value = Column(Text, nullable=True)
    description = Column(String(500), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# Default settings keys
DEFAULT_SETTINGS = {
    "log_retention_days": ("30", "Number of days to retain request logs"),
    "default_freeze_duration": ("300", "Default freeze duration in seconds"),
}
