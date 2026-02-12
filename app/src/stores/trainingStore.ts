import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { defaultTrainingParams, type TrainingParams } from "@/services/training";
import { useTaskStore } from "./taskStore";

type TrainingStatus = "idle" | "running" | "completed" | "failed";

interface TrainingState {
  status: TrainingStatus;
  logs: string[];
  currentJobId: string | null;
  trainLossData: [number, number][];
  valLossData: [number, number][];
  currentIter: number;
  adapterPath: string | null;

  // Persisted training params (survive page navigation)
  params: TrainingParams;
  modelValid: boolean | null; // null = not checked, true/false = validation result

  // Actions
  startTraining: (jobId: string) => void;
  stopTraining: () => void;
  resetAll: () => void;
  resetParams: () => void;
  setStatus: (s: TrainingStatus) => void;
  addLog: (line: string) => void;
  setAdapterPath: (p: string) => void;
  updateParam: <K extends keyof TrainingParams>(key: K, value: TrainingParams[K]) => void;
  setModelValid: (v: boolean | null) => void;

  // Listener management
  _listenersReady: boolean;
  _unlistens: UnlistenFn[];
  initListeners: () => void;
}

export const useTrainingStore = create<TrainingState>((set, get) => ({
  status: "idle",
  logs: [],
  currentJobId: null,
  trainLossData: [],
  valLossData: [],
  currentIter: 0,
  adapterPath: null,
  params: defaultTrainingParams(),
  modelValid: null,

  _listenersReady: false,
  _unlistens: [],

  startTraining: (jobId: string) =>
    set({
      status: "running",
      logs: [],
      currentJobId: jobId,
      trainLossData: [],
      valLossData: [],
      currentIter: 0,
      adapterPath: null,
    }),

  stopTraining: () =>
    set((s) => ({
      status: "idle",
      currentJobId: null,
      logs: [...s.logs, "--- Training stopped by user ---"],
    })),

  resetAll: () =>
    set({
      status: "idle",
      logs: [],
      currentJobId: null,
      trainLossData: [],
      valLossData: [],
      currentIter: 0,
      adapterPath: null,
      params: defaultTrainingParams(),
      modelValid: null,
    }),

  resetParams: () =>
    set({ params: defaultTrainingParams(), modelValid: null }),

  setStatus: (s) => set({ status: s }),

  addLog: (line) =>
    set((s) => ({ logs: [...s.logs.slice(-1000), line] })),

  setAdapterPath: (p) => set({ adapterPath: p }),

  updateParam: (key, value) =>
    set((s) => ({ params: { ...s.params, [key]: value } })),

  setModelValid: (v) => set({ modelValid: v }),

  initListeners: async () => {
    if (get()._listenersReady) return;
    set({ _listenersReady: true });

    const unlistens: UnlistenFn[] = [];

    const u1 = await listen<{ job_id: string; line: string }>(
      "training-log",
      (event) => {
        const line = event.payload.line;
        get().addLog(line);

        // Parse training loss
        const trainMatch = line.match(/Iter\s+(\d+).*Train loss\s+([\d.]+)/i);
        if (trainMatch) {
          const iter = parseInt(trainMatch[1]);
          const loss = parseFloat(trainMatch[2]);
          set((s) => ({
            currentIter: iter,
            trainLossData: [...s.trainLossData, [iter, loss]],
          }));
        }

        // Parse validation loss
        const valMatch = line.match(/Iter\s+(\d+).*Val loss\s+([\d.]+)/i);
        if (valMatch) {
          const iter = parseInt(valMatch[1]);
          const loss = parseFloat(valMatch[2]);
          set((s) => ({
            valLossData: [...s.valLossData, [iter, loss]],
          }));
        }

        // Parse adapter save path (take first path before " and ", extract directory)
        const savedMatch = line.match(/Saved.*(?:adapter|weights).*to\s+(.+)/i);
        if (savedMatch) {
          let rawPath = savedMatch[1].trim();
          // If multiple paths joined by " and ", take the first one
          const andIdx = rawPath.indexOf(" and ");
          if (andIdx > 0) rawPath = rawPath.substring(0, andIdx).trim();
          // If it's a file path, extract the parent directory
          if (rawPath.match(/\.[a-z]+$/i)) {
            const lastSlash = rawPath.lastIndexOf("/");
            if (lastSlash > 0) rawPath = rawPath.substring(0, lastSlash);
          }
          if (rawPath) set({ adapterPath: rawPath });
        }
      }
    );
    unlistens.push(u1);

    const u2 = await listen<{ job_id: string; success: boolean }>(
      "training-complete",
      (event) => {
        set({ status: event.payload.success ? "completed" : "failed" });
        useTaskStore.getState().releaseTask();
      }
    );
    unlistens.push(u2);

    const u3 = await listen<{ job_id: string; error: string }>(
      "training-error",
      (event) => {
        set((s) => ({
          status: "failed" as TrainingStatus,
          logs: [...s.logs, `ERROR: ${event.payload.error}`],
        }));
        useTaskStore.getState().releaseTask();
      }
    );
    unlistens.push(u3);

    set({ _unlistens: unlistens });
  },
}));
