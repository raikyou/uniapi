"""
Gateway core logic - handles LLM requests with failover support
"""

import json
import time
import uuid
from datetime import datetime
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple, Union

import litellm
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Model, Provider, ProviderStatus, ProviderType, RequestLog
from app.services.provider_service import ProviderService

# Disable LiteLLM telemetry
litellm.telemetry = False


class GatewayService:
    """Core gateway service for routing LLM requests"""

    # LiteLLM provider prefixes
    PROVIDER_PREFIX_MAP = {
        ProviderType.OPENAI: "",
        ProviderType.ANTHROPIC: "anthropic/",
        ProviderType.GEMINI: "gemini/",
        ProviderType.AZURE_OPENAI: "azure/",
        ProviderType.BEDROCK: "bedrock/",
        ProviderType.VERTEX_AI: "vertex_ai/",
        ProviderType.OLLAMA: "ollama/",
        ProviderType.GROQ: "groq/",
        ProviderType.DEEPSEEK: "deepseek/",
        ProviderType.MISTRAL: "mistral/",
        ProviderType.COHERE: "cohere/",
    }

    def __init__(self, db: AsyncSession):
        self.db = db
        self.provider_service = ProviderService(db)

    async def chat_completion(
        self,
        model: str,
        messages: List[Dict[str, Any]],
        stream: bool = False,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        top_p: Optional[float] = None,
        stop: Optional[Union[str, List[str]]] = None,
        tools: Optional[List[Dict]] = None,
        tool_choice: Optional[Union[str, Dict]] = None,
        **kwargs,
    ) -> Union[Dict, AsyncIterator]:
        """
        Handle chat completion request with automatic failover
        """
        request_id = str(uuid.uuid4())
        start_time = time.time()
        request_body = {
            "model": model,
            "messages": messages,
            "stream": stream,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

        # Get available providers
        providers = await self._get_providers_for_model(model)
        if not providers:
            raise HTTPException(
                status_code=503,
                detail=f"No available provider for model: {model}",
            )

        last_error = None
        attempted_providers = []

        for provider, actual_model in providers:
            attempted_providers.append(provider.name)

            # Check if provider is set to passthrough mode
            if provider.is_passthrough:
                # Use passthrough handler instead
                continue

            try:
                if stream:
                    return await self._stream_chat_completion(
                        request_id=request_id,
                        provider=provider,
                        model=actual_model,
                        messages=messages,
                        temperature=temperature,
                        max_tokens=max_tokens,
                        top_p=top_p,
                        stop=stop,
                        tools=tools,
                        tool_choice=tool_choice,
                        start_time=start_time,
                        request_body=request_body,
                        **kwargs,
                    )
                else:
                    return await self._call_chat_completion(
                        request_id=request_id,
                        provider=provider,
                        model=actual_model,
                        messages=messages,
                        temperature=temperature,
                        max_tokens=max_tokens,
                        top_p=top_p,
                        stop=stop,
                        tools=tools,
                        tool_choice=tool_choice,
                        start_time=start_time,
                        request_body=request_body,
                        **kwargs,
                    )

            except Exception as e:
                last_error = e
                error_str = str(e).lower()

                # Check if we should freeze the provider
                if self._is_permanent_error(error_str):
                    await self.provider_service.freeze(
                        provider.id,
                        reason=str(e)[:500],
                    )

                # Log the failure
                await self._log_request(
                    request_id=request_id,
                    endpoint="/v1/chat/completions",
                    model=model,
                    is_stream=stream,
                    request_body=json.dumps(request_body),
                    provider=provider,
                    is_success=False,
                    error_message=str(e)[:1000],
                    start_time=start_time,
                    attempted_providers=attempted_providers,
                )

                continue

        # All providers failed
        raise HTTPException(
            status_code=503,
            detail=f"All providers failed. Last error: {last_error}",
        )

    async def _call_chat_completion(
        self,
        request_id: str,
        provider: Provider,
        model: str,
        messages: List[Dict],
        start_time: float,
        request_body: Dict,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        top_p: Optional[float] = None,
        stop: Optional[Union[str, List[str]]] = None,
        tools: Optional[List[Dict]] = None,
        tool_choice: Optional[Union[str, Dict]] = None,
        **kwargs,
    ) -> Dict:
        """Make a non-streaming chat completion call"""

        litellm_model = self._build_litellm_model(provider, model)

        params = {
            "model": litellm_model,
            "messages": messages,
            "api_key": provider.api_key,
        }

        if provider.base_url:
            params["api_base"] = provider.base_url

        if temperature is not None:
            params["temperature"] = temperature
        if max_tokens is not None:
            params["max_tokens"] = max_tokens
        if top_p is not None:
            params["top_p"] = top_p
        if stop is not None:
            params["stop"] = stop
        if tools is not None:
            params["tools"] = tools
        if tool_choice is not None:
            params["tool_choice"] = tool_choice

        # Add extra config from provider
        if provider.extra_config:
            try:
                extra = json.loads(provider.extra_config)
                params.update(extra)
            except json.JSONDecodeError:
                pass

        # Call LiteLLM
        response = await litellm.acompletion(**params)

        # Calculate metrics
        latency_ms = (time.time() - start_time) * 1000
        usage = response.get("usage", {})

        # Log success
        await self._log_request(
            request_id=request_id,
            endpoint="/v1/chat/completions",
            model=model,
            is_stream=False,
            request_body=json.dumps(request_body),
            response_body=json.dumps(response.model_dump()),
            provider=provider,
            is_success=True,
            latency_ms=latency_ms,
            input_tokens=usage.get("prompt_tokens"),
            output_tokens=usage.get("completion_tokens"),
            total_tokens=usage.get("total_tokens"),
            start_time=start_time,
        )

        return response.model_dump()

    async def _stream_chat_completion(
        self,
        request_id: str,
        provider: Provider,
        model: str,
        messages: List[Dict],
        start_time: float,
        request_body: Dict,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        top_p: Optional[float] = None,
        stop: Optional[Union[str, List[str]]] = None,
        tools: Optional[List[Dict]] = None,
        tool_choice: Optional[Union[str, Dict]] = None,
        **kwargs,
    ) -> AsyncIterator:
        """Make a streaming chat completion call"""

        litellm_model = self._build_litellm_model(provider, model)

        params = {
            "model": litellm_model,
            "messages": messages,
            "api_key": provider.api_key,
            "stream": True,
        }

        if provider.base_url:
            params["api_base"] = provider.base_url

        if temperature is not None:
            params["temperature"] = temperature
        if max_tokens is not None:
            params["max_tokens"] = max_tokens
        if top_p is not None:
            params["top_p"] = top_p
        if stop is not None:
            params["stop"] = stop
        if tools is not None:
            params["tools"] = tools
        if tool_choice is not None:
            params["tool_choice"] = tool_choice

        if provider.extra_config:
            try:
                extra = json.loads(provider.extra_config)
                params.update(extra)
            except json.JSONDecodeError:
                pass

        response = await litellm.acompletion(**params)

        async def stream_generator():
            first_token_time = None
            collected_content = []
            usage_info = {}

            async for chunk in response:
                if first_token_time is None:
                    first_token_time = time.time()

                # Collect content for logging
                if chunk.choices and chunk.choices[0].delta.content:
                    collected_content.append(chunk.choices[0].delta.content)

                # Check for usage in final chunk
                if hasattr(chunk, "usage") and chunk.usage:
                    usage_info = {
                        "prompt_tokens": chunk.usage.prompt_tokens,
                        "completion_tokens": chunk.usage.completion_tokens,
                        "total_tokens": chunk.usage.total_tokens,
                    }

                yield f"data: {json.dumps(chunk.model_dump())}\n\n"

            yield "data: [DONE]\n\n"

            # Log after streaming complete
            latency_ms = (time.time() - start_time) * 1000
            first_token_latency_ms = (
                (first_token_time - start_time) * 1000 if first_token_time else None
            )

            await self._log_request(
                request_id=request_id,
                endpoint="/v1/chat/completions",
                model=model,
                is_stream=True,
                request_body=json.dumps(request_body),
                response_body="".join(collected_content)[:10000],
                provider=provider,
                is_success=True,
                latency_ms=latency_ms,
                first_token_latency_ms=first_token_latency_ms,
                input_tokens=usage_info.get("prompt_tokens"),
                output_tokens=usage_info.get("completion_tokens"),
                total_tokens=usage_info.get("total_tokens"),
                start_time=start_time,
            )

        return stream_generator()

    async def embedding(
        self,
        model: str,
        input: Union[str, List[str]],
        **kwargs,
    ) -> Dict:
        """Handle embedding request"""
        request_id = str(uuid.uuid4())
        start_time = time.time()

        providers = await self._get_providers_for_model(model)
        if not providers:
            raise HTTPException(
                status_code=503,
                detail=f"No available provider for model: {model}",
            )

        last_error = None

        for provider, actual_model in providers:
            if provider.is_passthrough:
                continue

            try:
                litellm_model = self._build_litellm_model(provider, model)

                params = {
                    "model": litellm_model,
                    "input": input,
                    "api_key": provider.api_key,
                }

                if provider.base_url:
                    params["api_base"] = provider.base_url

                response = await litellm.aembedding(**params)
                latency_ms = (time.time() - start_time) * 1000

                await self._log_request(
                    request_id=request_id,
                    endpoint="/v1/embeddings",
                    model=model,
                    is_stream=False,
                    provider=provider,
                    is_success=True,
                    latency_ms=latency_ms,
                    start_time=start_time,
                )

                return response.model_dump()

            except Exception as e:
                last_error = e
                if self._is_permanent_error(str(e).lower()):
                    await self.provider_service.freeze(provider.id, reason=str(e)[:500])
                continue

        raise HTTPException(
            status_code=503,
            detail=f"All providers failed. Last error: {last_error}",
        )

    async def _get_providers_for_model(
        self, model: str
    ) -> List[Tuple[Provider, str]]:
        """
        Get available providers for a model, ordered by priority.
        Returns list of (provider, actual_model_id) tuples.
        """
        available_providers = await self.provider_service.get_available_providers()

        result = []
        for provider in available_providers:
            # For now, assume the model ID is the same across providers
            # In future, use model mapping table
            result.append((provider, model))

        return result

    def _build_litellm_model(self, provider: Provider, model: str) -> str:
        """Build LiteLLM model identifier"""
        prefix = self.PROVIDER_PREFIX_MAP.get(provider.type, "")
        return f"{prefix}{model}"

    def _is_permanent_error(self, error_str: str) -> bool:
        """Check if error should trigger provider freeze"""
        permanent_indicators = [
            "authentication",
            "invalid api key",
            "invalid_api_key",
            "401",
            "403",
            "quota exceeded",
            "insufficient_quota",
            "billing",
        ]
        return any(ind in error_str for ind in permanent_indicators)

    async def _log_request(
        self,
        request_id: str,
        endpoint: str,
        model: str,
        is_stream: bool,
        provider: Optional[Provider],
        is_success: bool,
        start_time: float,
        request_body: Optional[str] = None,
        response_body: Optional[str] = None,
        error_message: Optional[str] = None,
        latency_ms: Optional[float] = None,
        first_token_latency_ms: Optional[float] = None,
        input_tokens: Optional[int] = None,
        output_tokens: Optional[int] = None,
        total_tokens: Optional[int] = None,
        attempted_providers: Optional[List[str]] = None,
    ):
        """Log request to database"""
        log = RequestLog(
            request_id=request_id,
            endpoint=endpoint,
            method="POST",
            model=model,
            is_stream=is_stream,
            request_body=request_body,
            response_body=response_body,
            provider_id=provider.id if provider else None,
            provider_name=provider.name if provider else None,
            is_passthrough=provider.is_passthrough if provider else False,
            status_code=200 if is_success else 500,
            latency_ms=latency_ms or ((time.time() - start_time) * 1000),
            first_token_latency_ms=first_token_latency_ms,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens,
            is_success=is_success,
            error_message=error_message,
            failover_count=len(attempted_providers) - 1 if attempted_providers else 0,
            failover_providers=json.dumps(attempted_providers) if attempted_providers else None,
        )
        self.db.add(log)
        await self.db.commit()
