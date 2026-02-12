import { create } from "zustand";
import type { Project } from "@/types";
import * as projectService from "@/services/project";

const LAST_PROJECT_KEY = "courtyard_last_project_id";

interface ProjectState {
  projects: Project[];
  currentProject: Project | null;
  isLoading: boolean;
  error: string | null;

  fetchProjects: () => Promise<void>;
  createProject: (name: string) => Promise<Project>;
  deleteProject: (id: string) => Promise<void>;
  renameProject: (id: string, name: string) => Promise<void>;
  setCurrentProject: (project: Project | null) => void;
  ensureCurrentProject: () => void;
  clearError: () => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  currentProject: null,
  isLoading: false,
  error: null,

  fetchProjects: async () => {
    set({ isLoading: true, error: null });
    try {
      const projects = await projectService.listProjects();
      set({ projects, isLoading: false });
      // Auto-restore last project after fetch
      const { currentProject } = get();
      if (!currentProject && projects.length > 0) {
        const lastId = localStorage.getItem(LAST_PROJECT_KEY);
        const match = lastId ? projects.find((p) => p.id === lastId) : null;
        // Use last edited or fall back to first (most recent)
        const target = match || projects[0];
        set({ currentProject: target });
        localStorage.setItem(LAST_PROJECT_KEY, target.id);
      }
    } catch (err) {
      set({ error: String(err), isLoading: false });
    }
  },

  createProject: async (name: string) => {
    set({ isLoading: true, error: null });
    try {
      const project = await projectService.createProject({ name });
      set((state) => ({
        projects: [project, ...state.projects],
        isLoading: false,
      }));
      return project;
    } catch (err) {
      set({ error: String(err), isLoading: false });
      throw err;
    }
  },

  deleteProject: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await projectService.deleteProject(id);
      const { currentProject } = get();
      const newCurrent = currentProject?.id === id ? null : currentProject;
      set((state) => ({
        projects: state.projects.filter((p) => p.id !== id),
        currentProject: newCurrent,
        isLoading: false,
      }));
      if (!newCurrent) {
        localStorage.removeItem(LAST_PROJECT_KEY);
        // Auto-select next available
        const { projects: remaining } = get();
        if (remaining.length > 0) {
          set({ currentProject: remaining[0] });
          localStorage.setItem(LAST_PROJECT_KEY, remaining[0].id);
        }
      }
    } catch (err) {
      set({ error: String(err), isLoading: false });
    }
  },

  renameProject: async (id: string, name: string) => {
    try {
      await projectService.renameProject(id, name);
      set((state) => ({
        projects: state.projects.map((p) =>
          p.id === id ? { ...p, name } : p
        ),
        currentProject:
          state.currentProject?.id === id
            ? { ...state.currentProject, name }
            : state.currentProject,
      }));
    } catch (err) {
      set({ error: String(err) });
    }
  },

  setCurrentProject: (project) => {
    set({ currentProject: project });
    if (project) {
      localStorage.setItem(LAST_PROJECT_KEY, project.id);
    } else {
      localStorage.removeItem(LAST_PROJECT_KEY);
    }
  },

  // Ensure a project is selected (for quick actions from dashboard)
  ensureCurrentProject: () => {
    const { currentProject, projects } = get();
    if (currentProject) return;
    if (projects.length === 0) return;
    const lastId = localStorage.getItem(LAST_PROJECT_KEY);
    const match = lastId ? projects.find((p) => p.id === lastId) : null;
    const target = match || projects[0];
    set({ currentProject: target });
    localStorage.setItem(LAST_PROJECT_KEY, target.id);
  },

  clearError: () => set({ error: null }),
}));
