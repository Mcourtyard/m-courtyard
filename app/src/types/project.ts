export type ProjectStatus =
  | "created"
  | "cleaning"
  | "generating"
  | "training"
  | "completed";

export interface Project {
  id: string;
  name: string;
  path: string;
  status: ProjectStatus;
  model_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateProjectInput {
  name: string;
}
