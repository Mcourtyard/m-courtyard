import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { useTrainingStore } from "./trainingStore";
import { useTaskStore } from "./taskStore";

export interface QueuedJob {
  id: string;
  projectId: string;
  projectName: string;
  params: string; // JSON stringified TrainingParams
  datasetPath: string;
  status: "queued" | "running" | "completed" | "failed";
  addedAt: number;
}

interface TrainingQueueState {
  queue: QueuedJob[];
  addToQueue: (job: Omit<QueuedJob, "id" | "status" | "addedAt">) => void;
  removeFromQueue: (id: string) => void;
  clearQueue: () => void;
  processNext: () => void;
  markCompleted: (id: string) => void;
  markFailed: (id: string) => void;
}

export const useTrainingQueueStore = create<TrainingQueueState>((set, get) => ({
  queue: [],

  addToQueue: (job) => {
    const id = `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    set((s) => ({
      queue: [...s.queue, { ...job, id, status: "queued", addedAt: Date.now() }],
    }));
  },

  removeFromQueue: (id) => {
    set((s) => ({
      queue: s.queue.filter((j) => j.id !== id),
    }));
  },

  clearQueue: () => {
    set((s) => ({
      queue: s.queue.filter((j) => j.status === "running"),
    }));
  },

  processNext: () => {
    const { queue } = get();
    const next = queue.find((j) => j.status === "queued");
    if (!next) return;

    const taskStore = useTaskStore.getState();
    const check = taskStore.canStart(next.projectId, "training");
    if (!check.allowed) return;
    if (!taskStore.acquireTask(next.projectId, next.projectName, "training")) return;

    // Mark as running
    set((s) => ({
      queue: s.queue.map((j) => j.id === next.id ? { ...j, status: "running" as const } : j),
    }));

    // Start training
    const trainingStore = useTrainingStore.getState();
    invoke<string>("start_training", {
      projectId: next.projectId,
      params: next.params,
      datasetPath: next.datasetPath,
    })
      .then((jobId) => {
        trainingStore.startTraining(jobId);
      })
      .catch((e) => {
        trainingStore.setStatus("failed");
        trainingStore.addLog(`Queue error: ${e}`);
        taskStore.releaseTask();
        get().markFailed(next.id);
        // Try next in queue
        setTimeout(() => get().processNext(), 500);
      });
  },

  markCompleted: (id) => {
    set((s) => ({
      queue: s.queue.map((j) => j.id === id ? { ...j, status: "completed" as const } : j),
    }));
    // Auto-process next queued job
    setTimeout(() => get().processNext(), 1000);
  },

  markFailed: (id) => {
    set((s) => ({
      queue: s.queue.map((j) => j.id === id ? { ...j, status: "failed" as const } : j),
    }));
    setTimeout(() => get().processNext(), 1000);
  },
}));
