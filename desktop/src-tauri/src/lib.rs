mod sidecar;

#[cfg(unix)]
use libc;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager, RunEvent};

use sidecar::SIDECAR_PGID;

static QUIT_CONFIRMED: AtomicBool = AtomicBool::new(false);

use sidecar::SidecarHandle;

/// Kill the existing sidecar (if any) and spawn a fresh one.
/// Returns `Ok(())` on successful spawn, or an error string.
#[tauri::command]
fn restart_sidecar(app: tauri::AppHandle) -> Result<(), String> {
    let state: tauri::State<'_, SidecarHandle> = app.state();
    sidecar::kill(&state);
    match sidecar::spawn(&app) {
        Ok(child) => {
            *state.0.lock().unwrap() = Some(child);
            Ok(())
        }
        Err(e) => Err(e),
    }
}

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let env = std::env::var("ENV").unwrap_or_else(|_| "prod".into());
    if env == "dev" {
        std::env::current_dir()
            .map_err(|e| e.to_string())?
            .parent()
            .ok_or_else(|| "could not resolve repo root".to_string())
            .map(|p| p.to_path_buf())
    } else {
        app.path().app_data_dir().map_err(|e| e.to_string())
    }
}

/// Resolve the per-project reports base. If `root_dir` is empty, fall back to
/// the global data_dir (legacy / dev convenience) so older callers keep working.
fn project_reports_base(
    app: &tauri::AppHandle,
    root_dir: &str,
    project: &str,
    agent: &str,
) -> Result<PathBuf, String> {
    let base = if root_dir.is_empty() {
        data_dir(app)?
    } else {
        PathBuf::from(root_dir)
    };
    Ok(base.join("reports").join(project).join(agent))
}

/// Read `<root_dir>/reports/<project>/<agent>/index.json` and return its raw JSON.
/// Returns an empty array if the file does not exist.
#[tauri::command]
fn read_agent_index(
    app: tauri::AppHandle,
    root_dir: String,
    project: String,
    agent: String,
) -> Result<serde_json::Value, String> {
    let path = project_reports_base(&app, &root_dir, &project, &agent)?.join("index.json");
    if !path.exists() {
        return Ok(serde_json::Value::Array(vec![]));
    }
    let contents = std::fs::read_to_string(&path)
        .map_err(|e| format!("failed to read {}: {e}", path.display()))?;
    serde_json::from_str(&contents)
        .map_err(|e| format!("failed to parse {}: {e}", path.display()))
}

/// Read `<root_dir>/reports/<project>/<agent>/<run_id>/events.jsonl` line by line.
/// Each non-empty line is parsed as a JSON object and returned in order.
/// Returns an empty array if the file does not exist.
#[tauri::command]
fn read_run_events(
    app: tauri::AppHandle,
    root_dir: String,
    project: String,
    agent: String,
    run_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let path = project_reports_base(&app, &root_dir, &project, &agent)?
        .join(&run_id)
        .join("events.jsonl");
    if !path.exists() {
        return Ok(vec![]);
    }
    let contents = std::fs::read_to_string(&path)
        .map_err(|e| format!("failed to read {}: {e}", path.display()))?;
    contents
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| {
            serde_json::from_str::<serde_json::Value>(l)
                .map_err(|e| format!("invalid JSONL line: {e}"))
        })
        .collect()
}

/// Read `<root_dir>/reports/<project>/<agent>/<run_id>/diff.json` and return its raw JSON.
/// Returns `null` if the file does not exist so the UI can render an empty state.
#[tauri::command]
fn read_run_diff(
    app: tauri::AppHandle,
    root_dir: String,
    project: String,
    agent: String,
    run_id: String,
) -> Result<serde_json::Value, String> {
    let path = project_reports_base(&app, &root_dir, &project, &agent)?
        .join(&run_id)
        .join("diff.json");
    if !path.exists() {
        return Ok(serde_json::Value::Null);
    }
    let contents = std::fs::read_to_string(&path)
        .map_err(|e| format!("failed to read {}: {e}", path.display()))?;
    serde_json::from_str(&contents)
        .map_err(|e| format!("failed to parse {}: {e}", path.display()))
}

