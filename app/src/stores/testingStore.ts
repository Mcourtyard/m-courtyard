import { create } from "zustand";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// Per-project state
interface ProjectTestingData {
  messages: ChatMessage[];
  selectedAdapter: string;
  modelId: string;
}

interface TestingState {
  // Current project context
  currentProjectId: string;
  // Per-project data store
  projectData: Record<string, ProjectTestingData>;

  // Derived getters (read from current project)
  messages: ChatMessage[];
  selectedAdapter: string;
  modelId: string;

  // Actions
  switchProject: (projectId: string) => void;
  addMessage: (msg: ChatMessage) => void;
  setMessages: (msgs: ChatMessage[]) => void;
  clearChat: () => void;
  setSelectedAdapter: (adapter: string) => void;
  setModelId: (id: string) => void;
  resetAll: () => void;
}

const emptyProjectData = (): ProjectTestingData => ({
  messages: [],
  selectedAdapter: "",
  modelId: "",
});

const getProjectData = (state: TestingState): ProjectTestingData =>
  state.projectData[state.currentProjectId] || emptyProjectData();

const updateProjectData = (
  state: TestingState,
  patch: Partial<ProjectTestingData>
) => {
  const pid = state.currentProjectId;
  const current = state.projectData[pid] || emptyProjectData();
  return {
    projectData: { ...state.projectData, [pid]: { ...current, ...patch } },
    ...patch,
  };
};

export const useTestingStore = create<TestingState>((set, get) => ({
  currentProjectId: "",
  projectData: {},
  messages: [],
  selectedAdapter: "",
  modelId: "",

  switchProject: (projectId) => {
    const data = get().projectData[projectId] || emptyProjectData();
    set({
      currentProjectId: projectId,
      messages: data.messages,
      selectedAdapter: data.selectedAdapter,
      modelId: data.modelId,
    });
  },

  addMessage: (msg) =>
    set((s) => {
      const msgs = [...getProjectData(s).messages, msg];
      return updateProjectData(s, { messages: msgs });
    }),

  setMessages: (msgs) => set((s) => updateProjectData(s, { messages: msgs })),

  clearChat: () => set((s) => updateProjectData(s, { messages: [] })),

  setSelectedAdapter: (adapter) =>
    set((s) => updateProjectData(s, { selectedAdapter: adapter })),

  setModelId: (id) => set((s) => updateProjectData(s, { modelId: id })),

  resetAll: () =>
    set((s) => updateProjectData(s, { messages: [], selectedAdapter: "", modelId: "" })),
}));
