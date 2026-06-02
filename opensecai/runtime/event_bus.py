"""In-process pub/sub for streaming job events.

A per-job ring buffer keeps recent events so subscribers that connect AFTER
the publisher has already emitted (common race: HTTP 202 returns, the runner
starts fast and fails before the WebSocket attaches) can still replay them.
"""
from __future__ import annotations

import asyncio
import logging
from collections import deque
from contextlib import asynccontextmanager
from typing import AsyncIterator, Deque

from opensecai.schemas.job import JobEvent

logger = logging.getLogger(__name__)

_REPLAY_BUFFER_MAX = 2000  # events per job — small log lines, generous cap


class EventBus:
    def __init__(self) -> None:
        self._subs: dict[str, list[asyncio.Queue[JobEvent]]] = {}
        self._buffer: dict[str, Deque[JobEvent]] = {}
        self._lock = asyncio.Lock()

    async def publish(self, event: JobEvent) -> None:
        """Append `event` to the per-job replay buffer and fan it out to
        every live subscriber.

        Called from the JobManager's `emit()` (status/done/error) and from
        each agent's `log_fn` (per log line, potentially hundreds/sec for
        dep_scan). Two responsibilities:

          - Persist the event in the ring buffer so a WebSocket that
            attaches later can replay everything it missed.
          - Hand the event to every subscriber queue. `put_nowait` keeps
            this method non-blocking even if a slow consumer is stuck;
            overflow is counted and logged so we notice silent loss.

        The lock guards the subs/buffer maps; fan-out happens after the
        lock is released to avoid blocking other publishers behind a
        single slow queue.
        """
        async with self._lock:
            buf = self._buffer.get(event.job_id)
            if buf is None:
                buf = deque(maxlen=_REPLAY_BUFFER_MAX)
                self._buffer[event.job_id] = buf
            buf.append(event)
            queues = list(self._subs.get(event.job_id, []))
        dropped = 0
        for q in queues:
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                dropped += 1
        logger.debug(
            "bus.publish job_id=%s kind=%s subs=%d dropped=%d buf=%d",
            event.job_id, event.kind, len(queues), dropped, len(buf),
        )
        if dropped:
            logger.warning(
                "bus.queue_full job_id=%s kind=%s dropped=%d",
                event.job_id, event.kind, dropped,
            )

    @asynccontextmanager
    async def subscribe(self, job_id: str) -> AsyncIterator[asyncio.Queue[JobEvent]]:
        """Yield an asyncio queue pre-loaded with the replay buffer.

        The WebSocket handler enters this context for the duration of a
        client connection. On entry:
          - Allocate a bounded queue (replay cap + headroom for live
            events that arrive while the consumer is still draining
            replay).
          - Copy every buffered event into the queue under the lock so
            the subscriber sees a consistent snapshot before any new
            publish can race ahead.
          - Register the queue in `_subs` so future publishes fan out
            to it.

        On exit (handler returns, raises, or is cancelled), the queue
        is unregistered and dropped — no leaks even if many short-lived
        WebSockets attach during one job.
        """
        q: asyncio.Queue[JobEvent] = asyncio.Queue(maxsize=_REPLAY_BUFFER_MAX + 256)
        async with self._lock:
            # Replay anything that was published before this subscriber attached.
            replayed = 0
            for ev in self._buffer.get(job_id, ()):
                q.put_nowait(ev)
                replayed += 1
            self._subs.setdefault(job_id, []).append(q)
            total_subs = len(self._subs[job_id])
        logger.info(
            "bus.subscribe job_id=%s replayed=%d total_subs=%d",
            job_id, replayed, total_subs,
        )
        try:
            yield q
        finally:
            async with self._lock:
                queues = self._subs.get(job_id, [])
                if q in queues:
                    queues.remove(q)
                if not queues and job_id in self._subs:
                    del self._subs[job_id]
                remaining = len(self._subs.get(job_id, []))
            logger.info(
                "bus.unsubscribe job_id=%s remaining_subs=%d",
                job_id, remaining,
            )

    async def drop(self, job_id: str) -> None:
        """Release the replay buffer for a finished job.

        Called once a job has reached a terminal status AND no
        subscribers remain. Without this, the in-memory ring buffers
        for thousands of historical jobs would accumulate over the
        sidecar's lifetime. Safe to call multiple times.
        """
        async with self._lock:
            buf = self._buffer.pop(job_id, None)
        logger.debug(
            "bus.drop job_id=%s buffered=%d",
            job_id, len(buf) if buf else 0,
        )


_bus: EventBus | None = None


def get_event_bus() -> EventBus:
    """Process-wide EventBus accessor (lazy singleton).

    The bus must be shared between the JobManager (publisher side) and
    every WebSocket handler (subscriber side). A module-level singleton
    keeps them on the same instance without threading it through every
    constructor.
    """
    global _bus
    if _bus is None:
        _bus = EventBus()
    return _bus
