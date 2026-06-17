"""dep_scan agent — dependency vulnerability scan + auto-remediation.

Language-agnostic: the active LanguageToolchain (resolved from AgentState.language)
owns all language-specific commands (tidy, upgrade, static-analysis, file-error
regex, and LLM/Claude prompt fragments). To add a new language, implement
LanguageToolchain in opensecai/languages/ and register it in
opensecai/languages/registry.py.

State (project, repo_path, run_id, cwd, language) is threaded through every node
so concurrent runs from the FastAPI sidecar don't collide on module globals.

Runtime-only objects (log_fn, cancel_event) are passed via LangGraph's
context_schema mechanism so they never enter the checkpoint — MemorySaver
uses msgpack serialization, which cannot handle callables or threading.Event.
"""
from __future__ import annotations

import datetime
import json
import os
import re
import subprocess
import sys
from typing import Any, Callable, List, Optional, TypedDict

import shutil

import click
import operator
import polars as pl
from filelock import FileLock
from dotenv import load_dotenv
from langchain.chat_models import init_chat_model
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, StateGraph
from langgraph.runtime import Runtime
from langgraph.types import Command, interrupt

from opensecai.core.paths import agent_run_dir, project_reports_dir, workspaces_root
from opensecai.languages import detect_toolchain, get_toolchain, supported_languages
from opensecai.languages.base import LanguageToolchain

load_dotenv()

# Ensure Homebrew and common binary directories are on PATH
for p in ["/opt/homebrew/bin", "/usr/local/bin", os.path.expanduser("~/.local/bin")]:
    if p not in os.environ.get("PATH", "").split(os.pathsep):
        os.environ["PATH"] = p + os.pathsep + os.environ.get("PATH", "")

AGENT_NAME = "dep_scan"

# Sync log callback type. None → fall back to click.echo (CLI mode).
LogFn = Callable[[str], None]


class RunContext(TypedDict, total=False):
    """Runtime-only context injected per invoke() — never serialized into the checkpoint."""
    log_fn: Optional[LogFn]
    cancel_event: Optional[Any]


class AgentState(TypedDict, total=False):
    # Per-run identity / paths — all plain strings, safe for msgpack checkpointing.
    project: str
    root_dir: str  # project's base dir (holds workspaces/ and reports/)
    repo_path: str
    run_id: str
    run_ts_iso: str
    cwd: str
    # Name of the language toolchain that handles this run (e.g. "go", "nodejs").
    # Resolved at make_initial_state() time via languages.detect_toolchain().
    language: str
    # UUID job_id from the sidecar — plain string so LangGraph can pass it
    # through state safely.
    job_id: str

    # Graph-internal fields
    fixed_vulns: List[dict]
    affected_vulns: List[dict]
    build_logs: str
    test_passed: bool
    iterations: int
    current_error_file: str
    claude_session_id: str
    human_decision: str


# ── Helpers ─────────────────────────────────────────────────────────────────

def _log(runtime: Runtime[[RunContext]], msg: str, err: bool = False) -> None:
    """Emit a log line via the runtime log_fn if set, else click.echo."""
    fn = runtime.context.get("log_fn") if runtime is not None else None
    if fn is not None:
        try:
            fn(msg)
            return
        except Exception:  # noqa: BLE001 — never let logging break a node
            pass
    click.echo(msg, err=err)


def _run_dir(state: AgentState) -> str:
    """<root_dir>/reports/{project}/{agent}/{run_id}/ — created lazily."""
    return str(agent_run_dir(state["root_dir"], state["project"], AGENT_NAME, state["run_id"]))


def _index_dir(state: AgentState) -> str:
    """<root_dir>/reports/{project}/{agent}/ — the per-agent index lives here."""
    d = project_reports_dir(state["root_dir"], state["project"]) / AGENT_NAME
    d.mkdir(parents=True, exist_ok=True)
    return str(d)


def _cwd(state: AgentState) -> str:
    return state.get("cwd") or os.getcwd()


