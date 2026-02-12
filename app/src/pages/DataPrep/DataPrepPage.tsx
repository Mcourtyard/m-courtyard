import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { Upload, Trash2, Eye, ArrowRight, FolderOpen, Square, Sparkles, ChevronDown, ChevronRight, CheckCircle2, Circle, AlertTriangle, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useProjectStore } from "@/stores/projectStore";
import { useGenerationStore } from "@/stores/generationStore";
import { useTaskStore } from "@/stores/taskStore";
import { ModelSelector } from "@/components/ModelSelector";
import { StepProgress } from "@/components/StepProgress";

interface FileInfo {
  name: string;
  path: string;
  size_bytes: number;
}

interface DatasetVersionInfo {
  version: string;
  path: string;
  train_count: number;
  valid_count: number;
  train_size: number;
  valid_size: number;
  created: string;
}

export function DataPrepPage() {
  const { t } = useTranslation("dataPrep");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const { projects, fetchProjects, currentProject, setCurrentProject } =
    useProjectStore();
  const [rawFiles, setRawFiles] = useState<FileInfo[]>([]);
  const [_cleanedFiles, setCleanedFiles] = useState<FileInfo[]>([]);
  const [datasetVersions, setDatasetVersions] = useState<DatasetVersionInfo[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState("");
  const [importing, setImporting] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [_cleanProgress, setCleanProgress] = useState("");
  const {
    generating, genProgress, genStep, genTotal, genError, aiLogs,
    initListeners, setReloadFiles, clearLogs,
  } = useGenerationStore();
  const {
    formGenMode: genMode, formGenSource: genSource, formGenModel: genModel,
    setFormField,
  } = useGenerationStore();
  const setGenMode = (v: string) => setFormField("formGenMode", v);
  const setGenSource = (v: "ollama" | "builtin") => setFormField("formGenSource", v);
  const setGenModel = (v: string) => setFormField("formGenModel", v);
  const logEndRef = useRef<HTMLDivElement>(null);
  const logScrollRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pipelineStage, setPipelineStage] = useState<"idle" | "cleaning" | "generating">("idle");
  const autoGenAfterClean = useRef(false);
  const [deleteConfirm, setDeleteConfirm] = useState<FileInfo | null>(null);
  const [ollamaReady, setOllamaReady] = useState<boolean | null>(null); // null = checking

  // Show scrollbar on scroll, hide after 3 seconds of inactivity
  useEffect(() => {
    const el = logScrollRef.current;
    if (!el) return;
    const onScroll = () => {
      el.classList.add("is-scrolling");
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = setTimeout(() => {
        el.classList.remove("is-scrolling");
      }, 3000);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, []);

  const MODE_LABELS: Record<string, string> = {
    qa: t("generate.mode_qa"),
    style: t("generate.mode_style"),
    chat: t("generate.mode_chat"),
    instruct: t("generate.mode_instruct"),
  };


  // Check Ollama availability on mount
  useEffect(() => {
    invoke<{ installed: boolean; running: boolean }>("check_ollama_status")
      .then((status) => setOllamaReady(status.installed && status.running))
      .catch(() => setOllamaReady(false));
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    if (currentProject) {
      loadFiles();
    }
  }, [currentProject]);

  // Listen for cleaning events (local to this page)
  useEffect(() => {
    const unsubs: (() => void)[] = [];

    listen<{ desc?: string }>("cleaning:progress", (e) => {
      setCleanProgress(e.payload.desc || "");
    }).then((u) => unsubs.push(u));

    listen("cleaning:complete", () => {
      setCleaning(false);
      setCleanProgress("");
      reloadFiles();
      // Auto-start generation if in pipeline mode
      if (autoGenAfterClean.current) {
        autoGenAfterClean.current = false;
        setTimeout(() => startGenerationStep(), 300);
      }
    }).then((u) => unsubs.push(u));

    listen<{ message?: string }>("cleaning:error", (e) => {
      setCleaning(false);
      setPipelineStage("idle");
      setCleanProgress(e.payload.message || "Error");
      autoGenAfterClean.current = false;
    }).then((u) => unsubs.push(u));

    return () => { unsubs.forEach((u) => u()); };
  }, []);

  // Initialize global generation event listeners (idempotent - only runs once)
  useEffect(() => {
    initListeners();
  }, [initListeners]);

  // Pass reloadFiles to the generation store so it can refresh file list on complete/stop
  useEffect(() => {
    setReloadFiles(reloadFiles);
  }, [currentProject, setReloadFiles]);

  // Reset pipeline stage when generation finishes
  useEffect(() => {
    if (!generating && !cleaning) {
      setPipelineStage("idle");
    }
  }, [generating, cleaning]);

  const loadFiles = async () => {
    if (!currentProject) return;
    try {
      const raw: FileInfo[] = await invoke("list_project_files", {
        projectId: currentProject.id,
        subdir: "raw",
      });
      const cleaned: FileInfo[] = await invoke("list_project_files", {
        projectId: currentProject.id,
        subdir: "cleaned",
      });
      const versions: DatasetVersionInfo[] = await invoke("list_dataset_versions", {
        projectId: currentProject.id,
      });
      setRawFiles(raw);
      setCleanedFiles(cleaned);
      setDatasetVersions(versions);
    } catch (e) {
      console.error("Failed to load files:", e);
    }
  };


  const { canStart: taskCanStart, acquireTask } = useTaskStore();
  const taskCheck = currentProject ? taskCanStart(currentProject.id, "generating") : { allowed: true };

  // Parse task lock reason into i18n message
  const getTaskLockHint = (reason?: string): string => {
    if (!reason) return "";
    if (reason.startsWith("otherProject:")) {
      const parts = reason.split(":");
      const pName = parts[1] || "";
      const taskKey = parts[2] === "datasetGenerating" ? tc("taskLock.taskGenerating") : tc("taskLock.taskTraining");
      return tc("taskLock.otherProject", { name: pName, task: taskKey });
    }
    return tc(`taskLock.${reason}`);
  };

  // Start the generation pipeline: clean (if needed) → generate
  const handleStartPipeline = async () => {
    if (!currentProject) return;
    if (genSource === "ollama" && !genModel.trim()) return;
    // Check global task lock
    const check = taskCanStart(currentProject.id, "generating");
    if (!check.allowed) return;
    if (!acquireTask(currentProject.id, currentProject.name, "generating")) return;
    const store = useGenerationStore.getState();
    store.clearLogs();
    // Check if cleaning is needed
    const cleaned = await invoke<FileInfo[]>("list_project_files", {
      projectId: currentProject.id,
      subdir: "cleaned",
    }).catch(() => [] as FileInfo[]);
    if (cleaned.length === 0) {
      // Stage 1: Clean first, then auto-generate
      setPipelineStage("cleaning");
      setCleaning(true);
      setCleanProgress("Cleaning...");
      autoGenAfterClean.current = true;
      try {
        await invoke("start_cleaning", { projectId: currentProject.id });
      } catch (e) {
        setCleaning(false);
        setPipelineStage("idle");
        setCleanProgress(String(e));
        autoGenAfterClean.current = false;
      }
    } else {
      // Skip cleaning, go directly to generation
      startGenerationStep();
    }
  };

  const startGenerationStep = async () => {
    if (!currentProject) return;
    setPipelineStage("generating");
    // Clear displayed dataset versions (visual only, files untouched)
    setDatasetVersions([]);
    const store = useGenerationStore.getState();
    store.startGeneration();
    try {
      await invoke("generate_dataset", {
        projectId: currentProject.id,
        model: genSource === "ollama" ? genModel : "",
        mode: genMode,
        source: genSource,
        resume: false,
      });
    } catch (e) {
      useGenerationStore.setState({
        generating: false,
        genProgress: "",
        genError: String(e),
      });
      setPipelineStage("idle");
    }
  };

  const handleStop = async () => {
    try {
      await invoke("stop_generation");
    } catch (e) {
      console.error("Stop failed:", e);
    }
    setPipelineStage("idle");
  };


  // Reload files using the store's currentProject to avoid stale closures
  const reloadFiles = async () => {
    const proj = useProjectStore.getState().currentProject;
    if (!proj) return;
    try {
      const raw: FileInfo[] = await invoke("list_project_files", { projectId: proj.id, subdir: "raw" });
      const cleaned: FileInfo[] = await invoke("list_project_files", { projectId: proj.id, subdir: "cleaned" });
      const versions: DatasetVersionInfo[] = await invoke("list_dataset_versions", { projectId: proj.id });
      setRawFiles(raw);
      setCleanedFiles(cleaned);
      setDatasetVersions(versions);
    } catch (e) {
      console.error("Reload files failed:", e);
    }
  };

  const handleImport = async () => {
    if (!currentProject) return;
    setImporting(true);
    try {
      const selected = await dialogOpen({
        multiple: true,
        filters: [
          { name: "Text Files", extensions: ["txt", "json", "jsonl", "md", "docx", "pdf"] },
        ],
      });
      if (selected) {
        const paths = Array.isArray(selected) ? selected as string[] : [selected as string];
        await invoke("import_files", {
          projectId: currentProject.id,
          sourcePaths: paths,
        });
        await loadFiles();
      }
    } catch (e) {
      console.error("Import failed:", e);
    } finally {
      setImporting(false);
    }
  };

  const handleImportFolder = async () => {
    if (!currentProject) return;
    setImporting(true);
    try {
      const selected = await dialogOpen({
        directory: true,
      });
      if (selected) {
        const dir = selected as string;
        await invoke("import_files", {
          projectId: currentProject.id,
          sourcePaths: [dir],
        });
        await loadFiles();
      }
    } catch (e) {
      console.error("Import folder failed:", e);
    } finally {
      setImporting(false);
    }
  };

  const handlePreview = async (file: FileInfo) => {
    try {
      const content: string = await invoke("read_file_content", {
        path: file.path,
      });
      setPreview(content.slice(0, 5000));
      setPreviewName(file.name);
    } catch (e) {
      console.error("Preview failed:", e);
    }
  };

  const handleDeleteFile = async (file: FileInfo) => {
    try {
      await invoke("delete_file", { path: file.path });
      await loadFiles();
      if (previewName === file.name) {
        setPreview(null);
        setPreviewName("");
      }
    } catch (e) {
      console.error("Delete failed:", e);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (!currentProject) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("selectProject")}</p>
        <div className="space-y-2">
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => setCurrentProject(p)}
              className="flex w-full items-center gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:bg-accent/50"
            >
              <FolderOpen size={18} className="text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">{p.name}</span>
            </button>
          ))}
          {projects.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("files.emptyHint")}</p>
          )}
        </div>
      </div>
    );
  }

  // Collapsible step states
  const [step1Open, setStep1Open] = useState(true);
  const [step2Open, setStep2Open] = useState(true);
  const [step3Open, setStep3Open] = useState(true);

  const methodDone = genSource === "builtin" || (genSource === "ollama" && !!genModel);
  const typeDone = !!genMode;

  const dataPrepSubSteps = [
    { key: "add", label: t("step.add"), done: rawFiles.length > 0 },
    { key: "method", label: t("step.method"), done: methodDone },
    { key: "type", label: t("step.type"), done: typeDone },
    { key: "generating", label: t("step.generating"), done: false, active: pipelineStage === "generating" || generating || pipelineStage === "cleaning" },
    { key: "done", label: t("step.done"), done: datasetVersions.length > 0 && !generating },
  ].filter((s) => s.active || s.done || s.key !== "generating");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("pageTitle")}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {currentProject.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setRawFiles([]);
              setCleanedFiles([]);
              setDatasetVersions([]);
              setPreview(null);
              setPreviewName("");
              setGenModel("");
              setGenMode("");
              useGenerationStore.getState().resetForm();
              useGenerationStore.getState().resetGeneration();
            }}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent"
          >
            <Trash2 size={14} />
            {tc("clearAll")}
          </button>
          <button
            onClick={() => invoke("open_project_folder", { projectId: currentProject.id })}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent"
            title={tc("openFinderTitle")}
          >
            <FolderOpen size={14} />
            {tc("openFolder")}
          </button>
        </div>
      </div>

      {/* Unified Step Progress */}
      <StepProgress subSteps={dataPrepSubSteps} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* File Lists */}
        <div className="space-y-4">
          {/* 1.1 Select raw data files - collapsible card */}
          <div className="rounded-lg border border-border bg-card">
            <button
              onClick={() => setStep1Open(!step1Open)}
              className="flex w-full items-center justify-between p-4"
            >
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                {step1Open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="flex items-center gap-1.5">
                  {rawFiles.length > 0 ? <CheckCircle2 size={18} className="text-green-400 drop-shadow-[0_0_3px_rgba(74,222,128,0.4)]" /> : <Circle size={18} className="text-muted-foreground/30" />}
                  1.1 {t("section.selectFiles")} ({rawFiles.length})
                </span>
              </h3>
            </button>
            {step1Open && (
              <div className="border-t border-border p-4 space-y-3">
                {rawFiles.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border py-6 text-center">
                    <p className="mb-3 text-xs text-muted-foreground">{t("files.empty")}</p>
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={handleImport}
                        disabled={importing}
                        className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                      >
                        <Upload size={14} />
                        {t("import.button")}
                      </button>
                      <button
                        onClick={handleImportFolder}
                        disabled={importing}
                        className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
                      >
                        <FolderOpen size={14} />
                        {t("selectFolder")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {rawFiles.map((f) => (
                      <div
                        key={f.path}
                        className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                      >
                        <button
                          onClick={() => handlePreview(f)}
                          className="flex items-center gap-2 text-left text-sm text-foreground hover:text-primary"
                        >
                          <Eye size={14} className="text-muted-foreground" />
                          <span className="truncate max-w-48">{f.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {formatSize(f.size_bytes)}
                          </span>
                        </button>
                        <button
                          onClick={() => handleDeleteFile(f)}
                          className="p-1 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={handleImport}
                        disabled={importing}
                        className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
                      >
                        <Upload size={12} />
                        {t("addFile")}
                      </button>
                      <button
                        onClick={handleImportFolder}
                        disabled={importing}
                        className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
                      >
                        <FolderOpen size={12} />
                        {t("addFolder")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 1.2 Generation method + 1.3 Generation type + Generate - collapsible card */}
            <div className="rounded-lg border border-border bg-card">
              <button
                onClick={() => setStep2Open(!step2Open)}
                className="flex w-full items-center justify-between p-4"
              >
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  {step2Open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span className="flex items-center gap-1.5">
                    {methodDone ? <CheckCircle2 size={18} className="text-green-400 drop-shadow-[0_0_3px_rgba(74,222,128,0.4)]" /> : <Circle size={18} className="text-muted-foreground/30" />}
                    1.2 {t("section.genMethod")}
                  </span>
                </h3>
                {!step2Open && (
                  <span className="text-xs text-muted-foreground">
                    {genSource === "ollama" ? t("generate.source_ollama") : t("generate.source_builtin")}
                  </span>
                )}
              </button>
              {step2Open && (
                <div className="border-t border-border p-4 space-y-3">
                  <p className="text-xs text-muted-foreground">{t("generate.hint")}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setGenSource("ollama")}
                      disabled={generating}
                      className={`flex-1 rounded-md border px-2 py-2 text-xs font-medium transition-colors disabled:opacity-50 ${
                        genSource === "ollama"
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      {t("generate.source_ollama")}
                    </button>
                    <button
                      onClick={() => setGenSource("builtin")}
                      disabled={generating}
                      className={`flex-1 rounded-md border px-2 py-2 text-xs font-medium transition-colors disabled:opacity-50 ${
                        genSource === "builtin"
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      {t("generate.source_builtin")}
                    </button>
                  </div>

                  {genSource === "ollama" && (
                    <div className="space-y-2">
                      {ollamaReady === false ? (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-400">
                            <AlertTriangle size={14} className="shrink-0" />
                            <span>{t("generate.noOllama")}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">{t("generate.installOllamaHint")}</p>
                          <button
                            onClick={() => navigate("/settings")}
                            className="flex w-full items-center justify-center gap-2 rounded-md border border-border bg-accent/50 px-3 py-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                          >
                            <Settings size={14} />
                            {t("generate.envCheck")}
                          </button>
                        </div>
                      ) : (
                        <>
                          <p className="text-xs text-blue-400">{t("generate.ollamaHint")}</p>
                          {genModel && (
                            <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
                              <span className="font-medium text-foreground">{genModel}</span>
                            </div>
                          )}
                          <ModelSelector
                            mode="dataprep"
                            selectedModel={genModel}
                            onSelect={(modelId) => setGenModel(modelId)}
                            disabled={generating}
                            projectId={currentProject?.id}
                          />
                        </>
                      )}
                    </div>
                  )}
                  {genSource === "builtin" && (
                    <p className="text-xs text-amber-400">{t("generate.builtinHint")}</p>
                  )}

                  {/* 1.3 Generation type */}
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground pt-1">
                    <span className="flex items-center gap-1.5">
                      {typeDone ? <CheckCircle2 size={18} className="text-green-400 drop-shadow-[0_0_3px_rgba(74,222,128,0.4)]" /> : <Circle size={18} className="text-muted-foreground/30" />}
                      1.3 {t("section.genType")}
                    </span>
                  </h3>
                  <div className="flex gap-2">
                    {(["qa", "style", "chat", "instruct"] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setGenMode(m)}
                        disabled={generating}
                        className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                          genMode === m
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-border text-muted-foreground hover:bg-accent"
                        }`}
                      >
                        {MODE_LABELS[m]}
                      </button>
                    ))}
                  </div>
                  {genMode && (
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {t(`generate.mode_${genMode}_desc`)}
                    </p>
                  )}

                  {/* Generate / Stop Buttons */}
                  {generating || cleaning ? (
                    <button
                      onClick={handleStop}
                      disabled={cleaning}
                      className="flex w-full items-center justify-center gap-2 rounded-md bg-destructive px-3 py-2.5 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
                    >
                      <Square size={14} />
                      {cleaning ? t("generate.cleaningStatus") : t("generate.stopGeneration")}
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={handleStartPipeline}
                        disabled={!genMode || (genSource === "ollama" && !genModel.trim()) || rawFiles.length === 0 || !taskCheck.allowed}
                        className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                      >
                        <Sparkles size={14} />
                        {t("generate.button")}
                      </button>
                      {!taskCheck.allowed && (
                        <p className="text-xs text-amber-400">{getTaskLockHint(taskCheck.reason)}</p>
                      )}
                    </>
                  )}

                  {/* Progress Bar */}
                  {generating && genTotal > 0 && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{genProgress}</span>
                        <span>{Math.round((genStep / genTotal) * 100)}%</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-300"
                          style={{ width: `${Math.round((genStep / genTotal) * 100)}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t("generate.progressLabel", { step: genStep, total: genTotal, percent: Math.round((genStep / genTotal) * 100) })}
                      </p>
                    </div>
                  )}
                  {generating && genTotal === 0 && genProgress && (
                    <p className="text-xs text-muted-foreground">{genProgress}</p>
                  )}
                  {genError && (
                    <p className="text-xs text-red-400">{genError}</p>
                  )}
                </div>
              )}
            </div>

          {/* 1.4 Generated datasets - collapsible card */}
          <div className="rounded-lg border border-border bg-card">
            <button
              onClick={() => setStep3Open(!step3Open)}
              className="flex w-full items-center justify-between p-4"
            >
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                {step3Open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="flex items-center gap-1.5">
                  {datasetVersions.length > 0 ? <CheckCircle2 size={18} className="text-green-400 drop-shadow-[0_0_3px_rgba(74,222,128,0.4)]" /> : <Circle size={18} className="text-muted-foreground/30" />}
                  1.4 {t("section.datasets")} ({datasetVersions.length})
                </span>
              </h3>
              <button
                onClick={(e) => { e.stopPropagation(); invoke("open_dataset_folder", { projectId: currentProject?.id }); }}
                className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
              >
                <FolderOpen size={12} />
                {tc("openFolder")}
              </button>
            </button>
            {step3Open && (
              <div className="border-t border-border p-4">
                {datasetVersions.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border py-6 text-center">
                    <p className="text-xs text-muted-foreground">{t("dataset.noVersions")}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="space-y-1">
                      {datasetVersions.map((v) => (
                        <div
                          key={v.version}
                          className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs"
                        >
                          <CheckCircle2 size={14} className="shrink-0 text-green-400" />
                          <span className="shrink-0 whitespace-nowrap font-medium text-foreground">{v.version === "legacy" ? t("dataset.legacy") : v.created}</span>
                          <span className="shrink-0 whitespace-nowrap text-muted-foreground">train: {v.train_count}</span>
                          <span className="text-muted-foreground/40">·</span>
                          <span className="shrink-0 whitespace-nowrap text-muted-foreground">valid: {v.valid_count}</span>
                          <span className="ml-auto shrink-0 whitespace-nowrap text-muted-foreground/60">{formatSize(v.train_size + v.valid_size)}</span>
                        </div>
                      ))}
                    </div>
                    {/* Next Step: Go to Training */}
                    <button
                      onClick={() => navigate("/training")}
                      className="flex w-full items-center justify-center gap-2 rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2.5 text-sm font-medium text-green-400 transition-colors hover:bg-green-500/20"
                    >
                      {t("datasetReady")}
                      <ArrowRight size={14} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Preview Panel / AI Log Panel */}
        <div className="sticky top-4">
          <h3 className="mb-2 text-sm font-semibold text-foreground">
            {(generating || aiLogs.length > 0) ? (
              <>
                {t("aiLog")}
                {generating && <span className="ml-2 inline-block h-2 w-2 animate-pulse rounded-full bg-green-400" />}
              </>
            ) : (
              <>
                {t("preview.title")}
                {previewName && (
                  <span className="ml-2 font-normal text-muted-foreground">
                    — {previewName}
                  </span>
                )}
              </>
            )}
          </h3>
          <div ref={logScrollRef} className="log-scroll-container min-h-[600px] max-h-[calc(100vh-200px)] overflow-auto rounded-lg border border-border bg-card p-3">
            {(generating || aiLogs.length > 0) ? (
              <div className="space-y-0.5 font-mono text-xs leading-relaxed">
                {aiLogs.length === 0 && generating && (
                  <p className="text-muted-foreground">{t("connectingAI")}</p>
                )}
                {aiLogs.map((log, idx) => (
                  <p
                    key={idx}
                    className={`whitespace-pre-wrap ${
                      log.includes("✅") ? "text-green-400" :
                      log.includes("❌") ? "text-red-400" :
                      log.includes("⚠️") ? "text-yellow-400" :
                      log.includes("🤖") ? "text-blue-400" :
                      log.includes("📡") || log.includes("💾") ? "text-cyan-400" :
                      log.includes("──") || log.includes("══") ? "text-muted-foreground font-semibold" :
                      "text-foreground"
                    }`}
                  >
                    {log}
                  </p>
                ))}
                <div ref={logEndRef} />
                {!generating && aiLogs.length > 0 && (
                  <button
                    onClick={() => clearLogs()}
                    className="mt-2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {tc("clearLogs")}
                  </button>
                )}
              </div>
            ) : preview ? (
              <pre className="whitespace-pre-wrap text-xs text-foreground font-mono leading-relaxed">
                {preview}
              </pre>
            ) : (
              <p className="py-8 text-center text-xs text-muted-foreground">
                {t("preview.noContent")}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg">
            <h3 className="text-sm font-semibold text-foreground">{tc("confirmDeleteTitle")}</h3>
            <p className="mt-2 text-xs text-muted-foreground">
              {tc("confirmDeleteMsg", { name: deleteConfirm.name })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent"
              >
                {tc("cancel")}
              </button>
              <button
                onClick={async () => {
                  try {
                    await invoke("delete_file", { path: deleteConfirm.path });
                    reloadFiles();
                  } catch (e) {
                    console.error("Delete failed:", e);
                  }
                  setDeleteConfirm(null);
                }}
                className="rounded-md bg-destructive px-3 py-1.5 text-xs text-destructive-foreground transition-colors hover:bg-destructive/90"
              >
                {tc("confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
