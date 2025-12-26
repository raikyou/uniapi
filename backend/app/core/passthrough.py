"""
Passthrough handler - forwards requests directly to providers without format conversion
"""

import json
from typing import AsyncIterator, Dict, Optional

import httpx
from fastapi import HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Provider, ProviderStatus, ProviderType
from app.services.provider_service import ProviderService


class PassthroughHandler:
    """Handle passthrough requests - only replace API key, no format conversion"""

    # Default base URLs for providers
    PROVIDER_ENDPOINTS = {
        ProviderType.OPENAI: "https://api.openai.com",
        ProviderType.ANTHROPIC: "https://api.anthropic.com",
        ProviderType.GEMINI: "https://generativelanguage.googleapis.com",
        ProviderType.GROQ: "https://api.groq.com/openai",
        ProviderType.DEEPSEEK: "https://api.deepseek.com",
        ProviderType.MISTRAL: "https://api.mistral.ai",
        ProviderType.COHERE: "https://api.cohere.ai",
    }

    def __init__(self, db: AsyncSession):
        self.db = db
        self.provider_service = ProviderService(db)
        self.client = httpx.AsyncClient(timeout=120.0)

    async def handle(
        self,
        provider_type: str,
        path: str,
        request: Request,
    ) -> StreamingResponse:
        """
        Forward request to target provider.

        Only does:
        1. Replace API key
        2. Forward request
        3. Failover if multiple providers configured
        """
        try:
            ptype = ProviderType(provider_type)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid provider type: {provider_type}",
            )

        # Get passthrough providers for this type
        providers = await self._get_passthrough_providers(ptype)

        if not providers:
            raise HTTPException(
                status_code=404,
                detail=f"No passthrough provider configured for: {provider_type}",
            )

        # Read request body
        body = await request.body()

        last_error = None
        for provider in providers:
            try:
                return await self._forward_request(
                    provider=provider,
                    path=path,
                    method=request.method,
                    headers=dict(request.headers),
                    body=body,
                )
            except Exception as e:
                last_error = e
                # Freeze provider on permanent errors
                if self._is_permanent_error(str(e).lower()):
                    await self.provider_service.freeze(provider.id, reason=str(e)[:500])
                continue

        raise HTTPException(
            status_code=503,
            detail=f"All passthrough providers failed: {last_error}",
        )

    async def _get_passthrough_providers(
        self, provider_type: ProviderType
    ) -> list[Provider]:
        """Get passthrough-enabled providers of a specific type"""
        all_providers = await self.provider_service.get_available_providers()

        return [
            p
            for p in all_providers
            if p.type == provider_type and p.is_passthrough
        ]

    async def _forward_request(
        self,
        provider: Provider,
        path: str,
        method: str,
        headers: Dict,
        body: bytes,
    ) -> StreamingResponse:
        """Forward a single request to the provider"""

        # Build target URL
        base_url = provider.base_url or self.PROVIDER_ENDPOINTS.get(provider.type)
        if not base_url:
            raise ValueError(f"No base URL for provider type: {provider.type}")

        target_url = f"{base_url}/{path.lstrip('/')}"

        # Filter and replace headers
        new_headers = {}
        skip_headers = {"host", "authorization", "x-api-key", "content-length"}

        for key, value in headers.items():
            if key.lower() not in skip_headers:
                new_headers[key] = value

        # Add provider authentication
        if provider.type == ProviderType.ANTHROPIC:
            new_headers["x-api-key"] = provider.api_key
            new_headers["anthropic-version"] = "2024-01-01"
        elif provider.type == ProviderType.GEMINI:
            # Gemini uses URL parameter for API key
            if "?" in target_url:
                target_url += f"&key={provider.api_key}"
            else:
                target_url += f"?key={provider.api_key}"
        else:
            # Default to Bearer token
            new_headers["Authorization"] = f"Bearer {provider.api_key}"

        # Check if streaming
        is_stream = False
        if body:
            try:
                body_json = json.loads(body)
                is_stream = body_json.get("stream", False)
            except json.JSONDecodeError:
                pass

        if is_stream:
            return await self._stream_request(
                method=method,
                url=target_url,
                headers=new_headers,
                body=body,
            )
        else:
            return await self._regular_request(
                method=method,
                url=target_url,
                headers=new_headers,
                body=body,
            )

    async def _regular_request(
        self,
        method: str,
        url: str,
        headers: Dict,
        body: bytes,
    ) -> StreamingResponse:
        """Handle non-streaming request"""
        response = await self.client.request(
            method=method,
            url=url,
            headers=headers,
            content=body,
        )

        # Filter response headers
        response_headers = {}
        skip_response_headers = {"transfer-encoding", "content-encoding"}

        for key, value in response.headers.items():
            if key.lower() not in skip_response_headers:
                response_headers[key] = value

        return StreamingResponse(
            content=iter([response.content]),
            status_code=response.status_code,
            headers=response_headers,
            media_type=response.headers.get("content-type"),
        )

    async def _stream_request(
        self,
        method: str,
        url: str,
        headers: Dict,
        body: bytes,
    ) -> StreamingResponse:
        """Handle streaming request"""

        async def stream_generator():
            async with self.client.stream(
                method=method,
                url=url,
                headers=headers,
                content=body,
            ) as response:
                async for chunk in response.aiter_bytes():
                    yield chunk

        return StreamingResponse(
            stream_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        )

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
        ]
        return any(ind in error_str for ind in permanent_indicators)

    async def close(self):
        """Close the HTTP client"""
        await self.client.aclose()
