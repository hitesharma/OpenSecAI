use std::fs;
use std::path::Path;

fn main() {
    // If in development mode (ENV=dev) and the sidecar executable is missing,
    // create a dummy file to satisfy Tauri's static resource checks.
    let env = std::env::var("ENV").unwrap_or_else(|_| "prod".into());
    if env == "dev" {
        let sidecar_path = Path::new("opensecai-api");
        if !sidecar_path.exists() {
            fs::write(sidecar_path, "").unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut perms = fs::metadata(sidecar_path).unwrap().permissions();
                perms.set_mode(0o755);
                fs::set_permissions(sidecar_path, perms).unwrap();
            }
        }
    }

    tauri_build::build();
}
