use std::collections::HashMap;
use std::sync::Mutex;
use once_cell::sync::Lazy;
use tauri::Emitter;
use crate::python::PythonExecutor;
use crate::commands::config::{load_config, hf_endpoint_for_source};

static DOWNLOAD_PROCESSES: Lazy<Mutex<HashMap<String, u32>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[tauri::command]
pub async fn download_model(
    app: tauri::AppHandle,
    repo_id: String,
) -> Result<String, String> {
    let executor = PythonExecutor::default();

    if !executor.is_ready() {
        return Err("Python environment not ready. Please configure it in Settings.".into());
    }

    let scripts_dir = PythonExecutor::scripts_dir();
    let script = scripts_dir.join("download_model.py");
    if !script.exists() {
        return Err(format!("Download script not found: {}", script.display()));
    }

    let python_bin = executor.python_bin().clone();
    let repo_id_clone = repo_id.clone();

    // Read configured HF download source for HF_ENDPOINT env var
    let app_config = load_config();
    let hf_endpoint = hf_endpoint_for_source(&app_config.hf_source);

    // Optionally pass custom cache dir
    let cache_dir = app_config.model_paths.huggingface.clone();

    tokio::spawn(async move {
        let mut args = vec![
            script.to_string_lossy().to_string(),
            repo_id_clone.clone(),
        ];
        if let Some(ref dir) = cache_dir {
            args.push("--cache-dir".to_string());
            args.push(dir.clone());
        }

        let mut cmd = tokio::process::Command::new(&python_bin);
        cmd.args(&args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        // Set HF_ENDPOINT if user configured a mirror source
        if let Some(ref endpoint) = hf_endpoint {
            cmd.env("HF_ENDPOINT", endpoint);
        }

        let result = cmd.spawn();

        match result {
            Ok(mut child) => {
                if let Some(pid) = child.id() {
                    if let Ok(mut map) = DOWNLOAD_PROCESSES.lock() {
                        map.insert(repo_id_clone.clone(), pid);
                    }
                }

                use tokio::io::{AsyncBufReadExt, BufReader};

                let stdout = child.stdout.take();
                let stderr = child.stderr.take();

                let app_out = app.clone();
                let rid_out = repo_id_clone.clone();
                let stdout_task = tokio::spawn(async move {
                    if let Some(out) = stdout {
                        let mut lines = BufReader::new(out).lines();
                        while let Ok(Some(line)) = lines.next_line().await {
                            // Forward JSON events from Python script
                            let _ = app_out.emit("download-progress", serde_json::json!({
                                "repo_id": rid_out,
                                "raw": line,
                            }));
                        }
                    }
                });

                let app_err = app.clone();
                let rid_err = repo_id_clone.clone();
                let stderr_task = tokio::spawn(async move {
                    if let Some(err) = stderr {
                        let mut lines = BufReader::new(err).lines();
                        while let Ok(Some(line)) = lines.next_line().await {
                            // stderr often contains huggingface_hub progress bars
                            let _ = app_err.emit("download-log", serde_json::json!({
                                "repo_id": rid_err,
                                "line": line,
                            }));
                        }
                    }
                });

                let _ = stdout_task.await;
                let _ = stderr_task.await;

                let status = child.wait().await;
                if let Ok(mut map) = DOWNLOAD_PROCESSES.lock() {
                    map.remove(&repo_id_clone);
                }

                let exit_ok = status.map(|s| s.success()).unwrap_or(false);
                let _ = app.emit("download-finished", serde_json::json!({
                    "repo_id": repo_id_clone,
                    "success": exit_ok,
                }));
            }
            Err(e) => {
                let _ = app.emit("download-finished", serde_json::json!({
                    "repo_id": repo_id_clone,
                    "success": false,
                    "error": e.to_string(),
                }));
            }
        }
    });

    Ok(repo_id)
}

#[tauri::command]
pub fn stop_download(repo_id: String) -> Result<(), String> {
    if let Ok(map) = DOWNLOAD_PROCESSES.lock() {
        if let Some(&pid) = map.get(&repo_id) {
            unsafe {
                libc::kill(pid as i32, libc::SIGTERM);
            }
            return Ok(());
        }
    }
    Err("No active download found for this model".into())
}
