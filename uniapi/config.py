from __future__ import annotations

import pathlib
from dataclasses import dataclass, field
from typing import List, Optional

import yaml


_BOOLEAN_TRUE = {"true", "yes", "1", "on"}
_BOOLEAN_FALSE = {"false", "no", "0", "off"}


def _coerce_bool(value, *, field: str, provider: str, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in _BOOLEAN_TRUE:
            return True
        if normalized in _BOOLEAN_FALSE:
            return False
    raise ConfigError(
        f"Provider {field} for {provider} must be a boolean or boolean-like value"
    )


@dataclass(frozen=True)
class ProviderConfig:
    name: str
    base_url: str
    api_key: str
    priority: int = 0
    models: Optional[List[str]] = None
    models_endpoint: str = "/v1/models"
    enabled: bool = True

    def normalized_base_url(self) -> str:
        return self.base_url.rstrip("/")

    def normalized_models_endpoint(self) -> str:
        endpoint = self.models_endpoint.strip() if self.models_endpoint else "/v1/models"
        if not endpoint.startswith("/"):
            endpoint = f"/{endpoint}"
        return endpoint


@dataclass(frozen=True)
class PreferencesConfig:
    model_timeout: float = 20.0
    cooldown_period: float = 300.0
    proxy: Optional[str] = None


@dataclass(frozen=True)
class AppConfig:
    api_key: str
    providers: List[ProviderConfig] = field(default_factory=list)
    preferences: PreferencesConfig = PreferencesConfig()


class ConfigError(ValueError):
    """Raised when the configuration file is invalid."""


def _load_yaml(path: pathlib.Path) -> dict:
    try:
        with path.open("r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
    except FileNotFoundError as exc:
        raise ConfigError(f"Config file not found: {path}") from exc
    except yaml.YAMLError as exc:
        raise ConfigError(f"Invalid YAML in config file {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise ConfigError("Top-level config structure must be a mapping")
    return data


def load_config(path: str | pathlib.Path) -> AppConfig:
    path = pathlib.Path(path)
    raw = _load_yaml(path)

    providers_raw = raw.get("providers") or []
    if not isinstance(providers_raw, list) or not providers_raw:
        raise ConfigError("At least one provider must be configured under 'providers'")

    providers: List[ProviderConfig] = []
    for idx, entry in enumerate(providers_raw):
        if not isinstance(entry, dict):
            raise ConfigError(f"Provider entry at index {idx} must be a mapping")
        try:
            name = entry["provider"]
            base_url = entry["base_url"]
            api_key = entry["api_key"]
        except KeyError as exc:
            raise ConfigError(
                f"Provider entry at index {idx} is missing required key: {exc.args[0]}"
            ) from exc

        if not isinstance(name, str) or not name:
            raise ConfigError(f"Provider name at index {idx} must be a non-empty string")
        if not isinstance(base_url, str) or not base_url:
            raise ConfigError(f"Provider base_url for {name} must be a non-empty string")
        if not isinstance(api_key, str) or not api_key:
            raise ConfigError(f"Provider api_key for {name} must be a non-empty string")

        priority = entry.get("priority", 0)
        if not isinstance(priority, int):
            raise ConfigError(f"Provider priority for {name} must be an integer")

        models_raw = entry.get("model")
        if models_raw is None:
            models = None
        else:
            if not isinstance(models_raw, list) or not models_raw:
                raise ConfigError(
                    f"Provider models for {name} must be a non-empty list of model identifiers"
                )
            models = []
            for model_value in models_raw:
                if not isinstance(model_value, str) or not model_value:
                    raise ConfigError(
                        f"Provider model value for {name} must be a non-empty string"
                    )
                models.append(model_value)

        models_endpoint_raw = entry.get("models_endpoint", "/v1/models")
        if not isinstance(models_endpoint_raw, str) or not models_endpoint_raw.strip():
            raise ConfigError(f"Provider models_endpoint for {name} must be a non-empty string")
        models_endpoint = models_endpoint_raw.strip()

        enabled = _coerce_bool(
            entry.get("enabled"), field="enabled", provider=name, default=True
        )

        providers.append(
            ProviderConfig(
                name=name,
                base_url=base_url,
                api_key=api_key,
                priority=priority,
                models=models,
                models_endpoint=models_endpoint,
                enabled=enabled,
            )
        )

    preferences_raw = raw.get("preferences") or {}
    if not isinstance(preferences_raw, dict):
        raise ConfigError("'preferences' section must be a mapping if provided")

    model_timeout = preferences_raw.get("model_timeout", 20)
    cooldown_period = preferences_raw.get("cooldown_period", 300)
    proxy = preferences_raw.get("proxy")

    try:
        model_timeout_val = float(model_timeout)
        cooldown_period_val = float(cooldown_period)
    except (TypeError, ValueError) as exc:
        raise ConfigError("model_timeout and cooldown_period must be numeric") from exc
    if model_timeout_val <= 0:
        raise ConfigError("model_timeout must be greater than zero")
    if cooldown_period_val < 0:
        raise ConfigError("cooldown_period must be zero or greater")

    preferences = PreferencesConfig(
        model_timeout=model_timeout_val,
        cooldown_period=cooldown_period_val,
        proxy=proxy,
    )

    if "api_key" not in raw:
        raise ConfigError("api_key must be provided at the top level of the config")

    api_key_value = raw.get("api_key")
    if not isinstance(api_key_value, str) or not api_key_value.strip():
        raise ConfigError("api_key must be a non-empty string")

    return AppConfig(
        api_key=api_key_value.strip(),
        providers=providers,
        preferences=preferences,
    )
