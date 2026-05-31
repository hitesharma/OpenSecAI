import os
import re
import json
import subprocess
import sys
from typing import TypedDict, List, Annotated
import operator
import click
from dotenv import load_dotenv

from langchain_core.messages import HumanMessage, SystemMessage
from langchain.chat_models import init_chat_model
import datetime
import polars as pl

load_dotenv()

# Ensure Homebrew and common binary directories are in the PATH
for p in ["/opt/homebrew/bin", "/usr/local/bin", os.path.expanduser("~/.local/bin")]:
    if p not in os.environ.get("PATH", "").split(os.pathsep):
        os.environ["PATH"] = p + os.pathsep + os.environ.get("PATH", "")

ORIGINAL_CWD = os.getcwd()
TARGET_DIR = "kubernetes"
RUN_TIMESTAMP = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

from langgraph.graph import StateGraph, END

# Define the local state matching our CLI workflow
class AgentState(TypedDict):
    fixed_vulns: List[dict]
    affected_vulns: List[dict]
    build_logs: str
    test_passed: bool
    iterations: int
    current_error_file: str
    claude_session_id: str

# --- Node 1: Scan with Trivy ---
def scan_trivy_node(state: AgentState) -> dict:
    click.echo("🔍 Running Trivy vulnerability scan...")
    try:
        env = os.environ.copy()
        env["DOCKER_CONFIG"] = "/tmp"
        # Run trivy scanning for filesystem vulnerabilities in JSON format
        result = subprocess.run(
            ["trivy", "fs", "--format", "json", "--severity", "UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL", "--pkg-types", "library", "."],
            capture_output=True, text=True, check=True, env=env
        )
        # Save the JSON report
        report_dir = os.path.join(ORIGINAL_CWD, "report", TARGET_DIR, RUN_TIMESTAMP)
        os.makedirs(report_dir, exist_ok=True)
        report_path = os.path.join(report_dir, f"start.json")
        with open(report_path, "w") as f:
            f.write(result.stdout)
        click.echo(f"💾 Saved scan report to: {report_path}")

        data = json.loads(result.stdout)
        
        fixed_vulns = []
        affected_vulns = []
        if "Results" in data:
            for target in data["Results"]:
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

        click.echo(f"Found {len(fixed_vulns)+len(affected_vulns)} vulnerability records.")
        return {"fixed_vulns": fixed_vulns, "affected_vulns": affected_vulns, "iterations": 0}
    except Exception as e:
        click.echo(f"❌ Trivy scan failed: {e}", err=True)
        return {"fixed_vulns": [], "affected_vulns": [], "iterations": 0}

# --- Node 2: Update Dependencies ---
def update_dependencies_node(state: AgentState) -> dict:
    fixed_vulns = state.get("fixed_vulns", [])
    affected_vulns = state.get("affected_vulns", [])

    if not fixed_vulns and not affected_vulns:
        click.echo("No vulnerabilities found to update.")
        return {}

    if affected_vulns:
        click.echo(f"⚠️  {len(affected_vulns)} affected vulnerabilities have no upstream fix yet — skipping.")

    if fixed_vulns:
        click.echo(f"Found fix for {len(fixed_vulns)} vulnerabilities")
    else:
        return {}

    # Deduplicate by (package, fixed_version) — keep the highest fixed_version per package
    seen: dict[str, str] = {}
    for v in fixed_vulns:
        pkg = v.get("package")
        version = v.get("fixed_version")
        if pkg and version:
            seen[pkg] = version

    # Tidy first to establish a clean baseline before pinning
    click.echo("🧹 Tidying go.mod (pre-upgrade)...")
    subprocess.run(["go", "mod", "tidy"], capture_output=True)

    click.echo(f"🆙 Upgrading {len(seen)} Go package(s) to their fixed versions...")
    for pkg, version in seen.items():
        go_version = version if version.startswith("v") else f"v{version}"
        target = f"{pkg}@{go_version}"
        click.echo(f"  -> go get {target}")
        res = subprocess.run(["go", "get", target], capture_output=True, text=True)
        if res.returncode != 0:
            click.echo(f"  ⚠️  Failed to upgrade {target}: {res.stderr.strip()}", err=True)

    # Do NOT run go mod tidy after pinning — tidy uses MVS and will revert security pins
    # on indirect dependencies that nothing in the direct dep graph requires at that version.
    return {}

# --- Node 3: Test and Verify Build ---
def run_tests_node(state: AgentState) -> dict:
    click.echo("🛠️ Performing static analysis of codebase...")
    subprocess.run(["go", "mod", "tidy"], capture_output=True)

    build_res = subprocess.run(["go", "vet", "./..."], capture_output=True, text=True)
    
    if build_res.returncode != 0:
        click.echo("❌ Breaking changes detected.")
        return {"test_passed": False, "build_logs": build_res.stderr}
        
    # If build succeeds, run unit tests
    # test_res = subprocess.run(["go", "test", "./..."], capture_output=True, text=True)
    # if test_res.returncode != 0:
    #     click.echo("❌ Tests failed!")
    #     return {"test_passed": False, "build_logs": test_res.stderr}

    # click.echo("✅ Project builds and passes all tests successfully!")
    click.echo("✅ Static analysis passed!")
    return {"test_passed": True, "build_logs": ""}

