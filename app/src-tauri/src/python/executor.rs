use std::path::PathBuf;

pub struct PythonExecutor {
    python_path: PathBuf,
    base_dir: PathBuf,
}

impl PythonExecutor {
    pub fn python_bin(&self) -> &PathBuf {
        &self.python_path
    }

    pub fn venv_dir(&self) -> PathBuf {
        self.base_dir.join("python").join(".venv")
    }

    pub fn is_ready(&self) -> bool {
        self.python_path.exists()
    }

    /// Check if uv is available on the system
    pub fn find_uv() -> Option<PathBuf> {
        // Check common locations
        let candidates = vec![
            PathBuf::from("/usr/local/bin/uv"),
            PathBuf::from("/opt/homebrew/bin/uv"),
        ];
        for c in candidates {
            if c.exists() {
                return Some(c);
            }
        }
        // Check PATH via `which`
        if let Ok(output) = std::process::Command::new("which").arg("uv").output() {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() {
                    return Some(PathBuf::from(path));
                }
            }
        }
        None
    }

    /// Returns the path to bundled scripts directory
    pub fn scripts_dir() -> PathBuf {
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()));

        if let Some(dir) = exe_dir {
            let candidates = vec![
                // macOS app bundle: Contents/Resources/scripts (Tauri resources)
                dir.join("../Resources/scripts"),
                // Direct next to binary
                dir.join("scripts"),
                // Parent dirs (dev builds)
                dir.join("../scripts"),
                dir.join("../../scripts"),
            ];
            for c in candidates {
                if c.exists() {
                    return c.canonicalize().unwrap_or(c);
                }
            }
        }

        // Fallback: source tree scripts dir (works during development)
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        manifest_dir.join("scripts")
    }
}

impl Default for PythonExecutor {
    fn default() -> Self {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        let base_dir = home.join("Courtyard");
        let python_path = base_dir
            .join("python")
            .join(".venv")
            .join("bin")
            .join("python");
        Self { python_path, base_dir }
    }
}
