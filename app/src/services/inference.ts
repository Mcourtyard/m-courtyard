import { invoke } from "@tauri-apps/api/core";

export async function startInference(
  projectId: string,
  prompt: string,
  model: string,
  adapterPath?: string,
  maxTokens?: number,
  temperature?: number,
  lang?: string
): Promise<void> {
  return invoke("start_inference", {
    projectId,
    prompt,
    model,
    adapterPath: adapterPath || null,
    maxTokens: maxTokens || 512,
    temperature: temperature || 0.7,
    lang,
  });
}
