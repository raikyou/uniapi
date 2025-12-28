from __future__ import annotations

import argparse
import logging
from pathlib import Path

import uvicorn

from .app import create_app

logging.basicConfig(level=logging.INFO)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Unified API gateway for LLM providers")
    parser.add_argument("--config", type=Path, default=Path("config.yaml"), help="Path to config file")
    parser.add_argument("--host", default="0.0.0.0", help="Bind host")
    parser.add_argument("--port", type=int, default=8000, help="Bind port")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload (development only)")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    app = create_app(args.config)
    uvicorn.run(app, host=args.host, port=args.port, reload=args.reload)


if __name__ == "__main__":
    main()
