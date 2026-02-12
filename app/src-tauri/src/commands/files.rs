use serde::Serialize;
use std::fs;
use crate::fs::ProjectDirManager;

#[derive(Clone, Serialize)]
pub struct FileInfo {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
}

#[tauri::command]
pub async fn import_files(
    project_id: String,
    source_paths: Vec<String>,
) -> Result<Vec<FileInfo>, String> {
    let dir_manager = ProjectDirManager::new();
    let raw_dir = dir_manager.project_path(&project_id).join("raw");
    fs::create_dir_all(&raw_dir)
        .map_err(|e| format!("Failed to create raw directory: {}", e))?;

    let mut imported = Vec::new();

    for source in &source_paths {
        let src = std::path::Path::new(source);
        if !src.exists() {
            continue;
        }
        let file_name = src
            .file_name()
            .ok_or_else(|| "Invalid file name".to_string())?
            .to_string_lossy()
            .to_string();
        let dest = raw_dir.join(&file_name);
        fs::copy(src, &dest).map_err(|e| format!("Failed to copy {}: {}", file_name, e))?;

        let metadata = fs::metadata(&dest)
            .map_err(|e| format!("Failed to read metadata: {}", e))?;

        imported.push(FileInfo {
            name: file_name,
            path: dest.to_string_lossy().to_string(),
            size_bytes: metadata.len(),
        });
    }

    Ok(imported)
}

#[tauri::command]
pub async fn list_project_files(
    project_id: String,
    subdir: String,
) -> Result<Vec<FileInfo>, String> {
    let dir_manager = ProjectDirManager::new();
    let target_dir = dir_manager.project_path(&project_id).join(&subdir);

    if !target_dir.exists() {
        return Ok(vec![]);
    }

    let mut files = Vec::new();
    let entries = fs::read_dir(&target_dir)
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let metadata = entry.metadata().map_err(|e| format!("Metadata error: {}", e))?;
        if metadata.is_file() {
            files.push(FileInfo {
                name: entry.file_name().to_string_lossy().to_string(),
                path: entry.path().to_string_lossy().to_string(),
                size_bytes: metadata.len(),
            });
        }
    }

    Ok(files)
}

#[tauri::command]
pub async fn read_file_content(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
pub async fn delete_file(path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| format!("Failed to delete file: {}", e))
}
