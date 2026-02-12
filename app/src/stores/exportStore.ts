import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

interface ExportEvent {
  project_id?: string;
  [key: string]: unknown;
}

interface ExportState {
  // Export process state (persists across page navigation)
  isExporting: boolean;
  result: string | null;
  exportLogs: string[];
  currentStep: string;
  exportProgress: string;
  modelName: string;
  outputDir: string;
  // Project isolation
  activeProjectId: string;

  // Actions
  startExport: (projectId: string) => void;
  setResult: (r: string | null) => void;
  addLog: (line: string) => void;
  setCurrentStep: (step: string) => void;
  setExportProgress: (desc: string) => void;
  setModelName: (name: string) => void;
  setOutputDir: (dir: string) => void;
  clearAll: () => void;

  // Listener management
  _listenersReady: boolean;
  _unlistens: UnlistenFn[];
  initListeners: () => void;
}

export const useExportStore = create<ExportState>((set, get) => ({
  isExporting: false,
  result: null,
  exportLogs: [],
  currentStep: "",
  exportProgress: "",
  modelName: "",
  outputDir: "",
  activeProjectId: "",

  startExport: (projectId: string) => set({
    isExporting: true, result: null, exportLogs: [], currentStep: "", exportProgress: "",
    activeProjectId: projectId,
  }),

  setResult: (r) => set({ result: r }),
  addLog: (line) => set((s) => ({ exportLogs: [...s.exportLogs, line] })),
  setCurrentStep: (step) => set({ currentStep: step }),
  setExportProgress: (desc) => set({ exportProgress: desc }),
  setModelName: (name) => set({ modelName: name }),
  setOutputDir: (dir) => set({ outputDir: dir }),

  clearAll: () => set({
    isExporting: false,
    result: null,
    exportLogs: [],
    currentStep: "",
    exportProgress: "",
    modelName: "",
    outputDir: "",
    activeProjectId: "",
  }),

  _listenersReady: false,
  _unlistens: [],

  initListeners: () => {
    if (get()._listenersReady) return;
    set({ _listenersReady: true });

    const unsubs: UnlistenFn[] = [];

    // Helper: only process events belonging to the active project
    const isMyProject = (payload: ExportEvent) => {
      const active = get().activeProjectId;
      if (!active) return true; // no active project yet, accept all
      return payload.project_id === active;
    };

    const setup = async () => {
      const u1 = await listen<ExportEvent & { step?: string; desc?: string }>("export:progress", (e) => {
        if (!isMyProject(e.payload)) return;
        const desc = e.payload.desc || "";
        const step = e.payload.step || "";
        if (desc) get().setExportProgress(desc as string);
        if (step) get().setCurrentStep(step as string);
        if (desc) {
          const ts = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
          get().addLog(`[${ts}] ${desc}`);
        }
      });
      unsubs.push(u1);

      const u2 = await listen<ExportEvent & { model_name?: string; output_dir?: string }>("export:complete", (e) => {
        if (!isMyProject(e.payload)) return;
        const name = (e.payload.model_name as string) || "";
        const dir = (e.payload.output_dir as string) || "";
        if (name) get().setModelName(name);
        if (dir) get().setOutputDir(dir);
        set({ isExporting: false, currentStep: "done", exportProgress: "" });
        set({ result: `__success__:${name}` });
        get().addLog(`--- Model '${name}' created`);
      });
      unsubs.push(u2);

      const u3 = await listen<ExportEvent & { message?: string }>("export:error", (e) => {
        if (!isMyProject(e.payload)) return;
        const msg = (e.payload.message as string) || "Export failed";
        set({ isExporting: false, currentStep: "", exportProgress: "" });
        set({ result: `Error: ${msg}` });
        get().addLog(`!!! Error: ${msg}`);
      });
      unsubs.push(u3);

      set({ _unlistens: unsubs });
    };
    setup();
  },
}));
