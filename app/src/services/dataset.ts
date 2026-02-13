import { invoke } from "@tauri-apps/api/core";

export async function startCleaning(projectId: string, lang?: string): Promise<void> {
  return invoke("start_cleaning", { projectId, lang });
}

export async function generateDataset(
  projectId: string,
  model: string,
  mode: string,
  lang?: string
): Promise<void> {
  return invoke("generate_dataset", { projectId, model, mode, lang });
}

export async function getDatasetPreview(
  projectId: string
): Promise<Record<string, unknown>[]> {
  return invoke("get_dataset_preview", { projectId });
}
