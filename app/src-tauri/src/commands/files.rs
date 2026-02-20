use serde::Serialize;
use std::fs;
use crate::fs::ProjectDirManager;

#[derive(Clone, Serialize)]
pub struct FileInfo {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
}

const SUPPORTED_EXTENSIONS: &[&str] = &["txt", "json", "jsonl", "md", "docx", "pdf"];

fn is_supported_file(path: &std::path::Path) -> bool {
    if let Some(ext) = path.extension() {
        let ext_lower = ext.to_string_lossy().to_lowercase();
        SUPPORTED_EXTENSIONS.contains(&ext_lower.as_str())
    } else {
        false
    }
}

fn collect_files_recursive(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                collect_files_recursive(&p, out);
            } else if p.is_file() && is_supported_file(&p) {
                out.push(p);
            }
        }
    }
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

    // Expand directories into individual files recursively
    let mut all_files: Vec<std::path::PathBuf> = Vec::new();
    for source in &source_paths {
        let src = std::path::Path::new(source);
        if !src.exists() {
            continue;
        }
        if src.is_dir() {
            collect_files_recursive(src, &mut all_files);
        } else if src.is_file() && is_supported_file(src) {
            all_files.push(src.to_path_buf());
        }
    }

    let mut imported = Vec::new();

    for src in &all_files {
        let file_name = src
            .file_name()
            .ok_or_else(|| "Invalid file name".to_string())?
            .to_string_lossy()
            .to_string();
        // Avoid overwriting: append _N if name already exists
        let mut dest = raw_dir.join(&file_name);
        if dest.exists() {
            let stem = src.file_stem().unwrap_or_default().to_string_lossy().to_string();
            let ext = src.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default();
            let mut counter = 1u32;
            loop {
                let new_name = if ext.is_empty() {
                    format!("{}_{}", stem, counter)
                } else {
                    format!("{}_{}.{}", stem, counter, ext)
                };
                dest = raw_dir.join(&new_name);
                if !dest.exists() { break; }
                counter += 1;
            }
        }
        fs::copy(src, &dest).map_err(|e| format!("Failed to copy {}: {}", file_name, e))?;

        let metadata = fs::metadata(&dest)
            .map_err(|e| format!("Failed to read metadata: {}", e))?;

        imported.push(FileInfo {
            name: dest.file_name().unwrap_or_default().to_string_lossy().to_string(),
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
