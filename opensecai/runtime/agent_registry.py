"""Maps agent name → async runner that drives a LangGraph workflow.

The dep_scan graph is synchronous and runs in `asyncio.to_thread`. The thread
gets a sync `log_fn` that bridges back to the event loop via
`asyncio.run_coroutine_threadsafe`, so every log line published by a node
shows up as a JobEvent on the WebSocket stream.

Repo resolution order (most → least specific):
  1. Explicit `repo_path` in the run request (used by power users / CLI)
  2. <project.root_dir>/workspaces/<project.repo_name>  (the normal UI path)
  3. fail fast with a descriptive error
"""
from __future__ import annotations

import asyncio
import os
from pathlib import Path
from typing import Awaitable, Callable

from opensecai.storage.projects import get_project_store

EmitFn = Callable[[str, str], Awaitable[None]]


def _resolve_project(project_name: str, override: str | None) -> tuple[str, str]:
    """Return (root_dir, repo_path) for the named project.

    repo_path is `override` if given, otherwise <root_dir>/workspaces/<repo_name>.
    """
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

    The body is wrapped in try/except blocks at two boundaries so failures
    surface as readable log lines in the live viewer (and in events.jsonl)
    *before* the JobManager supervisor catches the exception and emits a
    single opaque "error" event that terminates the WS.
    """
    import datetime as _dt
    import json as _json
    import traceback as _tb

    # Lazy import — keeps heavy LLM deps out of the process until a run starts.
    from opensecai.agents.dep_scan.runner import build_workflow, make_initial_state
    from opensecai.core.paths import agent_run_dir

    # ── Phase 1: pre-workflow setup (project resolve, paths, log sink) ──
    try:
        root_dir, resolved_repo = _resolve_project(project, repo_path)
        if not os.path.exists(os.path.join(resolved_repo, "go.mod")):
            raise RuntimeError(f"No go.mod found in {resolved_repo}")

        await emit("log", f"▶️  dep_scan starting (project={project}, cwd={resolved_repo})")

        initial_state = make_initial_state(
            project=project,
            root_dir=root_dir,
            repo_path=resolved_repo,
        )
        run_id: str = initial_state["run_id"]
        events_path = agent_run_dir(root_dir, project, "dep_scan", run_id) / "events.jsonl"
    except Exception as e:  # noqa: BLE001
        await emit("log", f"❌ dep_scan setup failed: {type(e).__name__}: {e}")
        await emit("log", _tb.format_exc())
        raise

    # Logging sink: write to file (replayable) AND emit to live WS.
    def _write_event(kind: str, payload: str) -> None:
        ts = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        with open(events_path, "a") as fh:
            fh.write(_json.dumps({"kind": kind, "payload": payload, "timestamp": ts}) + "\n")

    loop = asyncio.get_running_loop()

    def log_fn(msg: str) -> None:
        _write_event("log", msg)
        asyncio.run_coroutine_threadsafe(emit("log", msg), loop)

    # ── Phase 2: workflow execution (LangGraph nodes) ──
    def _invoke() -> None:
        initial_state["log_fn"] = log_fn
        try:
            workflow = build_workflow()
            workflow.invoke(initial_state)
        except Exception as e:  # noqa: BLE001
            # Surface the failure as a log line so the user sees *where* it
            # broke (which node, which subprocess, which traceback) instead
            # of just "connection closed" after a generic error event.
            log_fn(f"❌ dep_scan node failed: {type(e).__name__}: {e}")
            log_fn(_tb.format_exc())
            raise

    await asyncio.to_thread(_invoke)
    _write_event("done", "ok")
    await emit("log", "✅ dep_scan completed")


AGENT_RUNNERS: dict[str, Callable[..., Awaitable[None]]] = {
    "dep_scan": _run_dep_scan,
}


def list_agents() -> list[str]:
    return sorted(AGENT_RUNNERS.keys())


def get_runner(name: str) -> Callable[..., Awaitable[None]] | None:
    return AGENT_RUNNERS.get(name)
