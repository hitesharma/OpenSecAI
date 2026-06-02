"""Persistent key-value settings store.

Shares the same opensecai.db as jobs and projects. Currently used to persist
the global data_root chosen by the user on first launch.
"""
from __future__ import annotations

import sqlite3
import threading
from pathlib import Path
from typing import Optional

from opensecai.core.paths import data_root

_SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


class SettingsStore:
    def __init__(self, db_path: Optional[Path] = None) -> None:
        self._path = db_path or (data_root() / "opensecai.db")
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self._path, check_same_thread=False, isolation_level=None)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.executescript(_SCHEMA)
        self._lock = threading.Lock()

    def get(self, key: str) -> str | None:
        self._conn.row_factory = sqlite3.Row
        cur = self._conn.execute("SELECT value FROM settings WHERE key=?", (key,))
        row = cur.fetchone()
        return row["value"] if row else None

    def set(self, key: str, value: str) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                (key, value),
            )


_store: SettingsStore | None = None


def get_settings_store() -> SettingsStore:
    global _store
    if _store is None:
        _store = SettingsStore()
    return _store
