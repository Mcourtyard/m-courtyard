use tauri::Emitter;
use crate::python::PythonExecutor;
use crate::fs::ProjectDirManager;
use crate::commands::config::load_config;

#[tauri::command]
pub async fn export_to_ollama(
    app: tauri::AppHandle,
    project_id: String,
    model_name: String,
    model: String,
    adapter_path: Option<String>,
    quantization: Option<String>,
) -> Result<(), String> {
    let executor = PythonExecutor::default();
    if !executor.is_ready() {
        return Err("Python environment is not ready.".into());
    }

    let scripts_dir = PythonExecutor::scripts_dir();
    let script = scripts_dir.join("export_ollama.py");
    if !script.exists() {
        return Err(format!("Export script not found at: {}", script.display()));
    }

    let dir_manager = ProjectDirManager::new();
    let project_path = dir_manager.project_path(&project_id);

    // Use provided adapter path or find latest
    let adapter_path = if let Some(ap) = adapter_path {
        if !std::path::Path::new(&ap).exists() {
            return Err(format!("Adapter path not found: {}", ap));
        }
        ap
    } else {
        let adapters_dir = project_path.join("adapters");
        std::fs::read_dir(&adapters_dir)
            .ok()
            .and_then(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
                    .max_by_key(|e| e.metadata().ok().and_then(|m| m.modified().ok()))
                    .map(|e| e.path().to_string_lossy().to_string())
            })
            .ok_or_else(|| "No trained adapter found. Complete training first.".to_string())?
    };

    // Use configured export path if set, otherwise default to project/export
    let app_config = load_config();
    let output_dir = if let Some(ref ep) = app_config.export_path {
        std::path::PathBuf::from(ep).join(&project_id)
    } else {
        project_path.join("export")
    };
    std::fs::create_dir_all(&output_dir)
        .map_err(|e| format!("Failed to create export dir: {}", e))?;

    let python_bin = executor.python_bin().clone();
    let quant = quantization.unwrap_or_else(|| "q4".to_string());

    let pid = project_id.clone();
    tokio::spawn(async move {
        let result = tokio::process::Command::new(&python_bin)
            .args([
                script.to_string_lossy().as_ref(),
                "--model",
                &model,
                "--adapter-path",
                &adapter_path,
                "--model-name",
                &model_name,
                "--output-dir",
                &output_dir.to_string_lossy(),
                "--quantization",
                &quant,
            ])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn();

        match result {
            Ok(mut child) => {
                use tokio::io::{AsyncBufReadExt, BufReader};

                // Collect stderr in background
                let stderr_handle = if let Some(stderr) = child.stderr.take() {
                    let handle = tokio::spawn(async move {
                        let reader = BufReader::new(stderr);
                        let mut lines = reader.lines();
                        let mut collected = Vec::new();
                        while let Ok(Some(line)) = lines.next_line().await {
                            collected.push(line);
                        }
                        collected
                    });
                    Some(handle)
                } else {
                    None
                };

                // Track whether the Python script already emitted an error event
                let mut python_emitted_error = false;

                if let Some(stdout) = child.stdout.take() {
                    let reader = BufReader::new(stdout);
                    let mut lines = reader.lines();
                    while let Ok(Some(line)) = lines.next_line().await {
                        if let Ok(mut event) = serde_json::from_str::<serde_json::Value>(&line) {
                            let event_type = event["type"].as_str().unwrap_or("unknown").to_string();
                            if event_type == "error" {
                                python_emitted_error = true;
                            }
                            // Inject project_id so frontend can filter per-project
                            if let Some(obj) = event.as_object_mut() {
                                obj.insert("project_id".to_string(), serde_json::Value::String(pid.clone()));
                            }
                            let _ = app.emit(&format!("export:{}", event_type), &event);
                        }
                    }
                }

                match child.wait().await {
                    Ok(status) => {
                        if !status.success() && !python_emitted_error {
                            // Only emit generic error if Python didn't already report a specific one
                            let stderr_text = if let Some(h) = stderr_handle {
                                h.await.unwrap_or_default().join("\n")
                            } else {
                                String::new()
                            };
                            let msg = if stderr_text.is_empty() {
                                "Export process failed (no details available)".to_string()
                            } else {
                                let lines: Vec<&str> = stderr_text.lines().collect();
                                let tail: Vec<&str> = lines.into_iter().rev().take(8).collect::<Vec<_>>().into_iter().rev().collect();
                                tail.join("\n")
                            };
                            let _ = app.emit("export:error", serde_json::json!({
                                "message": msg,
                                "project_id": pid
                            }));
                        }
                    }
                    Err(e) => {
                        let _ = app.emit("export:error", serde_json::json!({
                            "message": e.to_string(),
                            "project_id": pid
                        }));
                    }
                }
            }
            Err(e) => {
                let _ = app.emit("export:error", serde_json::json!({
                    "message": e.to_string(),
                    "project_id": pid
                }));
            }
        }
    });

    Ok(())
}