# --- Node 4: LLM Self-Healing Node ---
def analyze_and_fix_node(state: AgentState) -> dict:
    logs = state.get("build_logs", "")
    iterations = state.get("iterations", 0)
    
    click.echo(f"🤖 Agent fixing breaking changes (Attempt {iterations + 1}/3)...")
    
    # Simple regex parsing to find the first problematic Go file and line number
    # Example match: main.go:14:2: undefined: crypto.OldFunction
    match = re.search(r"(([a-zA-Z0-9_\-]+/\#)?([a-zA-Z0-9_\-\.\/]+)\.go):(\d+):", logs)
    if not match:
        click.echo("Could not determine file path from error logs. Aborting.")
        return {"iterations": iterations + 1}
        
    file_path = match.group(1)
    
    if not os.path.exists(file_path):
        click.echo(f"File not found locally: {file_path}")
        return {"iterations": iterations + 1}
        
    with open(file_path, "r") as f:
        original_code = f.read()

    # Initialize LLM 
    llm = init_chat_model(
        model="gemma-4-26b-a4b-it",
        model_provider="openai",
        temperature=0.0
    )
    
    system_prompt = (
        "You are an expert Go developer specialized in migrating breaking API updates, "
        "handling package deprecations, or matching changed initialization signatures.\n"
        "Analyze the provided build error and file contents, and return the ENTIRE corrected "
        "file content inside standard markdown code blocks. Do not explain anything else."
    )
    
    user_content = f"--- ERROR LOG ---\n{logs}\n\n--- FILE PATH ---\n{file_path}\n\n--- CURRENT FILE CONTENT ---\n{original_code}"
    
    response = llm.invoke([
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_content)
    ])
    
    # Extract code from Markdown formatting blocks
    code_match = re.search(r"```go\n(.*?)```", response.content, re.DOTALL)
    if code_match:
        fixed_code = code_match.group(1)
    else:
        fixed_code = response.content.strip("`")

    # Overwrite file with corrected version
    with open(file_path, "w") as f:
        f.write(fixed_code)
        
    click.echo(f"✏️ Patched breaking signature in {file_path}")
    return {"iterations": iterations + 1}

# --- Node 5: Claude Code Agent Node ---
def claude_code_node(state: AgentState) -> dict:
    logs = state.get("build_logs", "")
    affected_vulns = state.get("affected_vulns", [])
    iterations = state.get("iterations", 0)
    session_id = state.get("claude_session_id", "")

    if session_id:
        click.echo(f"🤖 Resuming Claude Code session {session_id} (Attempt {iterations + 1})...")
    else:
        click.echo(f"🤖 Launching new Claude Code session (Attempt {iterations + 1})...")

    prompt = "Review the codebase and fix any compilation errors or test failures."
    if logs:
        prompt = (
            f"fix the go vet err:\n{logs}\n"
        )
    elif affected_vulns:
        vulns_str = json.dumps(affected_vulns, indent=2)
        prompt = (
            f"Trivy scan detected these vulnerabilities with no upstream fix:\n{vulns_str}\n\n"
            "Please rewrite the affected code to mitigate or remove the dependency."
        )

    model = os.environ.get("CLAUDE_MODEL", "haiku")
    effort = os.environ.get("CLAUDE_EFFORT", "low")
    click.echo(f"using model: {model} with effort: {effort}")
    base_cmd = ["claude", "--model", model, "--effort", effort, "--permission-mode", "auto", "--output-format", "json"]
    cmd = base_cmd + [prompt]
    if session_id:
        cmd = base_cmd + ["--resume", session_id, prompt]

    new_session_id = session_id
    try:
        click.echo(f"running cmd: {' '.join(cmd)}")
        click.echo("--- Claude Code Output ---")
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        # Stream stdout line-by-line in real time, accumulate for JSON parsing
        lines = []
        for line in proc.stdout:
            click.echo(line, nl=False)
            lines.append(line)
        proc.wait()
        stdout = "".join(lines)

        try:
            output = json.loads(stdout)
            if not session_id and output.get("session_id"):
                new_session_id = output["session_id"]
                click.echo(f"📌 New Claude Code session created: {new_session_id}")
        except json.JSONDecodeError:
            pass
    except Exception as e:
        click.echo(f"❌ Failed to run Claude Code: {e}", err=True)

    return {"iterations": iterations + 1, "claude_session_id": new_session_id}

