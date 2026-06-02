"""WebSocket route for streaming job events to the frontend.

On connect, the EventBus replays any buffered events (so late subscribers
catch up on what already happened) before the loop drains live events.
The connection closes once a terminal event has been sent.
"""
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from opensecai.runtime.event_bus import get_event_bus
from opensecai.runtime.job_runner import get_job_manager

logger = logging.getLogger(__name__)

router = APIRouter(tags=["ws"])

TERMINAL_KINDS = {"done", "error"}


@router.websocket("/ws/jobs/{job_id}/stream")
async def stream_job(ws: WebSocket, job_id: str) -> None:
    """Owns the WebSocket lifetime for a single job stream.

    Sequence:
      1. Accept the upgrade handshake.
      2. Look up the job; if missing, emit one error frame and close.
      3. Send an initial `status` snapshot so the UI can render immediately
         even before any live events arrive.
      4. Subscribe to the EventBus, which also REPLAYS any events buffered
         before the WS attached (covers the HTTP-202 → fast-failure race).
      5. Loop: race the event queue against a disconnect signal. Forward
         each event to the client and break on a terminal kind.
      6. Cancel the watcher, close the socket — always, even on exception.

    The handler is the only writer on this socket. The disconnect watcher
    is the only reader. Splitting those duties is what prevents the
    receive/send race that used to drop events under dep_scan's log burst.
    """
    client = f"{ws.client.host}:{ws.client.port}" if ws.client else "unknown"
    logger.info("ws.connect job_id=%s client=%s", job_id, client)
    await ws.accept()
    logger.debug("ws.accepted job_id=%s", job_id)

    manager = get_job_manager()
    job = manager.get(job_id)
    if job is None:
        logger.warning("ws.job_not_found job_id=%s", job_id)
        await ws.send_json({"kind": "error", "payload": "job not found"})
        await ws.close()
        return

    logger.debug("ws.send_initial_status job_id=%s status=%s", job_id, job.status)
    await ws.send_json({
        "kind": "status",
        "payload": job.status,
        "job_id": job.id,
        "timestamp": job.started_at,
    })

    bus = get_event_bus()

    # One long-lived watcher detects client disconnect; we never expect
    # text from the client, so re-creating receive_text() per-event (the
    # previous design) caused event-loss races and ASGI receive churn
    # under high log throughput.
    disconnected = asyncio.Event()

    async def _watch_disconnect() -> None:
        """Background task that detects client disconnect exactly once.

        We never expect the frontend to send messages on this socket, so
        the only purpose of `ws.receive()` is to surface the ASGI
        `websocket.disconnect` frame as a `WebSocketDisconnect` exception.
        When that fires (or any unexpected error), set the `disconnected`
        event so the main loop can exit cleanly between iterations.

        Keeping this in a single long-lived task — instead of recreating
        a receive task per iteration — avoids the cancel/recreate churn
        that previously corrupted Starlette's ASGI receive state during
        high-volume log streams.
        """
        try:
            while True:
                await ws.receive()
        except WebSocketDisconnect as e:
            logger.info("ws.client_disconnect job_id=%s code=%s", job_id, getattr(e, "code", "?"))
        except Exception as e:  # noqa: BLE001
            logger.warning("ws.watcher_error job_id=%s err=%r", job_id, e)
        finally:
            disconnected.set()

    watcher = asyncio.create_task(_watch_disconnect(), name=f"ws-watch-{job_id}")
    logger.debug("ws.watcher_started job_id=%s", job_id)

    sent_count = 0
    terminal_kind: str | None = None
    async with bus.subscribe(job_id) as queue:
        logger.debug("ws.subscribed job_id=%s buffered=%d", job_id, queue.qsize())
        try:
            while not disconnected.is_set():
                get_task = asyncio.create_task(queue.get())
                dc_task = asyncio.create_task(disconnected.wait())
                done, pending = await asyncio.wait(
                    {get_task, dc_task},
                    return_when=asyncio.FIRST_COMPLETED,
                )
                for t in pending:
                    t.cancel()

                if get_task not in done:
                    logger.info("ws.exit_disconnected job_id=%s sent=%d", job_id, sent_count)
                    break

                event = get_task.result()
                try:
                    await ws.send_json(event.model_dump())
                    sent_count += 1
                except (WebSocketDisconnect, RuntimeError) as e:
                    logger.info(
                        "ws.send_failed job_id=%s sent=%d err=%r",
                        job_id, sent_count, e,
                    )
                    break
                if event.kind in TERMINAL_KINDS:
                    terminal_kind = event.kind
                    logger.info(
                        "ws.terminal job_id=%s kind=%s sent=%d",
                        job_id, event.kind, sent_count,
                    )
                    break
        except WebSocketDisconnect:
            logger.info("ws.disconnect_during_loop job_id=%s sent=%d", job_id, sent_count)
            return
        finally:
            logger.debug(
                "ws.cleanup job_id=%s sent=%d terminal=%s",
                job_id, sent_count, terminal_kind,
            )
            watcher.cancel()
            try:
                await watcher
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
            try:
                await ws.close()
            except Exception as e:  # noqa: BLE001
                logger.debug("ws.close_error job_id=%s err=%r", job_id, e)
            logger.info("ws.closed job_id=%s sent=%d", job_id, sent_count)
