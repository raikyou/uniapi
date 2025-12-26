import json
from datetime import datetime
from typing import List, Optional

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Model, Provider, ProviderType
from app.schemas.model import ModelCreate, ModelUpdate


class ModelService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_id(self, model_id: int) -> Optional[Model]:
        """Get a model by ID"""
        query = select(Model).where(Model.id == model_id)
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def get_by_provider(self, provider_id: int) -> List[Model]:
        """Get all models for a provider"""
        query = select(Model).where(Model.provider_id == provider_id)
        result = await self.db.execute(query)
        return result.scalars().all()

    async def get_by_alias(self, alias: str) -> Optional[Model]:
        """Get a model by alias"""
        query = select(Model).where(Model.alias == alias)
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def get_by_model_id(self, provider_id: int, model_id: str) -> Optional[Model]:
        """Get a model by provider and model_id"""
        query = select(Model).where(
            Model.provider_id == provider_id, Model.model_id == model_id
        )
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def create(self, provider_id: int, data: ModelCreate) -> Model:
        """Create a new model"""
        model = Model(
            provider_id=provider_id,
            model_id=data.model_id,
            display_name=data.display_name,
            alias=data.alias,
            capabilities=json.dumps(data.capabilities),
            max_tokens=data.max_tokens,
            context_window=data.context_window,
            is_enabled=data.is_enabled,
        )
        self.db.add(model)
        await self.db.commit()
        await self.db.refresh(model)
        return model

    async def update(self, model_id: int, data: ModelUpdate) -> Optional[Model]:
        """Update a model"""
        model = await self.get_by_id(model_id)
        if not model:
            return None

        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            if field == "capabilities" and value is not None:
                value = json.dumps(value)
            setattr(model, field, value)

        model.updated_at = datetime.utcnow()
        await self.db.commit()
        await self.db.refresh(model)
        return model

    async def delete(self, model_id: int) -> bool:
        """Delete a model"""
        model = await self.get_by_id(model_id)
        if not model:
            return False

        await self.db.delete(model)
        await self.db.commit()
        return True

    async def update_status(self, model_id: int, is_enabled: bool) -> Optional[Model]:
        """Update model enabled status"""
        model = await self.get_by_id(model_id)
        if not model:
            return None

        model.is_enabled = is_enabled
        model.updated_at = datetime.utcnow()
        await self.db.commit()
        await self.db.refresh(model)
        return model

    async def update_benchmark(
        self, model_id: int, tps: float, first_token_latency: float
    ) -> Optional[Model]:
        """Update model benchmark results"""
        model = await self.get_by_id(model_id)
        if not model:
            return None

        model.avg_tps = tps
        model.avg_first_token_latency = first_token_latency
        model.last_tested_at = datetime.utcnow()
        model.updated_at = datetime.utcnow()

        await self.db.commit()
        await self.db.refresh(model)
        return model

    async def fetch_from_provider(self, provider: Provider) -> List[str]:
        """Fetch model list from provider API"""
        models = []

        try:
            if provider.type == ProviderType.OPENAI:
                models = await self._fetch_openai_models(provider)
            elif provider.type == ProviderType.ANTHROPIC:
                models = await self._fetch_anthropic_models(provider)
            elif provider.type == ProviderType.GEMINI:
                models = await self._fetch_gemini_models(provider)
            else:
                # Use LiteLLM for other providers
                models = await self._fetch_litellm_models(provider)

            # Save models to database
            for model_id in models:
                existing = await self.get_by_model_id(provider.id, model_id)
                if not existing:
                    model = Model(
                        provider_id=provider.id,
                        model_id=model_id,
                        display_name=model_id,
                        capabilities=json.dumps(["chat"]),
                        is_enabled=True,
                    )
                    self.db.add(model)

            await self.db.commit()

        except Exception as e:
            # Log error but don't fail
            print(f"Error fetching models from {provider.name}: {e}")

        return models

    async def _fetch_openai_models(self, provider: Provider) -> List[str]:
        """Fetch models from OpenAI API"""
        base_url = provider.base_url or "https://api.openai.com"
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{base_url}/v1/models",
                headers={"Authorization": f"Bearer {provider.api_key}"},
                timeout=30,
            )
            response.raise_for_status()
            data = response.json()
            return [m["id"] for m in data.get("data", [])]

    async def _fetch_anthropic_models(self, provider: Provider) -> List[str]:
        """Return known Anthropic models (no list API)"""
        return [
            "claude-3-5-sonnet-20241022",
            "claude-3-5-haiku-20241022",
            "claude-3-opus-20240229",
            "claude-3-sonnet-20240229",
            "claude-3-haiku-20240307",
        ]

    async def _fetch_gemini_models(self, provider: Provider) -> List[str]:
        """Return known Gemini models"""
        return [
            "gemini-2.0-flash-exp",
            "gemini-1.5-pro",
            "gemini-1.5-flash",
            "gemini-1.5-flash-8b",
        ]

    async def _fetch_litellm_models(self, provider: Provider) -> List[str]:
        """Fetch models using LiteLLM"""
        # LiteLLM doesn't have a direct model list API
        # Return empty list for now
        return []
