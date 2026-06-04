"""Maps agent name → async runner that drives a LangGraph workflow.

The dep_scan graph is synchronous and runs in `asyncio.to_thread`. The thread
gets a sync `log_fn` that bridges back to the event loop via
`asyncio.run_coroutine_threadsafe`, so every log line published by a node
shows up as a JobEvent on the WebSocket stream.

Repo resolution order (most → least specific):
  1. Explicit `repo_path` in the run request (used by power users / CLI)
  2. <project.root_dir>/workspaces/<project.repo_name>  (the normal UI path)
  3. fail fast with a descriptive error

Pause/Resume: When wait_for_decision_node calls interrupt(), LangGraph
checkpoints the graph and invoke() returns early.  _run_dep_scan detects the
interrupt via get_state(), emits a "pause" WebSocket event, and awaits an
asyncio.Event.  The frontend POSTs to /jobs/{id}/decision →
PauseManager.resolve() fires the on_resume callback which sets the
asyncio.Event.  _run_dep_scan then resumes the graph with
Command(resume=<decision>).
"""
from __future__ import annotations

import asyncio
import os
import threading
from pathlib import Path
from typing import Awaitable, Callable

from opensecai.runtime.notification_contracts import get as get_contract
from opensecai.runtime.pause_manager import get_pause_manager
from opensecai.storage.projects import get_project_store

EmitFn = Callable[[str, str], Awaitable[None]]


def _resolve_project(project_name: str, override: str | None) -> tuple[str, str]:
    """Return (root_dir, repo_path) for the named project."""
    record = get_project_store().get(project_name)
    if record is None:
        raise RuntimeError(f"Project '{project_name}' is not registered.")

    if override:
        return record.root_dir, override

    if not record.repo_name:
        raise RuntimeError(
            f"Project '{project_name}' has no repo_name set. "
            "Configure the repository folder under workspaces/ before running an agent."
        )
    return record.root_dir, str(Path(record.root_dir) / "workspaces" / record.repo_name)