def _toolchain(state: AgentState) -> LanguageToolchain:
    """Resolve the language toolchain for this run from state."""
    return get_toolchain(state["language"])


def _run_tracked(state: AgentState, cmd: list, **kwargs) -> subprocess.CompletedProcess:
    """subprocess.run() that writes the child PID to active_pid while running.

    Rust's delete_agent_run reads this file and SIGKILLs the PID for instant
    termination without waiting for the next node-boundary cancel check.
    """
    capture = kwargs.pop("capture_output", False)
    check = kwargs.pop("check", False)
    if capture:
        kwargs.setdefault("stdout", subprocess.PIPE)
        kwargs.setdefault("stderr", subprocess.PIPE)

    proc = subprocess.Popen(cmd, **kwargs)
    pid_path = os.path.join(_run_dir(state), "active_pid")
    try:
        with open(pid_path, "w") as f:
            f.write(str(proc.pid))
        stdout, stderr = proc.communicate()
    finally:
        try:
            os.remove(pid_path)
        except FileNotFoundError:
            pass

    result = subprocess.CompletedProcess(cmd, proc.returncode, stdout, stderr)
    if check and proc.returncode != 0:
        raise subprocess.CalledProcessError(proc.returncode, cmd, stdout, stderr)
    return result


def _check_cancel(runtime: Runtime[RunContext]) -> None:
    ev = runtime.context.get("cancel_event") if runtime is not None else None
    if ev is not None and ev.is_set():
        raise RuntimeError("Run cancelled by user.")


def _update_index(index_path: str, updater) -> None:
    lock_path = index_path + ".lock"
    with FileLock(lock_path):
        existing: list[dict] = []
        if os.path.exists(index_path):
            with open(index_path) as f:
                existing = json.load(f)
        updater(existing)
        with open(index_path, "w") as f:
            json.dump(existing, f, indent=2)


# ── Node 1: Scan with Trivy ─────────────────────────────────────────────────
def scan_trivy_node(state: AgentState, runtime: Runtime[RunContext]) -> dict:
    _check_cancel(runtime)
    index_path = os.path.join(_index_dir(state), "index.json")
    _update_index(index_path, lambda entries: entries.append({
        "run_id": state["run_id"],
        "timestamp": state.get("run_ts_iso"),
        "status": "running",
        "summary": {},
    }))

    _log(runtime, "🔍 Running Trivy vulnerability scan...")
    try:
        env = os.environ.copy()
        env["DOCKER_CONFIG"] = "/tmp"
        result = _run_tracked(
            state,
            ["trivy", "fs", "--format", "json", "--severity",
             "UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL", "--pkg-types", "library",
             "--skip-dirs", ".venv,__pycache__,node_modules,vendor,pre-upgrade",
             "."],
            capture_output=True, text=True, check=True, env=env, cwd=_cwd(state),
        )
        report_path = os.path.join(_run_dir(state), "start.json")
        with open(report_path, "w") as f:
            f.write(result.stdout)
        _log(runtime, f"💾 Saved scan report to: {report_path}")

        data = json.loads(result.stdout)
        fixed_vulns: list[dict] = []
        affected_vulns: list[dict] = []
        for target in data.get("Results", []):
            for v in target.get("Vulnerabilities", []):
                entry = {
                    "package": v.get("PkgName"),
                    "id": v.get("VulnerabilityID"),
                    "severity": v.get("Severity"),
                    "fixed_version": v.get("FixedVersion"),
                    "installed_version": v.get("InstalledVersion"),
                }
                if v.get("Status") == "fixed":
                    fixed_vulns.append(entry)
                else:
                    affected_vulns.append(entry)

        _log(runtime, f"Found {len(fixed_vulns) + len(affected_vulns)} vulnerability records.")
        return {"fixed_vulns": fixed_vulns, "affected_vulns": affected_vulns, "iterations": 0}
    except Exception as e:  # noqa: BLE001
        _log(runtime, f"❌ Trivy scan failed: {e}", err=True)
        return {"fixed_vulns": [], "affected_vulns": [], "iterations": 0}


