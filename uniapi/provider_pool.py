from __future__ import annotations

import asyncio
import fnmatch
import logging
import random
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import List, Optional

import httpx

from .config import AppConfig, PreferencesConfig, ProviderConfig
from .http_client import create_async_client

logger = logging.getLogger(__name__)


@dataclass
class ProviderState:
    config: ProviderConfig
    model_patterns: List[str]
    cooldown_until: Optional[datetime] = None
    last_error: Optional[str] = None

    def is_on_cooldown(self, now: datetime) -> bool:
        return self.cooldown_until is not None and now < self.cooldown_until

    def supports_model(self, model: str) -> bool:
        if not self.model_patterns:
            return True
        return any(_match_model_pattern(model, pattern) for pattern in self.model_patterns)

    def begin_cooldown(self, preferences: PreferencesConfig, reason: str) -> None:
        seconds = preferences.cooldown_period
        if seconds <= 0:
            logger.debug("Cooldown disabled; skipping cooldown for provider %s", self.config.name)
            self.last_error = reason
            return
        self.cooldown_until = datetime.now(timezone.utc) + timedelta(seconds=seconds)
        self.last_error = reason
        logger.warning(
            "Provider %s entering cooldown for %ss due to: %s",
            self.config.name,
            seconds,
            reason,
        )

    def clear_cooldown(self) -> None:
        self.cooldown_until = None
        self.last_error = None


def _match_model_pattern(model: str, pattern: str) -> bool:
    return fnmatch.fnmatchcase(model, pattern)


class ProviderPool:
    def __init__(self, config: AppConfig) -> None:
        self._config = config
        self._states: List[ProviderState] = []
        self._lock = asyncio.Lock()
        self._client: Optional[httpx.AsyncClient] = None
        self._initialized = False

    @property
    def preferences(self) -> PreferencesConfig:
        return self._config.preferences

    async def list_models(self) -> dict[str, list[str]]:
        if not self._initialized:
            await self.initialize()
        async with self._lock:
            listing: dict[str, list[str]] = {}
            for state in self._states:
                if not state.config.enabled:
                    continue
                patterns = state.model_patterns if state.model_patterns else ["*"]
                listing[state.config.name] = list(patterns)
            return listing

    async def initialize(self) -> None:
        async with self._lock:
            if self._initialized:
                return
            logger.info("Initializing provider pool with %d providers", len(self._config.providers))
            self._client = create_async_client(
                timeout=self.preferences.model_timeout,
                proxy=self.preferences.proxy,
            )
            states: List[ProviderState] = []
            for provider in self._config.providers:
                patterns = provider.models or []
                state = ProviderState(config=provider, model_patterns=list(patterns))
                states.append(state)

            self._states = states
            await self._refresh_missing_model_lists()
            self._initialized = True

    async def shutdown(self) -> None:
        async with self._lock:
            if self._client is not None:
                await self._client.aclose()
                self._client = None
            self._initialized = False

    async def _refresh_missing_model_lists(self) -> None:
        assert self._client is not None
        tasks = []
        for state in self._states:
            if state.model_patterns or not state.config.enabled:
                continue
            tasks.append(self._fetch_models_for_state(state))
        await asyncio.gather(*tasks, return_exceptions=True)

    async def _fetch_models_for_state(self, state: ProviderState) -> None:
        client = self._client
        assert client is not None
        endpoint = state.config.normalized_models_endpoint()
        url = f"{state.config.normalized_base_url()}{endpoint}"
        headers = {
            "Authorization": f"Bearer {state.config.api_key}",
        }
        logger.info("Fetching models for provider %s", state.config.name)
        try:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            payload = response.json()
        except Exception as exc:  # broad to ensure resilience
            logger.warning(
                "Failed to hydrate models from provider %s: %s", state.config.name, exc
            )
            # fallback to wildcard; selection will rely on runtime failures
            state.model_patterns = ["*"]
            return

        data = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(data, list):
            logger.warning(
                "Provider %s returned unexpected %s payload; falling back to wildcard",
                state.config.name,
                endpoint,
            )
            state.model_patterns = ["*"]
            return

        models: List[str] = []
        for entry in data:
            if isinstance(entry, dict):
                model_id = entry.get("id")
            else:
                model_id = None
            if isinstance(model_id, str) and model_id:
                models.append(model_id)

        if not models:
            logger.warning(
                "Provider %s returned empty model list; falling back to wildcard",
                state.config.name,
            )
            state.model_patterns = ["*"]
        else:
            state.model_patterns = models
            logger.info(
                "Provider %s exposes %d models", state.config.name, len(models)
            )

    async def iter_candidates(self, model: str) -> List[ProviderState]:
        if not self._initialized:
            await self.initialize()
        now = datetime.now(timezone.utc)
        available = [
            state
            for state in self._states
            if state.config.enabled and not state.is_on_cooldown(now) and state.supports_model(model)
        ]
        if not available:
            return []

        # Keep only the highest priority providers; shuffle to balance within the tier
        highest_priority = max(state.config.priority for state in available)
        top_candidates = [
            state for state in available if state.config.priority == highest_priority
        ]
        random.shuffle(top_candidates)
        return top_candidates

    def candidates_for_any(self) -> List[ProviderState]:
        now = datetime.now(timezone.utc)
        available = [state for state in self._states if not state.is_on_cooldown(now)]
        available = [state for state in available if state.config.enabled]
        if not available:
            return []

        highest_priority = max(state.config.priority for state in available)
        top_candidates = [
            state for state in available if state.config.priority == highest_priority
        ]
        random.shuffle(top_candidates)
        return top_candidates

    def mark_failure(self, state: ProviderState, reason: str) -> None:
        state.begin_cooldown(self.preferences, reason)

    def mark_success(self, state: ProviderState) -> None:
        state.clear_cooldown()

    def rebuild_on_config_change(self, config: AppConfig) -> None:
        self._config = config
        self._states = []
        self._initialized = False

    @property
    def states(self) -> List[ProviderState]:
        return list(self._states)
