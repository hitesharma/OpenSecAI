"""Project CRUD — replaces the Rust filesystem commands."""
from __future__ import annotations

from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from opensecai.api.routes.settings import DATA_ROOT_KEY
from opensecai.storage.projects import get_project_store
from opensecai.storage.settings import get_settings_store

router = APIRouter(prefix="/projects", tags=["projects"])


class ProjectSummary(BaseModel):
    name: str
    root_dir: str
    repo_name: Optional[str] = None


class ProjectList(BaseModel):
    projects: list[ProjectSummary]


class CreateProjectRequest(BaseModel):
    name: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_.\-]+$")
    root_dir: Optional[str] = None
    repo_name: Optional[str] = Field(default=None, max_length=128, pattern=r"^[A-Za-z0-9_.\-/]+$|^$")


class UpdateProjectRequest(BaseModel):
    repo_name: Optional[str] = Field(default=None, max_length=128, pattern=r"^[A-Za-z0-9_.\-/]+$")


def _resolve_root_dir(provided: str | None) -> Path:
    """Return root_dir from request or fall back to stored global setting."""
    raw = provided or get_settings_store().get(DATA_ROOT_KEY)
    if not raw:
        raise HTTPException(
            status_code=422,
            detail="root_dir is required — no global data root is configured yet.",
        )
    return Path(raw).expanduser().resolve()


@router.get("", response_model=ProjectList)
def list_projects() -> ProjectList:
    records = get_project_store().list_all()
    return ProjectList(projects=[
        ProjectSummary(name=r.name, root_dir=r.root_dir, repo_name=r.repo_name)
        for r in records
    ])


@router.post("", response_model=ProjectSummary, status_code=201)
def create_project(req: CreateProjectRequest) -> ProjectSummary:
    try:
        root = _resolve_root_dir(req.root_dir)
        (root / "reports" / req.name).mkdir(parents=True, exist_ok=True)
        (root / "workspaces" / req.name).mkdir(parents=True, exist_ok=True)
        store = get_settings_store()
        if not store.get(DATA_ROOT_KEY):
            store.set(DATA_ROOT_KEY, str(root))
    except HTTPException:
        raise
    except OSError as e:
        raise HTTPException(status_code=500, detail=str(e))
    record = get_project_store().upsert(req.name, str(root), req.repo_name or None)
    return ProjectSummary(name=record.name, root_dir=record.root_dir, repo_name=record.repo_name)


@router.patch("/{name}", response_model=ProjectSummary)
def update_project(name: str, req: UpdateProjectRequest) -> ProjectSummary:
    store = get_project_store()
    existing = store.get(name)
    if existing is None:
        raise HTTPException(status_code=404, detail=f"project not found: {name}")
    if req.repo_name is not None:
        store.set_repo_name(name, req.repo_name)
    updated = store.get(name)
    assert updated is not None
    return ProjectSummary(name=updated.name, root_dir=updated.root_dir, repo_name=updated.repo_name)