# ── Node 2: Update Dependencies ─────────────────────────────────────────────
def update_dependencies_node(state: AgentState, runtime: Runtime[RunContext]) -> dict:
    _check_cancel(runtime)
    fixed_vulns = state.get("fixed_vulns", [])
    affected_vulns = state.get("affected_vulns", [])

    if not fixed_vulns and not affected_vulns:
        _log(runtime, "No vulnerabilities found to update.")
        return {}

    if affected_vulns:
        _log(runtime, f"⚠️  {len(affected_vulns)} affected vulnerabilities have no upstream fix yet — skipping.")

    if not fixed_vulns:
        return {}

    _log(runtime, f"Found fix for {len(fixed_vulns)} vulnerabilities")

    # Deduplicate by package — keep last seen version
    seen: dict[str, str] = {}
    for v in fixed_vulns:
        pkg, version = v.get("package"), v.get("fixed_version")
        if pkg and version:
            seen[pkg] = version

    cwd = _cwd(state)
    tc = _toolchain(state)
    _log(runtime, f"🧹 Tidying ({tc.name}) dependency manifest (pre-upgrade)...")
    tc.tidy(cwd)

    _log(runtime, f"🆙 Upgrading {len(seen)} {tc.name} package(s) to their fixed versions...")
    for pkg, version in seen.items():
        _log(runtime, f"  -> upgrade {pkg}@{version}")

    results = tc.upgrade_packages(cwd, seen)
    for result in results:
        if not result.ok:
            _log(runtime, f"  ⚠️  Failed to upgrade {result.package}@{result.version}: {result.stderr}", err=True)

    return {}


# ── Node 3: Test and Verify Build ───────────────────────────────────────────
def run_tests_node(state: AgentState, runtime: Runtime[RunContext]) -> dict:
    _check_cancel(runtime)
    cwd = _cwd(state)
    tc = _toolchain(state)
    _log(runtime, f"🛠️ Performing static analysis of codebase ({tc.name})...")
    build_res = tc.static_analysis(_run_tracked, state, cwd)

    if build_res.returncode != 0:
        # Some tools (e.g. tsc/ruff) write to stdout; others (e.g. go vet) use stderr.
        error_output = build_res.stderr or build_res.stdout or ""
        _log(runtime, "❌ Breaking changes detected.")
        _log(runtime, error_output)
        return {"test_passed": False, "build_logs": error_output}

    _log(runtime, "✅ Static analysis passed!")
    return {"test_passed": True, "build_logs": ""}


# ── Node 4: LLM Self-Healing ────────────────────────────────────────────────
def analyze_and_fix_node(state: AgentState, runtime: Runtime[RunContext]) -> dict:
    _check_cancel(runtime)
    logs = state.get("build_logs", "")
    iterations = state.get("iterations", 0)
    cwd = _cwd(state)

    _log(runtime, f"🤖 Agent fixing breaking changes (Attempt {iterations + 1}/3)...")

    tc = _toolchain(state)
    match = tc.file_error_regex().search(logs)
    if not match:
        _log(runtime, "Could not determine file path from error logs. Aborting.")
        return {"iterations": iterations + 1}

    rel_path = match.group(1)
    file_path = os.path.join(cwd, rel_path)

    if not os.path.exists(file_path):
        _log(runtime, f"File not found locally: {file_path}")
        return {"iterations": iterations + 1}

    with open(file_path, "r") as f:
        original_code = f.read()

    llm = init_chat_model(model="gemma-4-26b-a4b-it", model_provider="openai", temperature=0.0)

    system_prompt = (
        f"{tc.expert_role}\n"
        "Analyze the provided build error and file contents, and return the ENTIRE corrected "
        "file content inside standard markdown code blocks. Do not explain anything else."
    )
    user_content = (
        f"--- ERROR LOG ---\n{logs}\n\n"
        f"--- FILE PATH ---\n{rel_path}\n\n"
        f"--- CURRENT FILE CONTENT ---\n{original_code}"
    )

    response = llm.invoke([SystemMessage(content=system_prompt), HumanMessage(content=user_content)])
    code_match = re.search(rf"```{re.escape(tc.code_fence)}\n(.*?)```", response.content, re.DOTALL)
    fixed_code = code_match.group(1) if code_match else response.content.strip("`")

    with open(file_path, "w") as f:
        f.write(fixed_code)

    _log(runtime, f"✏️ Patched breaking signature in {rel_path}")
    return {"iterations": iterations + 1}


