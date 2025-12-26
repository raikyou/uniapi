from typing import Any, Dict, List, Optional, Union

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import optional_api_key
from app.core.gateway import GatewayService
from app.db.session import get_db
from app.models import ApiKey, Model
from app.services.model_service import ModelService
from app.services.provider_service import ProviderService

router = APIRouter()


# Request/Response models
class ChatMessage(BaseModel):
    role: str
    content: Union[str, List[Dict[str, Any]]]
    name: Optional[str] = None
    tool_calls: Optional[List[Dict]] = None
    tool_call_id: Optional[str] = None


class ChatCompletionRequest(BaseModel):
    model: str
    messages: List[ChatMessage]
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    n: Optional[int] = 1
    stream: Optional[bool] = False
    stop: Optional[Union[str, List[str]]] = None
    max_tokens: Optional[int] = None
    presence_penalty: Optional[float] = None
    frequency_penalty: Optional[float] = None
    tools: Optional[List[Dict]] = None
    tool_choice: Optional[Union[str, Dict]] = None


class EmbeddingRequest(BaseModel):
    model: str
    input: Union[str, List[str]]
    encoding_format: Optional[str] = "float"


class ImageGenerationRequest(BaseModel):
    model: Optional[str] = "dall-e-3"
    prompt: str
    n: Optional[int] = 1
    size: Optional[str] = "1024x1024"
    quality: Optional[str] = "standard"
    response_format: Optional[str] = "url"


@router.post("/chat/completions")
async def chat_completions(
    request: ChatCompletionRequest,
    db: AsyncSession = Depends(get_db),
    api_key: Optional[ApiKey] = Depends(optional_api_key),
):
    """OpenAI-compatible chat completions endpoint"""
    gateway = GatewayService(db)

    messages = [m.model_dump(exclude_none=True) for m in request.messages]

    response = await gateway.chat_completion(
        model=request.model,
        messages=messages,
        stream=request.stream or False,
        temperature=request.temperature,
        max_tokens=request.max_tokens,
        top_p=request.top_p,
        stop=request.stop,
        tools=request.tools,
        tool_choice=request.tool_choice,
    )

    if request.stream:
        return StreamingResponse(
            response,
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        )

    return response


@router.post("/completions")
async def completions(
    request: ChatCompletionRequest,
    db: AsyncSession = Depends(get_db),
    api_key: Optional[ApiKey] = Depends(optional_api_key),
):
    """OpenAI-compatible completions endpoint (legacy)"""
    # Convert to chat format
    gateway = GatewayService(db)

    messages = [{"role": "user", "content": m.content} for m in request.messages]

    response = await gateway.chat_completion(
        model=request.model,
        messages=messages,
        stream=request.stream or False,
        temperature=request.temperature,
        max_tokens=request.max_tokens,
    )

    if request.stream:
        return StreamingResponse(
            response,
            media_type="text/event-stream",
        )

    return response


@router.post("/embeddings")
async def embeddings(
    request: EmbeddingRequest,
    db: AsyncSession = Depends(get_db),
    api_key: Optional[ApiKey] = Depends(optional_api_key),
):
    """OpenAI-compatible embeddings endpoint"""
    gateway = GatewayService(db)

    response = await gateway.embedding(
        model=request.model,
        input=request.input,
    )

    return response


@router.post("/images/generations")
async def image_generations(
    request: ImageGenerationRequest,
    db: AsyncSession = Depends(get_db),
    api_key: Optional[ApiKey] = Depends(optional_api_key),
):
    """OpenAI-compatible image generation endpoint"""
    # TODO: Implement image generation with LiteLLM
    return {"error": "Image generation not yet implemented"}


@router.get("/models")
async def list_models(
    db: AsyncSession = Depends(get_db),
    api_key: Optional[ApiKey] = Depends(optional_api_key),
):
    """List available models"""
    provider_service = ProviderService(db)
    model_service = ModelService(db)

    providers = await provider_service.get_available_providers()

    models = []
    for provider in providers:
        provider_models = await model_service.get_by_provider(provider.id)
        for model in provider_models:
            if model.is_enabled:
                models.append({
                    "id": model.alias or model.model_id,
                    "object": "model",
                    "created": int(model.created_at.timestamp()),
                    "owned_by": provider.name,
                })

    return {
        "object": "list",
        "data": models,
    }
