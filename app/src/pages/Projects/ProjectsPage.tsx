import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2, FolderOpen, AlertCircle, Pencil, Check, X, Loader2 } from "lucide-react";
import { useProjectStore } from "@/stores/projectStore";
import { useTaskStore } from "@/stores/taskStore";

export function ProjectsPage() {
  const { t } = useTranslation("project");
  const { projects, isLoading, error, fetchProjects, createProject, deleteProject, renameProject, setCurrentProject, currentProject, clearError } =
    useProjectStore();
  const { activeProjectId, activeTaskType } = useTaskStore();
  const navigate = useNavigate();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleCreate = async () => {
    if (!newProjectName.trim()) return;
    try {
      const project = await createProject(newProjectName.trim());
      setNewProjectName("");
      setShowCreateDialog(false);
      setCurrentProject(project);
      navigate("/data-prep");
    } catch {
      // Error is displayed via error state below
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleCreate();
    if (e.key === "Escape") setShowCreateDialog(false);
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmId) return;
    await deleteProject(deleteConfirmId);
    setDeleteConfirmId(null);
  };

  const handleRename = async (id: string) => {
    if (!renameValue.trim()) return;
    await renameProject(id, renameValue.trim());
    setRenamingId(null);
    setRenameValue("");
  };

  const startRename = (project: { id: string; name: string }) => {
    setRenamingId(project.id);
    setRenameValue(project.name);
  };

  return (
    <div className="space-y-6">
      {/* Header - only show create button when projects exist */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        {projects.length > 0 && (
          <button
            onClick={() => setShowCreateDialog(true)}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus size={16} />
            {t("create")}
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
          <AlertCircle size={16} className="text-red-400 shrink-0" />
          <p className="flex-1 text-sm text-red-400">{error}</p>
          <button onClick={clearError} className="text-xs text-red-400 hover:underline">
            {t("common:close")}
          </button>
        </div>
      )}

      {showCreateDialog && (
        <div className="rounded-lg border border-border p-4">
          <h3 className="mb-3 text-sm font-semibold text-foreground">
            {t("createTitle")}
          </h3>
          <div className="flex gap-3">
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("namePlaceholder")}
              autoFocus
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              onClick={handleCreate}
              disabled={!newProjectName.trim()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {t("create")}
            </button>
            <button
              onClick={() => setShowCreateDialog(false)}
              className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent"
            >
              {t("common:cancel")}
            </button>
          </div>
        </div>
      )}

      {isLoading && projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("common:loading")}</p>
      ) : projects.length === 0 ? (
        /* Empty state: large centered create button */
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-20">
          <FolderOpen size={56} className="text-muted-foreground/40" />
          <p className="mt-4 text-sm font-semibold text-muted-foreground">
            {t("empty")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            {t("emptyDescription")}
          </p>
          <button
            onClick={() => setShowCreateDialog(true)}
            className="mt-6 flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus size={18} />
            {t("create")}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {projects.map((project) => {
            const isCurrent = currentProject?.id === project.id;
            const isRenaming = renamingId === project.id;
            return (
              <div
                key={project.id}
                onClick={() => {
                  if (isRenaming) return;
                  setCurrentProject(project);
                  navigate("/data-prep");
                }}
                className={`flex cursor-pointer items-center justify-between rounded-lg border p-4 transition-colors ${
                  isCurrent
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-accent/50"
                }`}
              >
                <div className="flex items-center gap-3">
                  <FolderOpen size={20} className={isCurrent ? "text-primary" : "text-muted-foreground"} />
                  <div>
                    {isRenaming ? (
                      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleRename(project.id); if (e.key === "Escape") setRenamingId(null); }}
                          autoFocus
                          className="rounded border border-input bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                        <button onClick={() => handleRename(project.id)} className="rounded p-1 text-success hover:bg-success/10"><Check size={14} /></button>
                        <button onClick={() => setRenamingId(null)} className="rounded p-1 text-muted-foreground hover:bg-accent"><X size={14} /></button>
                      </div>
                    ) : (
                      <p className={`text-sm font-semibold ${isCurrent ? "text-primary" : "text-foreground"}`}>
                        {project.name}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {t(`status.${project.status}`)} · {project.created_at}
                    </p>
                    {activeProjectId === project.id && activeTaskType && (
                      <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-info/10 px-2 py-0.5 text-[10px] font-medium text-info ring-1 ring-info/20">
                        <Loader2 size={10} className="animate-spin" />
                        {t(`taskBadge.${activeTaskType}`)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => startRename(project)}
                    className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    title={t("rename", { ns: "common" })}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => setDeleteConfirmId(project.id)}
                    className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    title={t("delete", { ns: "common" })}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg">
            <h3 className="text-sm font-semibold text-foreground">{t("deleteConfirmTitle")}</h3>
            <p className="mt-2 text-xs text-muted-foreground">
              {t("deleteConfirmMsg", { name: projects.find(p => p.id === deleteConfirmId)?.name })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent"
              >
                {t("common:cancel")}
              </button>
              <button
                onClick={handleConfirmDelete}
                className="rounded-md bg-destructive px-3 py-1.5 text-xs text-destructive-foreground transition-colors hover:bg-destructive/90"
              >
                {t("deleteBtnConfirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
