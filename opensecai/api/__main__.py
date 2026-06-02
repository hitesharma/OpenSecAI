"""`python -m opensecai.api` / `opensecai-api` entrypoint.

Reads HOST/PORT from env so the Tauri sidecar spawner can pin a port.
Default 127.0.0.1:8765 — localhost-only by design (sidecar should never be
exposed to the network).
"""
from __future__ import annotations

import logging
import os

import uvicorn
from dotenv import load_dotenv

load_dotenv()


def main() -> None:
    host = os.environ.get("OPENSECAI_API_HOST", "127.0.0.1")
    port = int(os.environ.get("OPENSECAI_API_PORT", "8765"))
    level_name = os.environ.get("OPENSECAI_LOG_LEVEL", "info").upper()
    # Ensure our package loggers (opensecai.api.ws, .runtime.*) are emitted
    # alongside uvicorn's request logs. Uvicorn configures its own loggers
    # but does not touch the root logger, so we install a handler here.
    logging.basicConfig(
        level=getattr(logging, level_name, logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s — %(message)s",
        datefmt="%H:%M:%S",
    )
    uvicorn.run(
        "opensecai.api.app:app",
        host=host,
        port=port,
        log_level=level_name.lower(),
        reload=os.environ.get("ENV", "prod").lower() == "dev"
        and os.environ.get("OPENSECAI_API_RELOAD", "0") == "1",
    )


if __name__ == "__main__":
    main()
