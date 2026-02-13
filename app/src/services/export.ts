import { invoke } from "@tauri-apps/api/core";

export async function exportToOllama(
  projectId: string,
  modelName: string,
  model: string,
  quantization?: string,
  lang?: string
): Promise<void> {
  return invoke("export_to_ollama", {
    projectId,
    modelName,
    model,
    quantization: quantization || "q4",
    lang,
  });
}
