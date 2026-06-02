"""SQLite-backed project store.

Shares the same opensecai.db as the job store. Each project record holds:
  - name      : the project identifier
  - root_dir  : base path for that project's data (reports/, workspaces/)
  - repo_name : folder name under <root_dir>/workspaces/ where the actual
                source repo lives. Optional — set lazily by the UI on first
                agent run. Resolved repo path = <root_dir>/workspaces/<repo_name>.
"""
from __future__ import annotations

import sqlite3
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from opensecai.core.paths import data_root

_SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
    name      TEXT PRIMARY KEY,
    root_dir  TEXT NOT NULL,
    repo_name TEXT
);
"""


@dataclass
class ProjectRecord:
    name: str
    root_dir: str
    repo_name: Optional[str] = None


class ProjectStore:
    def __init__(self, db_path: Optional[Path] = None) -> None:
        self._path = db_path or (data_root() / "opensecai.db")
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self._path, check_same_thread=False, isolation_level=None)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.executescript(_SCHEMA)
        self._migrate()
        self._lock = threading.Lock()

    def _migrate(self) -> None:
        """Add columns to existing tables created before repo_name landed."""
        self._conn.row_factory = sqlite3.Row
        cols = {r["name"] for r in self._conn.execute("PRAGMA table_info(projects)").fetchall()}
        if "repo_name" not in cols:
            self._conn.execute("ALTER TABLE projects ADD COLUMN repo_name TEXT")

    def _row_to_record(self, row: sqlite3.Row) -> ProjectRecord:
        return ProjectRecord(
            name=row["name"],
            root_dir=row["root_dir"],
            repo_name=row["repo_name"],
        )

    def upsert(self, name: str, root_dir: str, repo_name: str | None = None) -> ProjectRecord:
        with self._lock:
            # Preserve existing repo_name if the caller didn't pass one.
            if repo_name is None:
                existing = self._conn.execute(
                    "SELECT repo_name FROM projects WHERE name=?", (name,)
                ).fetchone()
                if existing is not None:
                    repo_name = existing[0]
            self._conn.execute(
                "INSERT OR REPLACE INTO projects (name, root_dir, repo_name) VALUES (?, ?, ?)",
                (name, root_dir, repo_name),
            )
        return ProjectRecord(name=name, root_dir=root_dir, repo_name=repo_name)

    def set_repo_name(self, name: str, repo_name: str) -> ProjectRecord | None:
        with self._lock:
            self._conn.execute(
                "UPDATE projects SET repo_name=? WHERE name=?", (repo_name, name)
            )
        return self.get(name)

    def get(self, name: str) -> ProjectRecord | None:
        self._conn.row_factory = sqlite3.Row
        cur = self._conn.execute("SELECT * FROM projects WHERE name=?", (name,))
        row = cur.fetchone()
        return self._row_to_record(row) if row else None

    def list_all(self) -> list[ProjectRecord]:
        self._conn.row_factory = sqlite3.Row
        cur = self._conn.execute("SELECT * FROM projects ORDER BY name")
        return [self._row_to_record(r) for r in cur.fetchall()]

    def delete(self, name: str) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM projects WHERE name=?", (name,))


_store: ProjectStore | None = None


def get_project_store() -> ProjectStore:
    global _store
    if _store is None:
        _store = ProjectStore()
    return _store
