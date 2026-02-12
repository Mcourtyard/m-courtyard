import { create } from "zustand";

// Global task lock: prevents concurrent training/generation across projects
export type TaskType = "generating" | "training";

interface TaskState {
  // Active task info (null = idle)
  activeProjectId: string | null;
  activeTaskType: TaskType | null;
  activeProjectName: string | null;

  // Actions
  acquireTask: (projectId: string, projectName: string, taskType: TaskType) => boolean;
  releaseTask: () => void;
  isLocked: () => boolean;
  canStart: (projectId: string, taskType: TaskType) => { allowed: boolean; reason?: string };
}

export const useTaskStore = create<TaskState>((set, get) => ({
  activeProjectId: null,
  activeTaskType: null,
  activeProjectName: null,

  acquireTask: (projectId, projectName, taskType) => {
    const state = get();
    if (state.activeProjectId) {
      return false; // Already locked
    }
    set({
      activeProjectId: projectId,
      activeProjectName: projectName,
      activeTaskType: taskType,
    });
    return true;
  },

  releaseTask: () => {
    set({
      activeProjectId: null,
      activeProjectName: null,
      activeTaskType: null,
    });
  },

  isLocked: () => !!get().activeProjectId,

  canStart: (projectId, _taskType) => {
    const state = get();
    if (!state.activeProjectId) {
      return { allowed: true };
    }
    const runningLabel = state.activeTaskType === "generating" ? "datasetGenerating" : "modelTraining";
    // Same project, different task type → mutual exclusion
    if (state.activeProjectId === projectId) {
      return { allowed: false, reason: runningLabel };
    }
    // Different project → blocked
    return { allowed: false, reason: `otherProject:${state.activeProjectName}:${runningLabel}` };
  },
}));