# ── Node 5: Claude Code Agent ───────────────────────────────────────────────
def claude_code_node(state: AgentState, runtime: Runtime[RunContext]) -> dict:
    _check_cancel(runtime)
    logs = state.get("build_logs", "")
    affected_vulns = state.get("affected_vulns", [])
    iterations = state.get("iterations", 0)
    session_id = state.get("claude_session_id", "")
    cwd = _cwd(state)

    if session_id:
        _log(runtime, f"🤖 Resuming Claude Code session {session_id} (Attempt {iterations + 1})...")
    else:
        _log(runtime, f"🤖 Launching new Claude Code session (Attempt {iterations + 1})...")

    prompt = "Review the codebase and fix any compilation errors or test failures."
    if logs:
        prompt = _toolchain(state).build_error_prompt(logs)
    elif affected_vulns:
        prompt = (
            f"Trivy scan detected these vulnerabilities with no upstream fix:\n"
            f"{json.dumps(affected_vulns, indent=2)}\n\n"
            "Please rewrite the affected code to mitigate or remove the dependency."
        )

    model = os.environ.get("CLAUDE_MODEL", "sonnet")
    effort = os.environ.get("CLAUDE_EFFORT", "low")
    _log(runtime, f"using model: {model} with effort: {effort}")
    base_cmd = ["claude", "--model", model, "--effort", effort,
                "--permission-mode", "auto", "--output-format", "json"]
    cmd = base_cmd + (["--resume", session_id, prompt] if session_id else [prompt])

    new_session_id = session_id
    pid_path = os.path.join(_run_dir(state), "active_pid")
    try:
        _log(runtime, f"running cmd: {' '.join(cmd)}")
        _log(runtime, "--- Claude Code Output ---")
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=cwd)
        with open(pid_path, "w") as f:
            f.write(str(proc.pid))
        lines: list[str] = []
        assert proc.stdout is not None
        for line in proc.stdout:
            _log(runtime, line.rstrip("\n"))
            lines.append(line)
        proc.wait()
        stdout = "".join(lines)
        try:
            output = json.loads(stdout)
            if not session_id and output.get("session_id"):
                new_session_id = output["session_id"]
                _log(runtime, f"📌 New Claude Code session created: {new_session_id}")
        except json.JSONDecodeError:
            pass
    except Exception as e:  # noqa: BLE001
        _log(runtime, f"❌ Failed to run Claude Code: {e}", err=True)
    finally:
        try:
            os.remove(pid_path)
        except FileNotFoundError:
            pass

    return {"iterations": iterations + 1, "claude_session_id": new_session_id}


