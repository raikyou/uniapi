import time
from typing import Optional

import litellm
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas import ModelBenchmarkResult, ModelResponse, ModelStatusUpdate, ModelUpdate
from app.services.model_service import ModelService
from app.services.provider_service import ProviderService

router = APIRouter()


@router.put("/{model_id}", response_model=ModelResponse)
async def update_model(
    model_id: int,
    data: ModelUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a model"""
    service = ModelService(db)
    model = await service.update(model_id, data)

    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    return ModelResponse.model_validate(model)


@router.delete("/{model_id}")
async def delete_model(model_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a model"""
    service = ModelService(db)
    success = await service.delete(model_id)

    if not success:
        raise HTTPException(status_code=404, detail="Model not found")

    return {"message": "Model deleted successfully"}


@router.patch("/{model_id}/status", response_model=ModelResponse)
async def update_model_status(
    model_id: int,
    data: ModelStatusUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Enable/disable a model"""
    service = ModelService(db)
    model = await service.update_status(model_id, data.is_enabled)

    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    return ModelResponse.model_validate(model)


@router.post("/{model_id}/benchmark", response_model=ModelBenchmarkResult)
async def benchmark_model(model_id: int, db: AsyncSession = Depends(get_db)):
    """Run benchmark test for a model (TPS and first token latency)"""
    model_service = ModelService(db)
    provider_service = ProviderService(db)

    model = await model_service.get_by_id(model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    provider = await provider_service.get_by_id(model.provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")

    # Build LiteLLM model identifier
    from app.core.gateway import GatewayService

    gateway = GatewayService(db)
    litellm_model = gateway._build_litellm_model(provider, model.model_id)

    # Test message
    test_messages = [
        {"role": "user", "content": "Write a short story about a cat in exactly 100 words."}
    ]

    try:
        start_time = time.time()
        first_token_time = None
        output_tokens = 0

        # Make streaming request to measure first token latency
        response = await litellm.acompletion(
            model=litellm_model,
            messages=test_messages,
            api_key=provider.api_key,
            api_base=provider.base_url,
            stream=True,
            max_tokens=150,
        )

        async for chunk in response:
            if first_token_time is None:
                first_token_time = time.time()

            if chunk.choices and chunk.choices[0].delta.content:
                output_tokens += 1  # Approximate token count

        end_time = time.time()

        total_latency_ms = (end_time - start_time) * 1000
        first_token_latency_ms = (
            (first_token_time - start_time) * 1000 if first_token_time else total_latency_ms
        )

        # Calculate TPS (tokens per second)
        generation_time = end_time - (first_token_time or start_time)
        tps = output_tokens / generation_time if generation_time > 0 else 0

        # Update model with benchmark results
        await model_service.update_benchmark(model_id, tps, first_token_latency_ms)

        return ModelBenchmarkResult(
            model_id=model_id,
            tps=round(tps, 2),
            first_token_latency_ms=round(first_token_latency_ms, 2),
            total_latency_ms=round(total_latency_ms, 2),
            output_tokens=output_tokens,
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Benchmark failed: {str(e)}",
        )
