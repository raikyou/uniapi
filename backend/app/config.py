from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # Database
    database_url: str = "sqlite+aiosqlite:///./uniapi.db"

    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False

    # Security
    secret_key: str = "change-me-in-production"

    # Log retention
    log_retention_days: int = 30

    # Default freeze duration (seconds)
    default_freeze_duration: int = 300


@lru_cache
def get_settings() -> Settings:
    return Settings()
