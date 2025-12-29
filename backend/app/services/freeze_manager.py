from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Dict

from ..settings import FREEZE_DURATION_SECONDS
from .config_service import get_config


class FreezeManager:
    def __init__(self) -> None:
        self._frozen_until: Dict[int, datetime] = {}

    def freeze(self, provider_id: int) -> None:
        duration = FREEZE_DURATION_SECONDS
        value = get_config("freeze_duration_seconds")
        if value:
            try:
                duration = int(value)
            except ValueError:
                duration = FREEZE_DURATION_SECONDS
        self._frozen_until[provider_id] = datetime.now(timezone.utc) + timedelta(
            seconds=duration
        )

    def unfreeze(self, provider_id: int) -> None:
        self._frozen_until.pop(provider_id, None)

    def is_frozen(self, provider_id: int) -> bool:
        until = self._frozen_until.get(provider_id)
        if not until:
            return False
        if datetime.now(timezone.utc) >= until:
            self._frozen_until.pop(provider_id, None)
            return False
        return True

    def remaining_seconds(self, provider_id: int) -> int:
        until = self._frozen_until.get(provider_id)
        if not until:
            return 0
        remaining = int((until - datetime.now(timezone.utc)).total_seconds())
        return max(0, remaining)
