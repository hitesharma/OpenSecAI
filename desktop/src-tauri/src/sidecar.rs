//! Spawns the OpenSecAI Python sidecar (FastAPI) as a child process.
//!
//! Dev mode  (ENV=dev): runs `uv run opensecai-api` from the repo root.
//! Prod mode (default): expects a bundled binary at `<resource-dir>/opensecai-api`.
//!                      (Bundling via PyInstaller is a separate build-time step;
//!                       not yet implemented — falls back to `uv run` if missing.)
//!
//! The child inherits OPENSECAI_DATA_DIR + ENV so the Python side resolves the
//! same data root as Rust. The process is killed when the Tauri app shuts down.

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::sync::atomic::{AtomicI32, Ordering};
use tauri::Manager;

#[cfg(unix)]
use libc;

/// Holds the running sidecar Child so we can kill it on shutdown.
pub struct SidecarHandle(pub Mutex<Option<Child>>);

/// Process group ID of the live sidecar; 0 means none running.
/// Written on spawn, read by the Ctrl-C signal handler.
pub static SIDECAR_PGID: AtomicI32 = AtomicI32::new(0);

const DEFAULT_PORT: &str = "8765";

pub fn spawn(app: &tauri::AppHandle) -> Result<Child, String> {
    let env = std::env::var("ENV").unwrap_or_else(|_| "prod".into());

    // Resolve the data dir — must match opensecai.core.paths.data_root().
    let data_dir: PathBuf = if env == "dev" {
        std::env::current_dir()
            .map_err(|e| e.to_string())?
            .parent()
            .ok_or("could not resolve repo root")?
            .to_path_buf()
    } else {
        app.path().app_data_dir().map_err(|e| e.to_string())?
    };
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    // Pick host/port — keep in sync with opensecai/api/__main__.py defaults.
    let host = std::env::var("OPENSECAI_API_HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let port = std::env::var("OPENSECAI_API_PORT").unwrap_or_else(|_| DEFAULT_PORT.into());

    let (program, args, cwd) = if env == "dev" {
        // Run via uv from the repo root so deps resolve out of the project venv.
        let repo_root = data_dir.clone();
        (
            "uv".to_string(),
            vec!["run".to_string(), "opensecai-api".to_string()],
            Some(repo_root),
        )
    } else {
        // Try the bundled binary first; fall back to uv if absent.
        let bundled = app
            .path()
            .resource_dir()
            .ok()
            .map(|d| d.join("opensecai-api"));
        match bundled {
            Some(p) if p.exists() => (p.to_string_lossy().into_owned(), vec![], None),
            _ => (
                "uv".to_string(),
                vec!["run".to_string(), "opensecai-api".to_string()],
                None,
            ),
        }
    };

    let mut cmd = Command::new(&program);
    cmd.args(&args)
        .env("ENV", &env)
        .env("OPENSECAI_DATA_DIR", &data_dir)
        .env("OPENSECAI_API_HOST", &host)
        .env("OPENSECAI_API_PORT", &port)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    eprintln!(
        "[sidecar] launching `{} {}` (ENV={env}, data={}, port={port})",
        program,
        args.join(" "),
        data_dir.display()
    );

    // Put the child in its own process group so that killing the group also
    // terminates any grandchildren spawned by `uv run` (e.g. the uvicorn server).
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            cmd.pre_exec(|| {
                libc::setsid();
                Ok(())
            });
        }
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn sidecar `{program}`: {e}"))?;

    // Record PGID so the Ctrl-C signal handler can kill the group.
    #[cfg(unix)]
    SIDECAR_PGID.store(child.id() as i32, Ordering::SeqCst);

    Ok(child)
}

pub fn kill(handle: &SidecarHandle) {
    if let Ok(mut guard) = handle.0.lock() {
        if let Some(mut child) = guard.take() {
            #[cfg(unix)]
            {
                let pgid = child.id() as libc::pid_t;
                // SIGTERM first so uvicorn can flush; SIGKILL after a short wait.
                unsafe { libc::killpg(pgid, libc::SIGTERM) };
                std::thread::sleep(std::time::Duration::from_millis(300));
                unsafe { libc::killpg(pgid, libc::SIGKILL) };
            }
            #[cfg(not(unix))]
            let _ = child.kill();

            let _ = child.wait();
            SIDECAR_PGID.store(0, Ordering::SeqCst);
        }
    }
}

/// Kill any process still holding `port`, regardless of how it got there.
/// Called as a deferred safety net on every exit path.
pub fn kill_by_port(port: u16) {
    #[cfg(unix)]
    {
        // lsof -ti :PORT prints one PID per line for every process bound to the port.
        let Ok(out) = std::process::Command::new("lsof")
            .args(["-ti", &format!(":{port}")])
            .output()
        else {
            return;
        };
        for pid_str in String::from_utf8_lossy(&out.stdout).split_whitespace() {
            if let Ok(pid) = pid_str.trim().parse::<libc::pid_t>() {
                eprintln!("[sidecar] kill_by_port: SIGKILL pid {pid} on port {port}");
                unsafe { libc::kill(pid, libc::SIGKILL) };
            }
        }
    }
    #[cfg(windows)]
    {
        // netstat -ano lists listening ports with their PIDs.
        let Ok(out) = std::process::Command::new("netstat").args(["-ano"]).output() else {
            return;
        };
        let port_marker = format!(":{port}");
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            if line.contains(&port_marker) && line.to_uppercase().contains("LISTENING") {
                if let Some(pid_str) = line.split_whitespace().last() {
                    eprintln!("[sidecar] kill_by_port: taskkill pid {pid_str} on port {port}");
                    let _ = std::process::Command::new("taskkill")
                        .args(["/PID", pid_str, "/F"])
                        .output();
                }
            }
        }
    }
}
