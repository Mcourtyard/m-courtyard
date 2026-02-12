use serde::Serialize;
use uuid::Uuid;
use crate::fs::ProjectDirManager;

#[derive(Clone, Serialize)]
pub struct ProjectInfo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub status: String,
    pub model_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub async fn create_project(name: String) -> Result<ProjectInfo, String> {
    let id = Uuid::new_v4().to_string();
    let dir_manager = ProjectDirManager::new();
    dir_manager.ensure_base_dirs()?;
    let project_path = dir_manager.create_project_dir(&id)?;
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    Ok(ProjectInfo {
        id,
        name,
        path: project_path.to_string_lossy().to_string(),
        status: "created".to_string(),
        model_path: None,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub async fn list_projects() -> Result<Vec<ProjectInfo>, String> {
    // Frontend reads projects from SQLite directly via tauri-plugin-sql.
    // This command is kept for API completeness but not used by the UI.
    Ok(vec![])
}

#[tauri::command]
pub async fn delete_project(id: String) -> Result<(), String> {
    let dir_manager = ProjectDirManager::new();
    dir_manager.delete_project_dir(&id)?;
    Ok(())
}
