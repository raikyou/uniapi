import secrets
from datetime import datetime
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ApiKey


class ApiKeyService:
    def __init__(self, db: AsyncSession):
        self.db = db

    @staticmethod
    def generate_key() -> str:
        """Generate a new API key"""
        return f"sk-uniapi-{secrets.token_urlsafe(32)}"

    async def get_all(self) -> List[ApiKey]:
        """Get all API keys"""
        query = select(ApiKey).order_by(ApiKey.created_at.desc())
        result = await self.db.execute(query)
        return result.scalars().all()

    async def get_by_id(self, key_id: int) -> Optional[ApiKey]:
        """Get API key by ID"""
        query = select(ApiKey).where(ApiKey.id == key_id)
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def get_by_key(self, key: str) -> Optional[ApiKey]:
        """Get API key by key value"""
        query = select(ApiKey).where(ApiKey.key == key)
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def create(self, name: str) -> ApiKey:
        """Create a new API key"""
        api_key = ApiKey(
            key=self.generate_key(),
            name=name,
            is_active=True,
        )
        self.db.add(api_key)
        await self.db.commit()
        await self.db.refresh(api_key)
        return api_key

    async def delete(self, key_id: int) -> bool:
        """Delete an API key"""
        api_key = await self.get_by_id(key_id)
        if not api_key:
            return False

        await self.db.delete(api_key)
        await self.db.commit()
        return True

    async def validate(self, key: str) -> Optional[ApiKey]:
        """Validate an API key and update last_used_at"""
        api_key = await self.get_by_key(key)
        if not api_key or not api_key.is_active:
            return None

        api_key.last_used_at = datetime.utcnow()
        await self.db.commit()
        return api_key