async def _run_dep_scan(job_id: str, project: str, repo_path: str | None, emit: EmitFn) -> None:
    """Invoke the dep_scan LangGraph workflow in a worker thread.

    Supports a single LangGraph interrupt (human-in-the-loop decision).  If the
    graph pauses, this coroutine awaits an asyncio.Event that is set when the
    frontend POSTs the user's decision, then resumes the graph.
    """
    import datetime as _dt
    import json as _json
    import traceback as _tb

    import opensecai.agents.dep_scan.contracts  # noqa: F401 — side-effect registration
    from opensecai.agents.dep_scan.runner import (
        build_workflow, cleanup_run, make_initial_state, set_runtime, clear_runtime,
    )
    from opensecai.core.paths import agent_run_dir
    from langgraph.checkpoint.memory import MemorySaver
    from langgraph.types import Command

    # ── Phase 1: pre-workflow setup ──────────────────────────────────────────
    try:
        root_dir, resolved_repo = _resolve_project(project, repo_path)
        if not os.path.exists(os.path.join(resolved_repo, "go.mod")):
            raise RuntimeError(f"No go.mod found in {resolved_repo}")

        await emit("log", f"▶️  dep_scan starting (project={project}, cwd={resolved_repo})")

        initial_state = make_initial_state(
            project=project,
            root_dir=root_dir,
            repo_path=resolved_repo,
            job_id=job_id,
        )
        run_id: str = initial_state["run_id"]
        events_path = agent_run_dir(root_dir, project, "dep_scan", run_id) / "events.jsonl"
    except Exception as e:  # noqa: BLE001
        await emit("log", f"❌ dep_scan setup failed: {type(e).__name__}: {e}")
        await emit("log", _tb.format_exc())
        raise

    def _write_event(kind: str, payload: str) -> None:
        ts = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        with open(events_path, "a") as fh:
            fh.write(_json.dumps({"kind": kind, "payload": payload, "timestamp": ts}) + "\n")

    loop = asyncio.get_running_loop()

    def log_fn(msg: str) -> None:
        _write_event("log", msg)
        asyncio.run_coroutine_threadsafe(emit("log", msg), loop)

    checkpointer = MemorySaver()
    config = {"configurable": {"thread_id": job_id}}
    cancel_event = threading.Event()
    pause_mgr = get_pause_manager()
    workflow = build_workflow(checkpointer=checkpointer)

    # ── Phase 2: first invoke (runs until END or interrupt) ──────────────────
    # Register non-serializable runtime objects in the sideband so they stay
    # out of AgentState (MemorySaver uses msgpack; functions/Events can't be
    # serialized).
    set_runtime(run_id, log_fn, cancel_event)

    def _invoke_first() -> None:
        try:
            workflow.invoke(initial_state, config=config)
        except Exception as e:  # noqa: BLE001
            log_fn(f"❌ dep_scan node failed: {type(e).__name__}: {e}")
            log_fn(_tb.format_exc())
            raise

    try:
        await asyncio.to_thread(_invoke_first)
    except asyncio.CancelledError:
        cancel_event.set()
        clear_runtime(run_id)
        await asyncio.to_thread(cleanup_run, initial_state)
        raise
    except Exception:
        clear_runtime(run_id)
        await asyncio.to_thread(cleanup_run, initial_state)
        raise

    # ── Phase 3: handle interrupt (if any) ──────────────────────────────────
    graph_state = workflow.get_state(config)
    all_interrupts = [intr for task in graph_state.tasks for intr in task.interrupts]

    if all_interrupts:
        # The interrupt payload is {"contract": "<name>", "context": {...}}.
        # "contract" is the registry key; "context" carries dynamic per-run
        # data (e.g. build_logs) that gets merged into the WS event so the
        # frontend can render it alongside the static options from contracts.py.
        raw = all_interrupts[0].value
        if isinstance(raw, dict):
            contract_name: str = raw["contract"]
            context: dict = raw.get("context", {})
        else:
            contract_name = str(raw)
            context = {}

        contract = get_contract(contract_name)

        resume_event = asyncio.Event()
        resume_decision: list[str] = [contract.option_values()[0]]  # default: first option

        def on_resume(decision: str) -> None:
            resume_decision[0] = decision
            loop.call_soon_threadsafe(resume_event.set)

        pause_mgr.register_pause(job_id, contract.prompt, contract.option_values(), on_resume)
        # run_id lets the frontend match this notification to the FS run entry
        # when the user navigates from AgentRunHistoryPage (which uses the FS run_id).
        ws_payload = {**contract.to_ws_payload(), **context, "run_id": run_id}
        await emit("pause", _json.dumps(ws_payload))

        try:
            await resume_event.wait()
        except asyncio.CancelledError:
            cancel_event.set()
            pause_mgr.unregister(job_id)
            await asyncio.to_thread(cleanup_run, initial_state)
            raise

        decision = resume_decision[0]
        pause_mgr.unregister(job_id)

        # ── Phase 4: resume graph with the user's decision ───────────────────
        def _invoke_resume() -> None:
            try:
                workflow.invoke(Command(resume=decision), config=config)
            except Exception as e:  # noqa: BLE001
                log_fn(f"❌ dep_scan node failed on resume: {type(e).__name__}: {e}")
                log_fn(_tb.format_exc())
                raise

        try:
            await asyncio.to_thread(_invoke_resume)
        except asyncio.CancelledError:
            cancel_event.set()
            clear_runtime(run_id)
            await asyncio.to_thread(cleanup_run, initial_state)
            raise
        except Exception:
            clear_runtime(run_id)
            await asyncio.to_thread(cleanup_run, initial_state)
            raise

    clear_runtime(run_id)
    _write_event("done", "ok")
    await emit("log", "✅ dep_scan completed")


AGENT_RUNNERS: dict[str, Callable[..., Awaitable[None]]] = {
    "dep_scan": _run_dep_scan,
}


def list_agents() -> list[str]:
    return sorted(AGENT_RUNNERS.keys())


def get_runner(name: str) -> Callable[..., Awaitable[None]] | None:
    return AGENT_RUNNERS.get(name)