# ── Node 4.5: Wait for Human Decision (LangGraph interrupt) ─────────────────
def wait_for_decision_node(state: AgentState, runtime: Runtime[RunContext]) -> dict:
    """Pause the graph and surface a structured prompt to the caller.

    LangGraph interrupt rules applied here:
    - interrupt() MUST NOT be wrapped in a bare try/except — it works by
      raising a special internal exception that the runtime catches.
    - On resume the runtime re-enters this node from the TOP (not from the
      interrupt() line), so every line above interrupt() runs twice: once
      before the pause and once before continuing.  Code below interrupt()
      runs only once — after the human provides input.
    - The index.json update (above interrupt) is idempotent: setting
      "paused" twice has no additional effect, so re-entry is safe.
    - The _log and return statement (below interrupt) run exactly once.
    - The interrupt payload must be JSON-serializable.
    """
    _check_cancel(runtime)

    # Mark as "paused" so the UI can reflect the correct status before the
    # user sees the prompt.  Idempotent — safe to run again on re-entry.
    index_path = os.path.join(_index_dir(state), "index.json")
    run_id = state["run_id"]

    def _mark_paused(entries: list[dict]) -> None:
        for entry in entries:
            if entry.get("run_id") == run_id:
                entry["status"] = "paused"
                break

    try:
        _update_index(index_path, _mark_paused)
    except Exception:  # noqa: BLE001
        pass  # never let an index write block the interrupt

    # ── Pause point ──────────────────────────────────────────────────────────
    # Execution suspends here on the first call.  The runtime persists graph
    # state via the checkpointer and surfaces the payload to the caller.
    # On resume (Command(resume=<decision>)), the runtime re-enters from the
    # top of this node; this call returns the resume value immediately without
    # pausing again.
    #
    # Payload shape:
    #   "contract" → name used by agent_registry to look up the static
    #                PauseContract (prompt, options, labels) from contracts.py.
    #   "context"  → dynamic per-run data merged into the WebSocket "pause"
    #                event so the frontend can show the actual build output.
    decision: str = interrupt({
        "contract": "dep_scan.test_failed",
        "context": {"build_logs": state.get("build_logs", "")},
    })
    # ─────────────────────────────────────────────────────────────────────────

    # Everything below runs once — only after the human has provided input.
    _log(runtime, f"▶️  Resuming with decision: {decision}")
    return {"human_decision": decision}


# ── Routing ─────────────────────────────────────────────────────────────────
def route_after_test(state: AgentState) -> str:
    if state.get("test_passed"):
        return "final_scan"
    if state.get("iterations", 0) >= 1:
        return "final_scan"
    return "wait_for_decision"


def route_after_decision(state: AgentState) -> str:
    # Mark as "paused" so the UI can reflect the correct status before the
    # user sees the prompt.  Idempotent — safe to run again on re-entry.
    index_path = os.path.join(_index_dir(state), "index.json")
    run_id = state["run_id"]

    def _mark_paused(entries: list[dict]) -> None:
        for entry in entries:
            if entry.get("run_id") == run_id:
                entry["status"] = "running"
                break

    try:
        _update_index(index_path, _mark_paused)
    except Exception:  # noqa: BLE001
        pass  # never let an index write block the interrupt
    if state.get("human_decision") == "skip_to_final_scan":
        return "final_scan"
    return "claude_code"


# ── Node 6: Final Scan ──────────────────────────────────────────────────────
def final_scan_node(state: AgentState, runtime: Runtime[RunContext]) -> dict:
    _check_cancel(runtime)
    _log(runtime, "🔍 Running final Trivy scan...")
    try:
        env = os.environ.copy()
        env["DOCKER_CONFIG"] = "/tmp"
        result = _run_tracked(
            state,
            ["trivy", "fs", "--format", "json", "--severity",
             "UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL", "--pkg-types", "library",
             "--skip-dirs", ".venv,__pycache__,node_modules,vendor,pre-upgrade",
             "."],
            capture_output=True, text=True, check=True, env=env, cwd=_cwd(state),
        )
        report_path = os.path.join(_run_dir(state), "end.json")
        with open(report_path, "w") as f:
            f.write(result.stdout)
        _log(runtime, f"💾 Final scan report saved to: {report_path}")
    except Exception as e:  # noqa: BLE001
        _log(runtime, f"❌ Final Trivy scan failed: {e}", err=True)
    return {}


