from __future__ import annotations

import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import init_db
from .routes.admin import router as admin_router
from .routes.gateway import router as gateway_router
from .services import log_service


def create_app() -> FastAPI:
    init_db()
    app = FastAPI(title="UniAPI Gateway")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["*"],
    )
    app.include_router(admin_router)
    app.include_router(gateway_router)

    async def log_cleanup_loop() -> None:
        while True:
            log_service.purge_old_logs()
            await asyncio.sleep(3600)

    @app.on_event("startup")
    async def start_log_cleanup() -> None:
        app.state.log_cleanup_task = asyncio.create_task(log_cleanup_loop())

    @app.on_event("shutdown")
    async def stop_log_cleanup() -> None:
        task = getattr(app.state, "log_cleanup_task", None)
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    return app


app = create_app()
