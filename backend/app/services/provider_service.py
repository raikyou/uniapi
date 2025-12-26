import json
from datetime import datetime
from typing import List, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Model, Provider, ProviderStatus
from app.schemas.provider import ProviderCreate, ProviderUpdate


class ProviderService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_all(self, include_disabled: bool = True) -> List[Provider]:
        """Get all providers ordered by priority DESC"""
        query = select(Provider).order_by(Provider.priority.desc())
        if not include_disabled:
            query = query.where(Provider.status != ProviderStatus.DISABLED)
        result = await self.db.execute(query)
        return result.scalars().all()

    async def get_by_id(self, provider_id: int) -> Optional[Provider]:
        """Get a provider by ID"""
        query = select(Provider).where(Provider.id == provider_id)
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def get_by_name(self, name: str) -> Optional[Provider]:
        """Get a provider by name"""
        query = select(Provider).where(Provider.name == name)
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def create(self, data: ProviderCreate) -> Provider:
        """Create a new provider"""
        provider = Provider(
            name=data.name,
            type=data.type,
            base_url=data.base_url,
            api_key=data.api_key,
            extra_config=data.extra_config,
            priority=data.priority,
            is_passthrough=data.is_passthrough,
            freeze_duration=data.freeze_duration,
        )
        self.db.add(provider)
        await self.db.commit()
        await self.db.refresh(provider)
        return provider

    async def update(self, provider_id: int, data: ProviderUpdate) -> Optional[Provider]:
        """Update a provider"""
        provider = await self.get_by_id(provider_id)
        if not provider:
            return None

        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(provider, field, value)

        provider.updated_at = datetime.utcnow()
        await self.db.commit()
        await self.db.refresh(provider)
        return provider

    async def delete(self, provider_id: int) -> bool:
        """Delete a provider"""
        provider = await self.get_by_id(provider_id)
        if not provider:
            return False

        await self.db.delete(provider)
        await self.db.commit()
        return True

    async def update_status(self, provider_id: int, status: ProviderStatus) -> Optional[Provider]:
        """Update provider status"""
        provider = await self.get_by_id(provider_id)
        if not provider:
            return None

        provider.status = status
        if status != ProviderStatus.FROZEN:
            provider.frozen_at = None
            provider.freeze_reason = None

        provider.updated_at = datetime.utcnow()
        await self.db.commit()
        await self.db.refresh(provider)
        return provider

    async def freeze(
        self, provider_id: int, reason: str, duration: Optional[int] = None
    ) -> Optional[Provider]:
        """Freeze a provider"""
        provider = await self.get_by_id(provider_id)
        if not provider:
            return None

        provider.status = ProviderStatus.FROZEN
        provider.frozen_at = datetime.utcnow()
        provider.freeze_reason = reason
        if duration:
            provider.freeze_duration = duration

        await self.db.commit()
        await self.db.refresh(provider)
        return provider

    async def unfreeze(self, provider_id: int) -> Optional[Provider]:
        """Unfreeze a provider"""
        provider = await self.get_by_id(provider_id)
        if not provider:
            return None

        provider.status = ProviderStatus.ACTIVE
        provider.frozen_at = None
        provider.freeze_reason = None
        provider.updated_at = datetime.utcnow()

        await self.db.commit()
        await self.db.refresh(provider)
        return provider

    async def get_models_count(self, provider_id: int) -> int:
        """Get count of models for a provider"""
        query = select(func.count(Model.id)).where(Model.provider_id == provider_id)
        result = await self.db.execute(query)
        return result.scalar() or 0

    async def get_available_providers(
        self, model_alias: Optional[str] = None
    ) -> List[Provider]:
        """Get available (active and not frozen) providers ordered by priority"""
        query = (
            select(Provider)
            .where(Provider.status == ProviderStatus.ACTIVE)
            .order_by(Provider.priority.desc())
        )
        result = await self.db.execute(query)
        providers = result.scalars().all()

        # Filter out frozen providers based on freeze time
        available = []
        now = datetime.utcnow()
        for provider in providers:
            if provider.frozen_at:
                elapsed = (now - provider.frozen_at).total_seconds()
                if elapsed < provider.freeze_duration:
                    continue  # Still frozen
                else:
                    # Auto unfreeze
                    provider.status = ProviderStatus.ACTIVE
                    provider.frozen_at = None
                    provider.freeze_reason = None

            available.append(provider)

        if available:
            await self.db.commit()

        return available
