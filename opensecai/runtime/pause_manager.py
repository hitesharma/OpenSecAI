"""Pause/resume coordination for agent workflows using LangGraph breakpoints.

Flow:
  1. agent_registry detects a LangGraph interrupt after invoke() returns.
  2. It calls register_pause(job_id, prompt, options, on_resume_fn) and emits
     a "pause" WebSocket event so the frontend knows what to show.
  3. The frontend POSTs to /jobs/{job_id}/decision; the API calls resolve(job_id,
     decision), which fires the on_resume_fn callback.  The callback sets an
     asyncio.Event, unblocking _run_dep_scan which then resumes the graph with
     Command(resume=decision).
  4. On completion or cancellation, unregister(job_id) cleans up.

Design:
- One PauseInfo per job (only one interrupt per job at a time).
- No thread blocking: on_resume_fn is a lightweight sync callback that calls
  loop.call_soon_threadsafe to set an asyncio.Event in the event loop.
- Thread-safe: dict mutations guarded by threading.Lock.
"""
from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Callable


@dataclass
class PauseInfo:
    job_id: str
    prompt: str
    options: list[str]
    _on_resume: Callable[[str], None]

    def resume(self, decision: str) -> None:
        self._on_resume(decision)


class PauseManager:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._paused: dict[str, PauseInfo] = {}

    def register_pause(
        self,
        job_id: str,
        prompt: str,
        options: list[str],
        on_resume: Callable[[str], None],
    ) -> None:
        """Register a paused job and the callback to invoke when it resumes."""
        with self._lock:
            self._paused[job_id] = PauseInfo(
                job_id=job_id, prompt=prompt, options=options, _on_resume=on_resume
            )

    def resolve(self, job_id: str, decision: str) -> bool:
        """Fire the resume callback for a paused job.  Returns False if not found."""
        with self._lock:
            info = self._paused.pop(job_id, None)
        if info is None:
            return False
        info.resume(decision)
        return True

    def get_pending(self, job_id: str) -> PauseInfo | None:
        """Return the current pause info for a job (used by the GET endpoint)."""
        with self._lock:
            return self._paused.get(job_id)

    def is_paused(self, job_id: str) -> bool:
        with self._lock:
            return job_id in self._paused

    def unregister(self, job_id: str) -> None:
        """Remove any pause state for a job without firing the callback."""
        with self._lock:
            self._paused.pop(job_id, None)


_manager: PauseManager | None = None


def get_pause_manager() -> PauseManager:
    global _manager
    if _manager is None:
        _manager = PauseManager()
    return _manager
