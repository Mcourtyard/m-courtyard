import { invoke } from "@tauri-apps/api/core";
import { getDb } from "./db";
import type { Project, CreateProjectInput } from "@/types";

export async function createProject(
  input: CreateProjectInput
): Promise<Project> {
  const project: Project = await invoke("create_project", { name: input.name });
  const db = await getDb();
  await db.execute(
    "INSERT INTO projects (id, name, path, status, model_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      project.id,
      project.name,
      project.path,
      project.status,
      project.model_path,
      project.created_at,
      project.updated_at,
    ]
  );
  return project;
}

export async function listProjects(): Promise<Project[]> {
  const db = await getDb();
  return db.select<Project[]>(
    "SELECT id, name, path, status, model_path, created_at, updated_at FROM projects ORDER BY created_at DESC"
  );
}

export async function deleteProject(id: string): Promise<void> {
  // Delete directory first, then DB record to avoid inconsistency if dir deletion fails
  await invoke("delete_project", { id });
  const db = await getDb();
  await db.execute("DELETE FROM projects WHERE id = ?", [id]);
}

export async function updateProjectStatus(
  id: string,
  status: string
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE projects SET status = ?, updated_at = datetime('now') WHERE id = ?",
    [status, id]
  );
}

export async function renameProject(
  id: string,
  name: string
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE projects SET name = ?, updated_at = datetime('now') WHERE id = ?",
    [name, id]
  );
}

export async function updateProjectModel(
  id: string,
  modelPath: string
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE projects SET model_path = ?, updated_at = datetime('now') WHERE id = ?",
    [modelPath, id]
  );
}