# ── Node 7: Diff Report ─────────────────────────────────────────────────────
def diff_report_node(state: AgentState, runtime: Runtime[RunContext]) -> dict:
    _check_cancel(runtime)
    _log(runtime, "📊 Generating vulnerability diff report...")
    run_dir = _run_dir(state)
    start_path = os.path.join(run_dir, "start.json")
    end_path = os.path.join(run_dir, "end.json")
    diff_path = os.path.join(run_dir, "diff.json")

    def load_vulns(path: str) -> list[dict]:
        with open(path) as f:
            data = json.load(f)
        return [v for target in data.get("Results", []) for v in target.get("Vulnerabilities", [])]

    try:
        start_vulns = load_vulns(start_path)
        end_vulns = load_vulns(end_path)
    except FileNotFoundError as e:
        _log(runtime, f"❌ Cannot diff — missing report file: {e}", err=True)
        return {}

    start_df = pl.DataFrame({"id": [v.get("VulnerabilityID") for v in start_vulns]}, schema={"id": pl.String})
    end_df = pl.DataFrame({"id": [v.get("VulnerabilityID") for v in end_vulns]}, schema={"id": pl.String})

    start_only_ids = set(start_df.join(end_df, on="id", how="anti")["id"].to_list())
    end_only_ids = set(end_df.join(start_df, on="id", how="anti")["id"].to_list())
    both_ids = set(start_df.join(end_df, on="id", how="inner")["id"].to_list())

    diff = {
        "fixed": [v for v in start_vulns if v.get("VulnerabilityID") in start_only_ids],
        "new": [v for v in end_vulns if v.get("VulnerabilityID") in end_only_ids],
        "persisted": [v for v in start_vulns if v.get("VulnerabilityID") in both_ids],
    }
    with open(diff_path, "w") as f:
        json.dump(diff, f, indent=2)

    index_path = os.path.join(_index_dir(state), "index.json")
    run_id = state["run_id"]
    summary = {"fixed": len(diff["fixed"]), "persisted": len(diff["persisted"]), "new": len(diff["new"])}

    def _complete(entries: list[dict]) -> None:
        for entry in entries:
            if entry.get("run_id") == run_id:
                entry["status"] = "completed"
                entry["summary"] = summary
                break

    _update_index(index_path, _complete)

    _log(runtime, f"fixed: {len(diff['fixed'])}  |  new: {len(diff['new'])}  |  persisted: {len(diff['persisted'])}")
    _log(runtime, f"💾 Diff saved to: {diff_path}")
    _log(runtime, f"📋 Index updated: {index_path}")
    return {}


def cleanup_run(state: AgentState) -> None:
    """Remove the run directory and its index.json entry.

    Called on cancellation or unexpected kill so partial artifacts don't linger
    as a permanent "running" ghost entry.  Both operations are idempotent, so
    racing with Rust's delete_agent_run is harmless.
    """
    run_dir = _run_dir(state)
    shutil.rmtree(run_dir, ignore_errors=True)

    index_path = os.path.join(_index_dir(state), "index.json")
    run_id = state["run_id"]

    def _remove(entries: list[dict]) -> None:
        entries[:] = [e for e in entries if e.get("run_id") != run_id]

    try:
        _update_index(index_path, _remove)
    except Exception:  # noqa: BLE001
        pass


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ── Build the Pipeline ──────────────────────────────────────────────────────
def build_workflow(checkpointer=None):
    g = StateGraph(AgentState, context_schema=RunContext)
    g.add_node("scan", scan_trivy_node)
    g.add_node("update", update_dependencies_node)
    g.add_node("test", run_tests_node)
    g.add_node("wait_for_decision", wait_for_decision_node)
    g.add_node("analyze_and_fix", analyze_and_fix_node)
    g.add_node("claude_code", claude_code_node)
    g.add_node("final_scan", final_scan_node)
    g.add_node("diff_report", diff_report_node)

    g.set_entry_point("scan")
    g.add_edge("scan", "update")
    g.add_edge("update", "test")
    g.add_conditional_edges("test", route_after_test)
    g.add_conditional_edges("wait_for_decision", route_after_decision)
    g.add_edge("claude_code", "test")
    g.add_edge("analyze_and_fix", "test")
    g.add_edge("final_scan", "diff_report")
    g.add_edge("diff_report", END)
    return g.compile(checkpointer=checkpointer)