# --- Routing Condition ---
def route_after_test(state: AgentState):
    if state["test_passed"]:
        return "final_scan"
    if state.get("iterations", 0) >= 3:
        click.echo("⚠️ Max self-healing limit reached. Manual intervention required.")
        return "final_scan"
    return "claude_code"

# --- Node 6: Final Scan ---
def final_scan_node(state: AgentState) -> dict:
    click.echo("🔍 Running final Trivy scan...")
    try:
        env = os.environ.copy()
        env["DOCKER_CONFIG"] = "/tmp"
        result = subprocess.run(
            ["trivy", "fs", "--format", "json", "--severity", "UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL", "--pkg-types", "library", "."],
            capture_output=True, text=True, check=True, env=env
        )
        report_dir = os.path.join(ORIGINAL_CWD, "report", TARGET_DIR, RUN_TIMESTAMP)
        os.makedirs(report_dir, exist_ok=True)
        report_path = os.path.join(report_dir, "end.json")
        with open(report_path, "w") as f:
            f.write(result.stdout)
        click.echo(f"💾 Final scan report saved to: {report_path}")
    except Exception as e:
        click.echo(f"❌ Final Trivy scan failed: {e}", err=True)
    return {}

# --- Node 7: Diff Report ---
def diff_report_node(state: AgentState) -> dict:
    click.echo("📊 Generating vulnerability diff report...")
    report_dir = os.path.join(ORIGINAL_CWD, "report", TARGET_DIR, RUN_TIMESTAMP)
    start_path = os.path.join(report_dir, "start.json")
    end_path = os.path.join(report_dir, "end.json")
    diff_path = os.path.join(report_dir, "diff.json")

    def load_vulns(path: str) -> list[dict]:
        with open(path) as f:
            data = json.load(f)
        return [v for target in data.get("Results", []) for v in target.get("Vulnerabilities", [])]

    try:
        start_vulns = load_vulns(start_path)
        end_vulns = load_vulns(end_path)
    except FileNotFoundError as e:
        click.echo(f"❌ Cannot diff — missing report file: {e}", err=True)
        return {}

    start_df = pl.DataFrame({"id": [v.get("VulnerabilityID") for v in start_vulns]})
    end_df = pl.DataFrame({"id": [v.get("VulnerabilityID") for v in end_vulns]})

    start_only_ids = set(start_df.join(end_df, on="id", how="anti")["id"].to_list())
    end_only_ids = set(end_df.join(start_df, on="id", how="anti")["id"].to_list())
    both_ids = set(start_df.join(end_df, on="id", how="inner")["id"].to_list())

    diff = {
        "start_only": [v for v in start_vulns if v.get("VulnerabilityID") in start_only_ids],
        "end_only":   [v for v in end_vulns   if v.get("VulnerabilityID") in end_only_ids],
        "in_both":    [v for v in start_vulns if v.get("VulnerabilityID") in both_ids],
    }

    with open(diff_path, "w") as f:
        json.dump(diff, f, indent=2)

    click.echo(
        f"  fixed: {len(diff['start_only'])}  |  "
        f"new: {len(diff['end_only'])}  |  "
        f"persisted: {len(diff['in_both'])}"
    )
    click.echo(f"💾 Diff saved to: {diff_path}")
    return {}

# --- Build the Pipeline ---
def build_workflow():
    workflow = StateGraph(AgentState)
    workflow.add_node("scan", scan_trivy_node)
    workflow.add_node("update", update_dependencies_node)
    workflow.add_node("test", run_tests_node)
    workflow.add_node("analyze_and_fix", analyze_and_fix_node)
    workflow.add_node("claude_code", claude_code_node)
    workflow.add_node("final_scan", final_scan_node)
    workflow.add_node("diff_report", diff_report_node)

    workflow.set_entry_point("scan")
    workflow.add_edge("scan", "update")
    workflow.add_edge("update", "test")
    workflow.add_conditional_edges("test", route_after_test)
    workflow.add_edge("claude_code", "test")
    workflow.add_edge("analyze_and_fix", "test")
    workflow.add_edge("final_scan", "diff_report")
    workflow.add_edge("diff_report", END)
    return workflow.compile()

@click.command()
def main():
    """Go Project Security Scanning and Healing CLI Agent."""
    if not os.path.exists(os.path.join(TARGET_DIR, "go.mod")):
        click.echo(f"❌ Error: No go.mod found in {TARGET_DIR}. Run this tool inside a Go project root folder or ensure target exists.", err=True)
        sys.exit(1)

    click.echo(f"📂 Targeting directory: {TARGET_DIR}")
    os.chdir(TARGET_DIR)
        
    if not os.environ.get("OPENAI_API_KEY"):
        click.echo("❌ Error: OPENAI_API_KEY environment variable is not set.", err=True)
        sys.exit(1)

    app = build_workflow()
    app.invoke({"fixed_vulns": [], "affected_vulns": [], "build_logs": "", "test_passed": False, "iterations": 0, "claude_session_id": ""})

if __name__ == "__main__":
    main()