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
use tauri::Manager;

#[cfg(unix)]
use libc;

/// Holds the running sidecar Child so we can kill it on shutdown.
pub struct SidecarHandle(pub Mutex<Option<Child>>);

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

    cmd.spawn()
        .map_err(|e| format!("failed to spawn sidecar `{program}`: {e}"))
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
        }
    }
}
