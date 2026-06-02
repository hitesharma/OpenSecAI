"""SQLite-backed job store.

Lives next to reports/ under data_root() (so it follows the same dev/prod
ENV switch as everything else). Stdlib sqlite3 — synchronous calls wrapped
in asyncio.to_thread by JobManager when needed.
"""
from __future__ import annotations

import sqlite3
import threading
from pathlib import Path
from typing import Optional

from opensecai.core.paths import data_root
from opensecai.schemas.job import Job, JobStatus

_SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id           TEXT PRIMARY KEY,
    agent        TEXT NOT NULL,
    project      TEXT NOT NULL,
    status       TEXT NOT NULL,
    started_at   TEXT NOT NULL,
    finished_at  TEXT,
    error        TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_started_at ON jobs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_project    ON jobs(project);
"""


class JobStore:
    def __init__(self, db_path: Optional[Path] = None) -> None:
        self._path = db_path or (data_root() / "opensecai.db")
        self._path.parent.mkdir(parents=True, exist_ok=True)
        # check_same_thread=False because the store is shared across
        # asyncio.to_thread workers. A single lock serialises writes.
        self._conn = sqlite3.connect(self._path, check_same_thread=False, isolation_level=None)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._conn.executescript(_SCHEMA)
        self._lock = threading.Lock()

    def _row_to_job(self, row: sqlite3.Row) -> Job:
        return Job(
            id=row["id"],
            agent=row["agent"],
            project=row["project"],
            status=row["status"],  # type: ignore[arg-type]
            started_at=row["started_at"],
            finished_at=row["finished_at"],
            error=row["error"],
        )

    def insert(self, job: Job) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO jobs (id, agent, project, status, started_at, finished_at, error) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (job.id, job.agent, job.project, job.status, job.started_at,
                 job.finished_at, job.error),
            )

    def update_status(self, job_id: str, status: JobStatus, finished_at: str | None,
                      error: str | None) -> None:
        with self._lock:
            self._conn.execute(
                "UPDATE jobs SET status=?, finished_at=?, error=? WHERE id=?",
                (status, finished_at, error, job_id),
            )

    def get(self, job_id: str) -> Job | None:
        self._conn.row_factory = sqlite3.Row
        cur = self._conn.execute("SELECT * FROM jobs WHERE id=?", (job_id,))
        row = cur.fetchone()
        return self._row_to_job(row) if row else None

    def list(self, *, project: str | None = None, limit: int = 200) -> list[Job]:
        self._conn.row_factory = sqlite3.Row
        if project:
            cur = self._conn.execute(
                "SELECT * FROM jobs WHERE project=? ORDER BY started_at DESC LIMIT ?",
                (project, limit),
            )
        else:
            cur = self._conn.execute(
                "SELECT * FROM jobs ORDER BY started_at DESC LIMIT ?", (limit,)
            )
        return [self._row_to_job(r) for r in cur.fetchall()]


_store: JobStore | None = None


def get_job_store() -> JobStore:
    global _store
    if _store is None:
        _store = JobStore()
    return _store
