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
    dev_mode = os.environ.get("ENV", "prod").lower() == "dev"
    reload_mode = os.environ.get("OPENSECAI_API_RELOAD", "0") == "1"

    if dev_mode and reload_mode:
        uvicorn.run(
            "opensecai.api.app:app",
            host=host,
            port=port,
            log_level=level_name.lower(),
            reload=True,
        )
    else:
        # Import directly to ensure PyInstaller bundles the app module,
        # and uvicorn doesn't fail on dynamic import in the frozen binary.
        from opensecai.api.app import app
        uvicorn.run(
            app,
            host=host,
            port=port,
            log_level=level_name.lower(),
        )


if __name__ == "__main__":
    main()
