"""Filesystem path resolution for OpenSecAI.

There are two distinct "roots" in the system:

  • data_root()  — the global app-data dir holding opensecai.db, settings,
    and (legacy) workspaces/reports. Resolves to:
        ENV=dev   → <repo-root>/
        ENV=prod  → platform app-data dir for hitesharma.opensecai
    This is the *only* path derived from ENV / OPENSECAI_DATA_DIR.

  • <project.root_dir> — each Project record carries its own user-chosen
    root. Reports, workspaces, and per-agent run dirs for that project live
    underneath it. The functions below take root_dir explicitly so callers
    are forced to think about which project they're acting on.

Resolved layout per project:
    <root_dir>/
      ├── workspaces/<project>/         ← cloned source repos
      └── reports/<project>/<agent>/<run_id>/
                              └── index.json
"""
from __future__ import annotations

import os
import sys
from functools import lru_cache
from pathlib import Path

APP_IDENTIFIER = "hitesharma.opensecai"


def _platform_app_data_dir() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / APP_IDENTIFIER
    if sys.platform == "win32":
        base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
        return Path(base) / APP_IDENTIFIER
    # linux + other unix
    xdg = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(xdg) / APP_IDENTIFIER


@lru_cache(maxsize=1)
def data_root() -> Path:
    """Global app-data root — holds opensecai.db and shared settings."""
    override = os.environ.get("OPENSECAI_DATA_DIR")
    if override:
        return Path(override)

    env = os.environ.get("ENV", "prod").lower()
    if env == "dev":
        return Path(__file__).resolve().parents[2]

    return _platform_app_data_dir()


# ── Per-project paths ────────────────────────────────────────────────────────
# All of these take root_dir explicitly — the value comes from the Project
# record in the DB. Sibling to <root_dir>/workspaces/<project>/.

def project_reports_dir(root_dir: str | Path, project: str) -> Path:
    p = Path(root_dir) / "reports" / project
    p.mkdir(parents=True, exist_ok=True)
    return p


def agent_run_dir(root_dir: str | Path, project: str, agent: str, run_id: str) -> Path:
    """<root_dir>/reports/<project>/<agent>/<run_id>/ — one dir per run."""
    p = project_reports_dir(root_dir, project) / agent / run_id
    p.mkdir(parents=True, exist_ok=True)
    return p


def project_workspace_dir(root_dir: str | Path, project: str) -> Path:
    p = Path(root_dir) / "workspaces" / project
    p.mkdir(parents=True, exist_ok=True)
    return p


# ── Deprecated: legacy global paths (kept only for back-compat) ──────────────
# These resolved against data_root() instead of a per-project root_dir.

def reports_root() -> Path:
    root = data_root() / "reports"
    root.mkdir(parents=True, exist_ok=True)
    return root


def workspaces_root() -> Path:
    root = data_root() / "workspaces"
    root.mkdir(parents=True, exist_ok=True)
    return root
