"""Job manager — spawns asyncio tasks, persists state to SQLite.

The running asyncio.Task is kept in-process (so we can cancel it); the Job
metadata (status, timestamps, error) is mirrored to a JobStore so history
survives sidecar restarts.
"""
from __future__ import annotations

import asyncio
import datetime
import logging
import uuid
from typing import Awaitable, Callable

from opensecai.runtime.event_bus import EventBus, get_event_bus
from opensecai.schemas.job import Job, JobEvent, JobStatus
from opensecai.storage.jobs import JobStore, get_job_store

logger = logging.getLogger(__name__)

EmitFn = Callable[[str, str], Awaitable[None]]
AgentRunner = Callable[[str, str, str | None, EmitFn], Awaitable[None]]


def _utc_now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class JobManager:
    def __init__(self, bus: EventBus | None = None, store: JobStore | None = None) -> None:
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._bus = bus or get_event_bus()
        self._store = store or get_job_store()

    def get(self, job_id: str) -> Job | None:
        return self._store.get(job_id)

    def list(self, *, project: str | None = None) -> list[Job]:
        return self._store.list(project=project)

    async def start(self, *, agent: str, project: str, repo_path: str | None,
                    runner: AgentRunner) -> Job:
        """Spawn a supervised job and return its metadata immediately.

        Called from POST /agents/{name}/run. Persists the job record to
        SQLite (off-loop, since the SQLite driver is sync), then schedules
        `_supervise` as a background asyncio task. The returned Job is
        sent back in the HTTP response so the frontend can immediately
        open the WebSocket at /ws/jobs/{id}/stream — events published by
        the runner before that WS attaches are caught by the EventBus
        replay buffer.
        """
        job_id = uuid.uuid4().hex[:12]
        job = Job(
            id=job_id,
            agent=agent,
            project=project,
            status="running",
            started_at=_utc_now_iso(),
        )
        # SQLite write is sync; keep it off the event loop.
        await asyncio.to_thread(self._store.insert, job)
        task = asyncio.create_task(
            self._supervise(job, repo_path, runner), name=f"job-{job_id}"
        )
        self._tasks[job_id] = task
        logger.info(
            "job.start id=%s agent=%s project=%s repo=%s",
            job_id, agent, project, repo_path,
        )
        return job

    async def cancel(self, job_id: str) -> bool:
        """Request cooperative cancellation of a running job.

        Cancels the supervisor task, which raises `CancelledError` inside
        the runner. `_supervise` catches that, finalises the job as
        cancelled, and emits a final `status=cancelled` event so any
        attached WebSocket can close cleanly. Returns False if the job
        is already finished or unknown.
        """
        task = self._tasks.get(job_id)
        if not task or task.done():
            logger.info("job.cancel_noop id=%s reason=%s", job_id, "not_running")
            return False
        task.cancel()
        logger.info("job.cancel id=%s", job_id)
        return True

    async def _supervise(self, job: Job, repo_path: str | None, runner: AgentRunner) -> None:
        """Run the agent and translate its outcome into bus events.

        This is the bridge between the agent code (which only knows how
        to invoke a workflow and emit log lines) and the WS layer (which
        only knows how to consume JobEvents). Responsibilities:

          - Emit `status=running` so a subscriber sees movement.
          - Invoke the runner, passing it a closure `emit` so it can
            publish its own log/status events.
          - On normal completion: persist `completed` and emit `done` —
            the WS treats `done` as terminal and closes.
          - On CancelledError: persist `cancelled` and emit a final
            status event, then re-raise so the task is properly torn down.
          - On any other exception: persist `failed`, emit `error` with
            the message, and log the full traceback for diagnosis.
          - Always remove the task from `_tasks` so the registry doesn't
            leak.
        """
        emitted = 0

        async def emit(kind: str, payload: str) -> None:
            """Closure passed to the runner; the only path through which
            an agent's log lines and status updates reach a WebSocket.

            Stamps each event with the current UTC time and the owning
            job_id, then publishes via the EventBus. `nonlocal emitted`
            tracks how many events this supervision cycle has produced
            (useful for the completion log line and for spotting silent
            agents that never emit anything).
            """
            nonlocal emitted
            emitted += 1
            await self._bus.publish(
                JobEvent(  # type: ignore[arg-type]
                    job_id=job.id, kind=kind, payload=payload, timestamp=_utc_now_iso(),
                )
            )

        logger.info("job.supervise.begin id=%s agent=%s", job.id, job.agent)
        await emit("status", "running")
        try:
            await runner(job.id, job.project, repo_path, emit)
            await self._finalise(job.id, "completed", None)
            await emit("done", "ok")
            logger.info("job.supervise.completed id=%s events=%d", job.id, emitted)
        except asyncio.CancelledError:
            await self._finalise(job.id, "cancelled", None)
            await emit("status", "cancelled")
            logger.info("job.supervise.cancelled id=%s events=%d", job.id, emitted)
            raise
        except Exception as e:  # noqa: BLE001
            await self._finalise(job.id, "failed", str(e))
            await emit("error", str(e))
            logger.exception(
                "job.supervise.failed id=%s events=%d err=%r", job.id, emitted, e,
            )
        finally:
            self._tasks.pop(job.id, None)

    async def _finalise(self, job_id: str, status: JobStatus, error: str | None) -> None:
        """Persist the job's terminal state to SQLite (off the event loop).

        Always called before the matching terminal event is published, so
        a client that reconciles via HTTP after the WS closes — see
        `App.tsx ws.onclose` — sees the final status even if it missed the
        last event frame.
        """
        await asyncio.to_thread(
            self._store.update_status, job_id, status, _utc_now_iso(), error,
        )


_manager: JobManager | None = None


def get_job_manager() -> JobManager:
    """Process-wide JobManager accessor (lazy singleton).

    The same manager must be reachable from the agents route (which
    starts jobs), the jobs route (which lists/cancels them), and the WS
    handler (which looks up the job before subscribing). A singleton
    keeps them all on the same instance and the same in-process task
    registry.
    """
    global _manager
    if _manager is None:
        _manager = JobManager()
    return _manager
