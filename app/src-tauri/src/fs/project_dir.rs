use std::fs;
use std::path::PathBuf;

pub struct ProjectDirManager {
    base_dir: PathBuf,
}

impl ProjectDirManager {
    pub fn new() -> Self {
        let home = dirs_next().unwrap_or_else(|| PathBuf::from("."));
        let base_dir = home.join("Courtyard");
        Self { base_dir }
    }

    pub fn ensure_base_dirs(&self) -> Result<(), String> {
        let dirs = ["projects", "models", "python"];
        for dir in &dirs {
            let path = self.base_dir.join(dir);
            fs::create_dir_all(&path)
                .map_err(|e| format!("Failed to create directory {}: {}", path.display(), e))?;
        }
        Ok(())
    }

    pub fn create_project_dir(&self, project_id: &str) -> Result<PathBuf, String> {
        let project_path = self.base_dir.join("projects").join(project_id);
        let subdirs = ["raw", "cleaned", "dataset", "adapters", "logs"];
        for subdir in &subdirs {
            fs::create_dir_all(project_path.join(subdir))
                .map_err(|e| format!("Failed to create project subdir {}: {}", subdir, e))?;
        }
        Ok(project_path)
    }

    pub fn delete_project_dir(&self, project_id: &str) -> Result<(), String> {
        let project_path = self.base_dir.join("projects").join(project_id);
        if project_path.exists() {
            fs::remove_dir_all(&project_path)
                .map_err(|e| format!("Failed to delete project dir: {}", e))?;
        }
        Ok(())
    }

    pub fn project_path(&self, project_id: &str) -> PathBuf {
        self.base_dir.join("projects").join(project_id)
    }

}

fn dirs_next() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}
