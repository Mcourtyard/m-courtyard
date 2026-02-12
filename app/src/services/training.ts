import { invoke } from "@tauri-apps/api/core";
import { getDb } from "./db";

export interface TrainingParams {
  model: string;
  data: string;
  train_file: string;
  valid_file: string;
  adapter_path: string;
  iters: number;
  batch_size: number;
  lora_layers: number;
  lora_rank: number;
  learning_rate: number;
  seed: number;
}

export interface TrainingJob {
  id: string;
  project_id: string;
  params: string;
  status: string;
  final_loss: number | null;
  duration_s: number | null;
  started_at: string | null;
  completed_at: string | null;
}

export function defaultTrainingParams(): TrainingParams {
  return {
    model: "",
    data: "",
    train_file: "train.jsonl",
    valid_file: "valid.jsonl",
    adapter_path: "adapters",
    iters: 1000,
    batch_size: 4,
    lora_layers: 16,
    lora_rank: 8,
    learning_rate: 1e-5,
    seed: 0,
  };
}

export async function startTraining(
  projectId: string,
  params: TrainingParams
): Promise<string> {
  const jobId: string = await invoke("start_training", {
    projectId,
    params: JSON.stringify(params),
  });
  const db = await getDb();
  await db.execute(
    "INSERT INTO training_jobs (id, project_id, params, status, started_at) VALUES ($1, $2, $3, 'running', datetime('now'))",
    [jobId, projectId, JSON.stringify(params)]
  );
  return jobId;
}

export async function getTrainingJobs(
  projectId: string
): Promise<TrainingJob[]> {
  const db = await getDb();
  return db.select<TrainingJob[]>(
    "SELECT * FROM training_jobs WHERE project_id = $1 ORDER BY started_at DESC",
    [projectId]
  );
}
