"""FastAPI factory — single process, all agents share this app."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from opensecai.api.routes import agents, jobs, projects, settings
from opensecai.api.ws import router as ws_router
from opensecai.core.paths import data_root


def create_app() -> FastAPI:
    app = FastAPI(title="OpenSecAI Sidecar", version="0.1.0")

    # Tauri dev server runs on http://localhost:1420 — allow it plus
    # the tauri://localhost scheme used by the production webview.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:1420",
            "tauri://localhost",
            "http://tauri.localhost",
        ],
        allow_methods=["*"],
        allow_headers=["*"],
        allow_credentials=False,
    )

    app.include_router(settings.router)
    app.include_router(projects.router)
    app.include_router(agents.router)
    app.include_router(jobs.router)
    app.include_router(ws_router)

    @app.get("/health", tags=["meta"])
    def health() -> dict:
        return {"status": "ok", "data_root": str(data_root())}

    return app


# Module-level instance for `uvicorn opensecai.api.app:app`.
app = create_app()