def make_initial_state(
    *,
    project: str,
    root_dir: str,
    repo_path: str,
    job_id: str = "",
    language: str | None = None,
) -> AgentState:
    """Build the AgentState used to invoke() the graph.

    root_dir is the project's per-project base path (sibling to workspaces/);
    reports are written under <root_dir>/reports/<project>/<agent>/<run_id>/.
    job_id is the UUID assigned by the sidecar; empty string in CLI mode.

    language is the toolchain name; when omitted it is auto-detected from the
    repo manifest via languages.detect_toolchain().

    Runtime-only objects (log_fn, cancel_event) are passed via context= on
    each invoke() call so they never enter the msgpack-serialized checkpoint.
    """
    if language is None:
        detected = detect_toolchain(repo_path)
        if detected is None:
            raise RuntimeError(
                f"No supported language detected in {repo_path}. "
                f"Supported: {supported_languages()}."
            )
        language = detected.name
    elif language not in supported_languages():
        raise ValueError(
            f"Unsupported language {language!r}. Supported: {supported_languages()}."
        )

    now = datetime.datetime.now(datetime.timezone.utc)
    return {
        "project": project,
        "root_dir": root_dir,
        "repo_path": repo_path,
        "run_id": now.strftime("%Y%m%d_%H%M%S"),
        "run_ts_iso": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "cwd": repo_path,
        "language": language,
        "job_id": job_id,
        "fixed_vulns": [],
        "affected_vulns": [],
        "build_logs": "",
        "test_passed": False,
        "iterations": 0,
        "current_error_file": "",
        "claude_session_id": "",
        "human_decision": "",
    }


# ── CLI Entrypoint ──────────────────────────────────────────────────────────
@click.command()
def main() -> None:
    """Dependency vulnerability scan + auto-remediation CLI agent (dep_scan)."""
    project = os.environ.get("PROJECT", "")
    repo = os.environ.get("REPO") or project  # historical: REPO defaults to PROJECT

    if not project:
        click.echo("❌ Error: PROJECT environment variable is not set.", err=True)
        sys.exit(1)

    # CLI fallback: use data_root() as root_dir if no project record exists.
    from opensecai.core.paths import data_root
    from opensecai.storage.projects import get_project_store

    record = get_project_store().get(project)
    root_dir = record.root_dir if record else str(data_root())

    repo_path = os.environ.get("REPO_PATH") or str(workspaces_root() / repo)
    detected = detect_toolchain(repo_path)
    if detected is None:
        click.echo(
            f"❌ Error: no supported language detected in {repo_path}. "
            f"Supported: {supported_languages()}.",
            err=True,
        )
        sys.exit(1)

    if not os.environ.get("OPENAI_API_KEY"):
        click.echo("❌ Error: OPENAI_API_KEY environment variable is not set.", err=True)
        sys.exit(1)

    click.echo(f"📂 Targeting directory: {repo_path} (language: {detected.name})")

    from langgraph.checkpoint.memory import MemorySaver

    checkpointer = MemorySaver()
    initial_state = make_initial_state(
        project=project, root_dir=root_dir, repo_path=repo_path, language=detected.name
    )
    run_id = initial_state["run_id"]
    config = {"configurable": {"thread_id": run_id}}
    ctx = {"log_fn": None, "cancel_event": None}
    workflow = build_workflow(checkpointer=checkpointer)
    try:
        workflow.invoke(initial_state, config=config, context=ctx)

        # If the graph paused at a breakpoint (no UI in CLI mode), auto-resume
        # with the default decision so the run completes without human input.
        graph_state = workflow.get_state(config)
        if graph_state.next:
            click.echo("⚠️  Tests failed — no UI in CLI mode, defaulting to 'proceed_claude_code'")
            workflow.invoke(Command(resume="proceed_claude_code"), config=config, context=ctx)
    except Exception:
        cleanup_run(initial_state)
        raise


if __name__ == "__main__":
    main()