/// Delete a single run: remove `<base>/<run_id>/` and drop its entry from
/// `index.json`. Idempotent — missing dir or absent index entry is not an error.
#[tauri::command]
fn delete_agent_run(
    app: tauri::AppHandle,
    root_dir: String,
    project: String,
    agent: String,
    run_id: String,
) -> Result<(), String> {
    // Reject path-traversal: run_id is a single directory segment only.
    if run_id.is_empty() || run_id.contains('/') || run_id.contains('\\') || run_id.contains("..") {
        return Err(format!("invalid run_id: {run_id}"));
    }

    let base = project_reports_base(&app, &root_dir, &project, &agent)?;

    let run_dir = base.join(&run_id);

    // Kill any active subprocess before removing files. The runner writes its
    // current child's PID to active_pid so we can SIGKILL it immediately
    // without waiting for the next node-boundary cancel check.
    #[cfg(unix)]
    {
        let pid_path = run_dir.join("active_pid");
        if let Ok(s) = std::fs::read_to_string(&pid_path) {
            if let Ok(pid) = s.trim().parse::<libc::pid_t>() {
                unsafe {
                    libc::kill(pid, libc::SIGKILL);
                    libc::killpg(pid, libc::SIGKILL);
                }
            }
        }
    }

    if run_dir.exists() {
        std::fs::remove_dir_all(&run_dir)
            .map_err(|e| format!("failed to delete {}: {e}", run_dir.display()))?;
    }

    let index_path = base.join("index.json");
    if index_path.exists() {
        let contents = std::fs::read_to_string(&index_path)
            .map_err(|e| format!("failed to read {}: {e}", index_path.display()))?;
        let entries: Vec<serde_json::Value> = serde_json::from_str(&contents)
            .map_err(|e| format!("failed to parse {}: {e}", index_path.display()))?;
        let filtered: Vec<serde_json::Value> = entries
            .into_iter()
            .filter(|e| e.get("run_id").and_then(|v| v.as_str()) != Some(run_id.as_str()))
            .collect();
        let serialized = serde_json::to_string_pretty(&filtered)
            .map_err(|e| format!("failed to serialize index: {e}"))?;
        std::fs::write(&index_path, serialized)
            .map_err(|e| format!("failed to write {}: {e}", index_path.display()))?;
    }

    Ok(())
}

/// Called by the frontend's "Quit" button — kills the sidecar then exits cleanly.
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    let state: tauri::State<'_, SidecarHandle> = app.state();
    sidecar::kill(&state);
    QUIT_CONFIRMED.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = dotenvy::dotenv();

    // SIGINT / SIGTERM (Ctrl-C from terminal, `kill <pid>`) bypass Tauri's
    // RunEvent::Exit, so we register a handler here that does the same cleanup
    // before terminating the process.
    let _ = ctrlc::set_handler(|| {
        #[cfg(unix)]
        {
            let pgid = SIDECAR_PGID.load(Ordering::SeqCst);
            if pgid > 0 {
                unsafe { libc::killpg(pgid, libc::SIGKILL) };
            }
        }
        sidecar::kill_by_port(8765);
        std::process::exit(0);
    });

    tauri::Builder::default()
        .manage(SidecarHandle(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![read_agent_index, read_run_diff, read_run_events, delete_agent_run, restart_sidecar, quit_app])
        .setup(|app| {
            let handle = app.handle().clone();
            match sidecar::spawn(&handle) {
                Ok(child) => {
                    let state: tauri::State<'_, SidecarHandle> = handle.state();
                    *state.0.lock().unwrap() = Some(child);
                }
                Err(e) => eprintln!("[sidecar] spawn failed: {e}"),
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            // macOS only: Cmd+Q and dock "Quit" fire ExitRequested at the app
            // level, bypassing the per-window CloseRequested event.
            // On Linux every close path (Alt+F4, ×) goes through CloseRequested,
            // so we only need this arm on macOS.
            #[cfg(target_os = "macos")]
            RunEvent::ExitRequested { api, .. } => {
                if QUIT_CONFIRMED.load(Ordering::SeqCst) {
                    // User confirmed quit via the dialog — let the exit through.
                    return;
                }
                api.prevent_exit();
                if let Some(win) = app_handle.get_webview_window("main") {
                    let _ = win.emit("quit-requested", ());
                }
            }
            // Reached on every exit path — acts as a deferred cleanup guarantee.
            RunEvent::Exit => {
                let state: tauri::State<'_, SidecarHandle> = app_handle.state();
                sidecar::kill(&state);
                // Belt-and-suspenders: kill anything still holding the port,
                // even if the child was orphaned or the handle was already taken.
                sidecar::kill_by_port(8765);
            }
            _ => {}
        });
}
