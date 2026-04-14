import { describe, it, expect, vi, beforeEach } from "vitest";
import { useProjectStore } from "./projectStore";

vi.mock("@/services/project", () => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  renameProject: vi.fn(),
}));

describe("projectStore", () => {
  beforeEach(() => {
    useProjectStore.setState({
      projects: [],
      currentProject: null,
      isLoading: false,
      error: null,
    });
    vi.clearAllMocks();
  });

  it("should have initial state", () => {
    const state = useProjectStore.getState();
    expect(state.projects).toEqual([]);
    expect(state.currentProject).toBeNull();
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it("should set current project", () => {
    const project = { id: "1", name: "Test", path: "/test", status: "created" as const, model_path: null, created_at: "2024-01-01", updated_at: "2024-01-01" };
    const { setCurrentProject } = useProjectStore.getState();
    setCurrentProject(project);
    expect(useProjectStore.getState().currentProject).toEqual(project);
  });

  it("should clear error", () => {
    useProjectStore.setState({ error: "Some error" });
    const { clearError } = useProjectStore.getState();
    clearError();
    expect(useProjectStore.getState().error).toBeNull();
  });
});