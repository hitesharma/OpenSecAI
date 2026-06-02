"""App-level settings — GET to read, PATCH to update."""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from opensecai.storage.settings import get_settings_store

router = APIRouter(prefix="/settings", tags=["settings"])

DATA_ROOT_KEY = "data_root"


class SettingsResponse(BaseModel):
    data_root: str | None


class PatchSettingsRequest(BaseModel):
    data_root: str


@router.get("", response_model=SettingsResponse)
def get_settings() -> SettingsResponse:
    value = get_settings_store().get(DATA_ROOT_KEY)
    return SettingsResponse(data_root=value)


@router.patch("", response_model=SettingsResponse)
def patch_settings(req: PatchSettingsRequest) -> SettingsResponse:
    from pathlib import Path
    resolved = str(Path(req.data_root).expanduser().resolve())
    get_settings_store().set(DATA_ROOT_KEY, resolved)
    return SettingsResponse(data_root=resolved)
