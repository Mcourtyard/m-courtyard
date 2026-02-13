use tauri::Emitter;
use crate::fs::ProjectDirManager;
use crate::python::PythonExecutor;
use std::sync::atomic::{AtomicU32, Ordering};

static GENERATION_PID: AtomicU32 = AtomicU32::new(0);

#[tauri::command]
pub async fn stop_generation() -> Result<(), String> {
    let pid = GENERATION_PID.swap(0, Ordering::SeqCst);
    if pid == 0 {
        return Err("No generation process running".into());
    }
    unsafe {
        // Kill the process group (negative PID) to stop both caffeinate and python
        libc::kill(-(pid as i32), libc::SIGTERM);
        // Also kill the direct process in case pgid differs
        libc::kill(pid as i32, libc::SIGTERM);
    }
    Ok(())
}

#[tauri::command]
pub async fn start_cleaning(
    app: tauri::AppHandle,
    project_id: String,
    lang: Option<String>,
) -> Result<(), String> {
    let executor = PythonExecutor::default();
    if !executor.is_ready() {
        return Err("Python environment is not ready. Please set up the environment first.".into());
    }

    let dir_manager = ProjectDirManager::new();
    let project_path = dir_manager.project_path(&project_id);

    if !project_path.join("raw").exists() {
        return Err("No raw data directory found. Import files first.".into());
    }

    let scripts_dir = PythonExecutor::scripts_dir();
    let script = scripts_dir.join("clean_data.py");
    if !script.exists() {
        return Err(format!("Cleaning script not found at: {}", script.display()));
    }

    let python_bin = executor.python_bin().clone();

    tokio::spawn(async move {
        // Wrap with caffeinate -i to prevent idle sleep during cleaning
        let result = tokio::process::Command::new("caffeinate")
            .args([
                "-i",
                &python_bin.to_string_lossy(),
                &script.to_string_lossy(),
                "--project-dir",
                &project_path.to_string_lossy(),
                "--lang",
                &lang.unwrap_or_else(|| "en".to_string()),
            ])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn();

        match result {
            Ok(mut child) => {
                use tokio::io::{AsyncBufReadExt, BufReader};

                if let Some(stdout) = child.stdout.take() {
                    let reader = BufReader::new(stdout);
                    let mut lines = reader.lines();
                    while let Ok(Some(line)) = lines.next_line().await {
                        // Parse JSON events from Python script
                        if let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) {
                            let event_type = event["type"].as_str().unwrap_or("unknown");
                            let _ = app.emit(&format!("cleaning:{}", event_type), &event);
                        } else {
                            let _ = app.emit("cleaning:log", serde_json::json!({ "line": line }));
                        }
                    }
                }

                match child.wait().await {
                    Ok(status) => {
                        if !status.success() {
                            let _ = app.emit("cleaning:error", serde_json::json!({
                                "message": "Cleaning process exited with error"
                            }));
                        }
                    }
                    Err(e) => {
                        let _ = app.emit("cleaning:error", serde_json::json!({
                            "message": e.to_string()
                        }));
                    }
                }
            }
            Err(e) => {
                let _ = app.emit("cleaning:error", serde_json::json!({
                    "message": e.to_string()
                }));
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn generate_dataset(
    app: tauri::AppHandle,
    project_id: String,
    model: String,
    mode: String,
    source: String,
    resume: Option<bool>,
    lang: Option<String>,
) -> Result<String, String> {
    let executor = PythonExecutor::default();
    if !executor.is_ready() {
        return Err("Python environment is not ready.".into());
    }

    let dir_manager = ProjectDirManager::new();
    let project_path = dir_manager.project_path(&project_id);

    let segments_path = project_path.join("cleaned").join("segments.jsonl");
    if !segments_path.exists() {
        return Err("No cleaned data found. Run cleaning first.".into());
    }

    let scripts_dir = PythonExecutor::scripts_dir();

    // Select script based on source
    let script_name = match source.as_str() {
        "ollama" => "generate_dataset_ollama.py",
        "builtin" => "generate_dataset_builtin.py",
        _ => "generate_dataset.py", // legacy mlx-lm fallback
    };
    let script = scripts_dir.join(script_name);
    if !script.exists() {
        return Err(format!("Dataset generation script not found: {}", script.display()));
    }

    let python_bin = executor.python_bin().clone();
    let should_resume = resume.unwrap_or(false);

    // Create timestamped output directory for this generation run
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let dataset_root = project_path.join("dataset");
    let output_dir = dataset_root.join(&timestamp);
    let _ = std::fs::create_dir_all(&output_dir);

    let ts_clone = timestamp.clone();

    tokio::spawn(async move {
        // Build args for the python command
        let mut py_args: Vec<String> = vec![
            script.to_string_lossy().to_string(),
            "--project-dir".to_string(),
            project_path.to_string_lossy().to_string(),
            "--output-dir".to_string(),
            output_dir.to_string_lossy().to_string(),
            "--mode".to_string(),
            mode,
        ];
        if source != "builtin" {
            py_args.push("--model".to_string());
            py_args.push(model);
        }
        if should_resume {
            py_args.push("--resume".to_string());
        }
        py_args.push("--lang".to_string());
        py_args.push(lang.unwrap_or_else(|| "en".to_string()));

        // Wrap with caffeinate -i to prevent idle sleep during generation
        let mut caffeinate_args: Vec<String> = vec![
            "-i".to_string(),
            python_bin.to_string_lossy().to_string(),
        ];
        caffeinate_args.extend(py_args);

        let result = tokio::process::Command::new("caffeinate")
            .args(&caffeinate_args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn();

        match result {
            Ok(mut child) => {
                // Store PID for stop_generation
                if let Some(pid) = child.id() {
                    GENERATION_PID.store(pid, Ordering::SeqCst);
                }

                use tokio::io::{AsyncBufReadExt, BufReader};

                if let Some(stdout) = child.stdout.take() {
                    let reader = BufReader::new(stdout);
                    let mut lines = reader.lines();
                    while let Ok(Some(line)) = lines.next_line().await {
                        if let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) {
                            let event_type = event["type"].as_str().unwrap_or("unknown");
                            let _ = app.emit(&format!("dataset:{}", event_type), &event);
                        } else {
                            let _ = app.emit("dataset:log", serde_json::json!({ "line": line }));
                        }
                    }
                }

                // Clear PID
                GENERATION_PID.store(0, Ordering::SeqCst);

                match child.wait().await {
                    Ok(status) => {
                        if status.success() {
                            // Rename directory to completion timestamp
                            let final_ts = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
                            let final_dir = dataset_root.join(&final_ts);
                            let version_id = if std::fs::rename(&output_dir, &final_dir).is_ok() {
                                final_ts
                            } else {
                                ts_clone.clone()
                            };
                            // Success: emit with version id
                            let _ = app.emit("dataset:version", serde_json::json!({
                                "version": version_id
                            }));
                        } else {
                            let code = status.code().unwrap_or(-1);
                            // Clean up incomplete directory on failure/stop
                            let _ = std::fs::remove_dir_all(&output_dir);
                            if code == 143 || code == -1 {
                                let _ = app.emit("dataset:stopped", serde_json::json!({
                                    "message": "Generation stopped, incomplete data cleaned up"
                                }));
                            } else {
                                let _ = app.emit("dataset:error", serde_json::json!({
                                    "message": format!("Generation exited with code {}", code)
                                }));
                            }
                        }
                    }
                    Err(e) => {
                        let _ = std::fs::remove_dir_all(&output_dir);
                        let _ = app.emit("dataset:error", serde_json::json!({
                            "message": e.to_string()
                        }));
                    }
                }
            }
            Err(e) => {
                let _ = std::fs::remove_dir_all(&output_dir);
                let _ = app.emit("dataset:error", serde_json::json!({
                    "message": e.to_string()
                }));
            }
        }
    });

    Ok(timestamp)
}

// Info about a single dataset version
#[derive(serde::Serialize, Clone)]
pub struct DatasetVersionInfo {
    pub version: String,       // timestamp string e.g. "20260211_103031"
    pub path: String,          // full path to the version directory
    pub train_count: usize,
    pub valid_count: usize,
    pub train_size: u64,       // bytes
    pub valid_size: u64,       // bytes
    pub created: String,       // human-readable date
}

/// List all dataset versions for a project, sorted newest first
#[tauri::command]
pub fn list_dataset_versions(
    project_id: String,
) -> Result<Vec<DatasetVersionInfo>, String> {
    let dir_manager = ProjectDirManager::new();
    let dataset_root = dir_manager.project_path(&project_id).join("dataset");

    if !dataset_root.exists() {
        return Ok(vec![]);
    }

    let mut versions: Vec<DatasetVersionInfo> = Vec::new();

    let entries = std::fs::read_dir(&dataset_root)
        .map_err(|e| format!("Failed to read dataset directory: {}", e))?;

    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_dir() { continue; }

        let dir_name = entry.file_name().to_string_lossy().to_string();
        let train_path = path.join("train.jsonl");
        let valid_path = path.join("valid.jsonl");

        // Skip directories without train.jsonl
        if !train_path.exists() { continue; }

        let train_count = count_jsonl_lines(&train_path);
        let valid_count = count_jsonl_lines(&valid_path);
        let train_size = std::fs::metadata(&train_path).map(|m| m.len()).unwrap_or(0);
        let valid_size = std::fs::metadata(&valid_path).map(|m| m.len()).unwrap_or(0);

        // Parse timestamp from directory name for display
        let created = parse_timestamp_display(&dir_name);

        versions.push(DatasetVersionInfo {
            version: dir_name,
            path: path.to_string_lossy().to_string(),
            train_count,
            valid_count,
            train_size,
            valid_size,
            created,
        });
    }

    // Also check for legacy flat dataset (train.jsonl directly in dataset/)
    let legacy_train = dataset_root.join("train.jsonl");
    if legacy_train.exists() {
        let legacy_valid = dataset_root.join("valid.jsonl");
        let train_count = count_jsonl_lines(&legacy_train);
        let valid_count = count_jsonl_lines(&legacy_valid);
        let train_size = std::fs::metadata(&legacy_train).map(|m| m.len()).unwrap_or(0);
        let valid_size = std::fs::metadata(&legacy_valid).map(|m| m.len()).unwrap_or(0);
        let created = std::fs::metadata(&legacy_train)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| {
                let dt = chrono::DateTime::from_timestamp(d.as_secs() as i64, 0).unwrap_or_default();
                let local: chrono::DateTime<chrono::Local> = dt.into();
                local.format("%Y-%m-%d %H:%M").to_string()
            })
            .unwrap_or_else(|| "legacy".to_string());

        versions.push(DatasetVersionInfo {
            version: "legacy".to_string(),
            path: dataset_root.to_string_lossy().to_string(),
            train_count,
            valid_count,
            train_size,
            valid_size,
            created,
        });
    }

    // Sort by version name descending (newest timestamp first)
    versions.sort_by(|a, b| b.version.cmp(&a.version));
    Ok(versions)
}

/// Open the dataset root directory in Finder
#[tauri::command]
pub fn open_dataset_folder(project_id: String) -> Result<(), String> {
    let dir_manager = ProjectDirManager::new();
    let dataset_root = dir_manager.project_path(&project_id).join("dataset");
    if !dataset_root.exists() {
        std::fs::create_dir_all(&dataset_root).map_err(|e| e.to_string())?;
    }
    std::process::Command::new("open")
        .arg(&dataset_root)
        .spawn()
        .map_err(|e| format!("Failed to open folder: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn get_dataset_preview(
    project_id: String,
    version: Option<String>,
) -> Result<Vec<serde_json::Value>, String> {
    let dir_manager = ProjectDirManager::new();
    let dataset_root = dir_manager.project_path(&project_id).join("dataset");

    // Determine train.jsonl path based on version
    let train_path = match version.as_deref() {
        Some("legacy") | None => {
            // Try legacy flat path first, then find latest versioned
            let legacy = dataset_root.join("train.jsonl");
            if legacy.exists() {
                legacy
            } else {
                // Find latest versioned dataset
                find_latest_train_path(&dataset_root)
                    .ok_or_else(|| "No dataset found".to_string())?
            }
        }
        Some(v) => dataset_root.join(v).join("train.jsonl"),
    };

    if !train_path.exists() {
        return Ok(vec![]);
    }

    let content = std::fs::read_to_string(&train_path)
        .map_err(|e| format!("Failed to read train.jsonl: {}", e))?;

    let mut items = Vec::new();
    for (i, line) in content.lines().enumerate() {
        if i >= 50 { break; }
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(line) {
            items.push(val);
        }
    }

    Ok(items)
}

fn count_jsonl_lines(path: &std::path::Path) -> usize {
    if !path.exists() { return 0; }
    std::fs::read_to_string(path)
        .map(|c| c.lines().filter(|l| !l.trim().is_empty()).count())
        .unwrap_or(0)
}

fn parse_timestamp_display(ts: &str) -> String {
    // Parse "20260211_103031" -> "2026-02-11 10:30"
    if ts.len() >= 15 {
        format!(
            "{}-{}-{} {}:{}",
            &ts[0..4], &ts[4..6], &ts[6..8], &ts[9..11], &ts[11..13]
        )
    } else {
        ts.to_string()
    }
}

fn find_latest_train_path(dataset_root: &std::path::Path) -> Option<std::path::PathBuf> {
    let mut dirs: Vec<_> = std::fs::read_dir(dataset_root).ok()?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir() && e.path().join("train.jsonl").exists())
        .collect();
    dirs.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
    dirs.first().map(|e| e.path().join("train.jsonl"))
}
