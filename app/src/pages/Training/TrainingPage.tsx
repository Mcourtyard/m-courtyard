import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Play, Square, Zap, BarChart3, FileText, FolderOpen, Copy, Check, ArrowRight, Trash2, ChevronDown, ChevronRight, X, CheckCircle2, Circle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useProjectStore } from "@/stores/projectStore";
import { useTrainingStore } from "@/stores/trainingStore";
import { useTaskStore } from "@/stores/taskStore";
import { type TrainingParams } from "@/services/training";
import { ModelSelector } from "@/components/ModelSelector";
import { StepProgress } from "@/components/StepProgress";

function LossChart({ trainLoss, valLoss, totalIters }: {
  trainLoss: [number, number][];
  valLoss: [number, number][];
  totalIters: number;
}) {
  if (trainLoss.length < 2 && valLoss.length < 2) {
    return (
      <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
        {"Waiting for data..."}
      </div>
    );
  }
  const W = 480, H = 260;
  const P = { t: 30, r: 20, b: 28, l: 52 };
  const plotW = W - P.l - P.r;
  const plotH = H - P.t - P.b;
  const allPts = [...trainLoss, ...valLoss];
  const maxIter = Math.max(totalIters, ...allPts.map((p) => p[0]));
  const losses = allPts.map((p) => p[1]);
  const maxL = Math.max(...losses) * 1.05;
  const minL = Math.min(...losses) * 0.95;
  const range = maxL - minL || 1;
  const sx = (i: number) => P.l + (i / (maxIter || 1)) * plotW;
  const sy = (l: number) => P.t + ((maxL - l) / range) * plotH;
  const toPath = (pts: [number, number][]) => pts.map(([i, l]) => `${sx(i)},${sy(l)}`).join(" ");
  const yTicks = Array.from({ length: 5 }, (_, i) => minL + (range * i) / 4);
  // X-axis ticks (5 evenly spaced)
  const xTicks = Array.from({ length: 5 }, (_, i) => Math.round((maxIter * (i + 1)) / 5));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      {/* Legend - positioned above plot, right-aligned */}
      <g>
        <rect x={W - P.r - 155} y={4} width="8" height="8" fill="#3b82f6" rx="1" />
        <text x={W - P.r - 143} y={11} fill="currentColor" fillOpacity="0.6" fontSize="9">Train Loss</text>
        <rect x={W - P.r - 70} y={4} width="8" height="8" fill="#f59e0b" rx="1" />
        <text x={W - P.r - 58} y={11} fill="currentColor" fillOpacity="0.6" fontSize="9">Val Loss</text>
      </g>
      {/* Plot border */}
      <rect x={P.l} y={P.t} width={plotW} height={plotH} fill="none" stroke="currentColor" strokeOpacity="0.08" />
      {/* Y-axis grid lines and labels */}
      {yTicks.map((v, i) => (
        <g key={`y${i}`}>
          <line x1={P.l} y1={sy(v)} x2={W - P.r} y2={sy(v)} stroke="currentColor" strokeOpacity="0.08" strokeDasharray="2 3" />
          <text x={P.l - 6} y={sy(v) + 3} textAnchor="end" fill="currentColor" fillOpacity="0.45" fontSize="9">{v.toFixed(2)}</text>
        </g>
      ))}
      {/* X-axis labels */}
      {xTicks.map((v, i) => (
        <g key={`x${i}`}>
          <line x1={sx(v)} y1={P.t} x2={sx(v)} y2={P.t + plotH} stroke="currentColor" strokeOpacity="0.05" />
          <text x={sx(v)} y={P.t + plotH + 14} textAnchor="middle" fill="currentColor" fillOpacity="0.4" fontSize="9">{v}</text>
        </g>
      ))}
      {/* Data lines */}
      {trainLoss.length > 1 && <polyline points={toPath(trainLoss)} fill="none" stroke="#3b82f6" strokeWidth="1.8" strokeLinejoin="round" />}
      {valLoss.length > 1 && <polyline points={toPath(valLoss)} fill="none" stroke="#f59e0b" strokeWidth="1.8" strokeDasharray="5 3" strokeLinejoin="round" />}
      {/* Data points */}
      {trainLoss.map(([i, l], idx) => (
        <circle key={`t${idx}`} cx={sx(i)} cy={sy(l)} r="2.5" fill="#3b82f6" />
      ))}
      {valLoss.map(([i, l], idx) => (
        <circle key={`v${idx}`} cx={sx(i)} cy={sy(l)} r="2.5" fill="#f59e0b" />
      ))}
    </svg>
  );
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

export function TrainingPage() {
  const { t } = useTranslation("training");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const { currentProject } =
    useProjectStore();
  const {
    status, logs, currentJobId, trainLossData, valLossData, currentIter,
    adapterPath, startTraining, stopTraining: storeStopTraining, resetAll,
    initListeners, params, modelValid, updateParam, setModelValid, resetParams,
  } = useTrainingStore();

  const logRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [datasetVersions, setDatasetVersions] = useState<DatasetVersionInfo[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<string>("");
  const [datasetDropdownOpen, setDatasetDropdownOpen] = useState(false);

  // Collapsible step states
  const [step1Open, setStep1Open] = useState(true);
  const [step2Open, setStep2Open] = useState(true);
  const [step3Open, setStep3Open] = useState(true);
  const [paramsEdited, setParamsEdited] = useState(false);

  // Can start training? Model must be set and valid (or not a local path)
  const canStartTraining = !!(params.model && (modelValid !== false));

  // Auto-collapse steps when training starts, expand when idle
  useEffect(() => {
    if (status === "running") {
      setStep1Open(false);
      setStep2Open(false);
      setStep3Open(false);
    }
  }, [status]);

  // Handle model selection from ModelSelector
  const handleModelSelect = (modelId: string, isLocalPath?: boolean) => {
    updateParam("model", modelId);
    if (isLocalPath) {
      invoke<boolean>("validate_model_path", { path: modelId })
        .then((valid) => setModelValid(valid))
        .catch(() => setModelValid(false));
    } else {
      setModelValid(null);
    }
  };

  // Load dataset versions from backend
  const loadDatasetVersions = async () => {
    if (!currentProject) return;
    try {
      const versions = await invoke<DatasetVersionInfo[]>(
        "list_dataset_versions", { projectId: currentProject.id }
      );
      setDatasetVersions(versions);
      // Auto-select latest (first) version if none selected or current selection no longer exists
      if (versions.length > 0) {
        const currentStillExists = selectedVersion && versions.some((v) => v.version === selectedVersion);
        if (!currentStillExists) {
          setSelectedVersion(versions[0].version);
        }
      } else {
        setSelectedVersion("");
      }
    } catch {
      setDatasetVersions([]);
      setSelectedVersion("");
    }
  };

  const selectedDataset = datasetVersions.find((v) => v.version === selectedVersion) || null;

  useEffect(() => {
    initListeners();
  }, [initListeners]);

  useEffect(() => {
    if (currentProject) loadDatasetVersions();
  }, [currentProject]);

  // Auto scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  const applyPreset = (preset: "quick" | "standard" | "thorough") => {
    const presets: Record<string, Partial<TrainingParams>> = {
      quick: { iters: 100, batch_size: 4, lora_layers: 8, lora_rank: 8, learning_rate: 1e-5 },
      standard: { iters: 1000, batch_size: 4, lora_layers: 16, lora_rank: 8, learning_rate: 1e-5 },
      thorough: { iters: 2000, batch_size: 4, lora_layers: 16, lora_rank: 16, learning_rate: 5e-6 },
    };
    const p = presets[preset];
    for (const [k, v] of Object.entries(p)) {
      updateParam(k as keyof TrainingParams, v as any);
    }
    setParamsEdited(true);
  };

  const paramsDone = (!!params.model && !!selectedDataset) || paramsEdited;

  const { canStart: taskCanStart, acquireTask } = useTaskStore();
  const taskCheck = currentProject ? taskCanStart(currentProject.id, "training") : { allowed: true };

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

  const handleStart = async () => {
    if (!currentProject || !params.model) return;
    // Check global task lock
    const check = taskCanStart(currentProject.id, "training");
    if (!check.allowed) return;
    if (!acquireTask(currentProject.id, currentProject.name, "training")) return;
    try {
      const jobId = await invoke<string>("start_training", {
        projectId: currentProject.id,
        params: JSON.stringify(params),
        datasetPath: selectedDataset?.path || "",
      });
      startTraining(jobId);
    } catch (e) {
      useTrainingStore.getState().setStatus("failed");
      useTrainingStore.getState().addLog(`Error: ${e}`);
      useTaskStore.getState().releaseTask();
    }
  };

  const handleStop = async () => {
    if (!currentJobId) return;
    try {
      await invoke("stop_training", { jobId: currentJobId });
      storeStopTraining();
      useTaskStore.getState().releaseTask();
    } catch (e) {
      useTrainingStore.getState().addLog(`Stop error: ${e}`);
    }
  };


  const trainingSubSteps = [
    { key: "model", label: t("step.model"), done: !!params.model },
    { key: "data", label: t("step.data"), done: !!selectedDataset },
    { key: "train", label: t("step.train"), done: status === "completed", active: status === "running" },
    { key: "done", label: t("step.done"), done: status === "completed" },
  ];

  if (!currentProject) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-foreground">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{tc("selectProjectHint")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ===== Header ===== */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("pageTitle")}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {currentProject.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { resetAll(); resetParams(); setParamsEdited(false); updateParam("model", ""); setModelValid(null); }} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent">
            <Trash2 size={14} />
            {tc("clearAll")}
          </button>
        </div>
      </div>

      {/* Unified Step Progress */}
      <StepProgress subSteps={trainingSubSteps} />

      {/* Completed Banner */}
      {status === "completed" && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4 space-y-3">
          <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
            <Check size={16} />
            {t("completedBanner")}
          </div>
          {adapterPath && (
            <p className="text-xs text-muted-foreground">
              {t("savedAt")}<span className="font-mono text-foreground">{adapterPath}</span>
            </p>
          )}
          <div className="flex gap-2">
            {adapterPath && (
              <button onClick={() => invoke("open_adapter_folder", { adapterPath })} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent">
                <FolderOpen size={12} />
                {tc("openModelFolder")}
              </button>
            )}
            <button onClick={() => navigate("/testing")} className="flex items-center gap-1.5 rounded-md border border-green-500/30 bg-green-500/20 px-3 py-1.5 text-xs text-green-400 transition-colors hover:bg-green-500/30">
              {t("goToTest")}
              <ArrowRight size={12} />
            </button>
          </div>
        </div>
      )}

      {/* ===== Step 1: Select Model (collapsible) ===== */}
      <div className="rounded-lg border border-border bg-card">
        <button
          onClick={() => setStep1Open(!step1Open)}
          className="flex w-full items-center justify-between p-4"
        >
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            {step1Open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="flex items-center gap-1.5">
              {params.model ? <CheckCircle2 size={18} className="text-green-400 drop-shadow-[0_0_3px_rgba(74,222,128,0.4)]" /> : <Circle size={18} className="text-muted-foreground/30" />}
              2.1 {t("section.selectModel")}
            </span>
          </h3>
          {/* Show selected model summary when collapsed */}
          {!step1Open && params.model && (
            <span className="truncate max-w-xs text-xs text-primary">{params.model}</span>
          )}
        </button>
        {step1Open && (
          <div className="border-t border-border p-4 space-y-3">
            {/* Selected Model Display */}
            {params.model ? (
              <div className={`flex items-center justify-between rounded-md border px-3 py-2 ${
                modelValid === false ? "border-red-500/30 bg-red-500/5" : "border-primary/30 bg-primary/5"
              }`}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{params.model}</p>
                  <p className="text-xs text-muted-foreground/70">
                    {params.model.startsWith("/") || params.model.startsWith("~")
                      ? (modelValid === false ? `⚠️ ${t("invalidModelPath")}` : t("localModelPath"))
                      : t("hfModelHint")}
                  </p>
                </div>
                {status !== "running" && (
                  <button onClick={() => { updateParam("model", ""); setModelValid(null); }} className="ml-2 shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" title="Clear selection">
                    <X size={14} />
                  </button>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/70">{t("selectModelHint")}</p>
            )}

            {/* Unified Model Selector */}
            {status !== "running" && (
              <ModelSelector
                mode="training"
                selectedModel={params.model}
                onSelect={handleModelSelect}
                projectId={currentProject.id}
              />
            )}
          </div>
        )}
      </div>

      {/* ===== Step 2: Dataset (collapsible) ===== */}
      <div className="rounded-lg border border-border bg-card">
        <button
          onClick={() => setStep2Open(!step2Open)}
          className="flex w-full items-center justify-between p-4"
        >
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            {step2Open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="flex items-center gap-1.5">
              {selectedDataset ? <CheckCircle2 size={18} className="text-green-400 drop-shadow-[0_0_3px_rgba(74,222,128,0.4)]" /> : <Circle size={18} className="text-muted-foreground/30" />}
              2.2 {t("section.selectDataset")}
            </span>
          </h3>
          {selectedDataset && (
            <button
              onClick={(e) => { e.stopPropagation(); invoke("open_dataset_folder", { projectId: currentProject.id }); }}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
              <FolderOpen size={10} />
              {tc("openFolder")}
            </button>
          )}
        </button>
        {step2Open && (
          <div className="border-t border-border p-4 space-y-2">
            {datasetVersions.length > 0 ? (
              <div className="relative">
                {/* Collapsed: show selected dataset */}
                <button
                  onClick={() => setDatasetDropdownOpen(!datasetDropdownOpen)}
                  disabled={status === "running"}
                  className="flex w-full items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-left text-xs transition-colors hover:bg-accent disabled:opacity-50"
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-primary"><span className="h-2 w-2 rounded-full bg-primary" /></span>
                  <div className="min-w-0 flex-1">
                    {selectedDataset ? (
                      <>
                        <span className="font-medium text-foreground">{selectedDataset.version === "legacy" ? t("datasetLegacy") : selectedDataset.created}</span>
                        <span className="ml-2 text-muted-foreground/60">train: {selectedDataset.train_count}</span>
                        <span className="ml-1 text-muted-foreground/40">\u00b7 valid: {selectedDataset.valid_count}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">{t("selectDatasetVersion")}</span>
                    )}
                  </div>
                  <ChevronDown size={14} className={`shrink-0 text-muted-foreground transition-transform ${datasetDropdownOpen ? "rotate-180" : ""}`} />
                </button>

                {/* Expanded: all options */}
                {datasetDropdownOpen && (
                  <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border bg-background p-2 shadow-lg">
                    {datasetVersions.map((v) => {
                      const isSelected = selectedVersion === v.version;
                      return (
                        <button
                          key={v.version}
                          onClick={() => { setSelectedVersion(v.version); setDatasetDropdownOpen(false); }}
                          className={`flex w-full items-center gap-2 rounded-md border px-3 py-1.5 text-left text-xs transition-colors ${
                            isSelected
                              ? "border-primary bg-primary/10 text-foreground"
                              : "border-border text-muted-foreground hover:bg-accent"
                          }`}
                        >
                          {isSelected ? <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-primary"><span className="h-2 w-2 rounded-full bg-primary" /></span> : <span className="h-4 w-4 shrink-0 rounded-full border-2 border-muted-foreground/30" />}
                          <div className="min-w-0 flex-1">
                            <span className="font-medium text-foreground">{v.version === "legacy" ? t("datasetLegacy") : v.created}</span>
                            <span className="ml-2 text-muted-foreground/60">train: {v.train_count}</span>
                            <span className="ml-1 text-muted-foreground/40">\u00b7 valid: {v.valid_count}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/70">{t("noDataset")}</p>
            )}
          </div>
        )}
      </div>

      {/* ===== Step 3: Training Parameters (collapsible) ===== */}
      <div className="rounded-lg border border-border bg-card">
        <button
          onClick={() => setStep3Open(!step3Open)}
          className="flex w-full items-center justify-between p-4"
        >
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            {step3Open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="flex items-center gap-1.5">
              {paramsDone ? <CheckCircle2 size={18} className="text-green-400 drop-shadow-[0_0_3px_rgba(74,222,128,0.4)]" /> : <Circle size={18} className="text-muted-foreground/30" />}
              2.3 {t("section.params")}
            </span>
          </h3>
          {!step3Open && (
            <span className="text-xs text-muted-foreground">
              {t("paramsSummary", { iters: params.iters, batch: params.batch_size, layers: params.lora_layers, rank: params.lora_rank })}
            </span>
          )}
        </button>
        {step3Open && (
          <div className="border-t border-border p-4 space-y-4">
            {/* Presets */}
            <div className="flex gap-2">
              {(["quick", "standard", "thorough"] as const).map((preset) => (
                <button key={preset} onClick={() => applyPreset(preset)} disabled={status === "running"}
                  className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50">
                  <Zap size={12} />
                  {t(`presets.${preset}`)}
                </button>
              ))}
            </div>

            {/* Params Grid */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              {([
                ["iters", params.iters, "number"],
                ["batchSize", params.batch_size, "number"],
                ["loraLayers", params.lora_layers, "number"],
                ["loraRank", params.lora_rank, "number"],
                ["learningRate", params.learning_rate, "text"],
                ["seed", params.seed, "number"],
              ] as const).map(([key, value, type]) => {
                const paramKey = key === "batchSize" ? "batch_size"
                  : key === "loraLayers" ? "lora_layers"
                  : key === "loraRank" ? "lora_rank"
                  : key === "learningRate" ? "learning_rate"
                  : key;
                return (
                  <div key={key}>
                    <label className="mb-1 block text-xs font-medium text-foreground">{t(`params.${key}`)}</label>
                    <input
                      type={type} value={value}
                      onChange={(e) => { updateParam(paramKey as keyof TrainingParams, type === "number" ? Number(e.target.value) : e.target.value as any); setParamsEdited(true); }}
                      disabled={status === "running"}
                      className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                    />
                    <p className="mt-0.5 text-xs text-muted-foreground/70">{t(`params.${key}Hint`)}</p>
                  </div>
                );
              })}
            </div>

            {status !== "running" && (
              <button onClick={resetParams}
                className="flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent">
                <Trash2 size={12} />
                {tc("resetDefaults")}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ===== Start / Stop Button (always visible) ===== */}
      {status === "running" ? (
        <button onClick={handleStop}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-destructive px-4 py-3 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90">
          <Square size={16} />
          {t("stop")}
        </button>
      ) : (
        <div className="space-y-2">
          <button onClick={handleStart} disabled={!canStartTraining || !taskCheck.allowed}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">
            <Play size={16} />
            {t("start")}
          </button>
          {!canStartTraining && params.model && (
            <p className="text-center text-xs text-red-400">{t("invalidModelError")}</p>
          )}
          {!taskCheck.allowed && (
            <p className="text-center text-xs text-amber-400">{getTaskLockHint(taskCheck.reason)}</p>
          )}
        </div>
      )}

      {/* ===== Training Progress & Log (full width, main area during training) ===== */}
      {(status === "running" || logs.length > 0 || trainLossData.length > 0) && (
        <div className="space-y-4">
          {/* Progress Bar */}
          {status === "running" && (
            <div className="space-y-1.5 rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-foreground">
                  {t("trainProgress")}
                  {currentIter > 0 && <span className="ml-1 text-muted-foreground">Iter {currentIter} / {params.iters}</span>}
                </span>
                <span className="text-muted-foreground">
                  {currentIter > 0 ? `${Math.round((currentIter / params.iters) * 100)}%` : t("initializing")}
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-blue-500 transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.round((currentIter / params.iters) * 100))}%` }} />
              </div>
              {trainLossData.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("latestTrainLoss")} <span className="font-mono text-foreground">{trainLossData[trainLossData.length - 1][1].toFixed(4)}</span>
                  {valLossData.length > 0 && (
                    <> · Val Loss: <span className="font-mono text-foreground">{valLossData[valLossData.length - 1][1].toFixed(4)}</span></>
                  )}
                </p>
              )}
            </div>
          )}

          {/* Loss Chart + Log side by side on wide, stacked on narrow */}
          <div className={`grid gap-4 ${trainLossData.length > 0 || valLossData.length > 0 ? "lg:grid-cols-[1fr_1fr]" : ""}`}>
            {/* Loss Chart */}
            {(trainLossData.length > 0 || valLossData.length > 0) && (
              <div className="rounded-lg border border-border bg-card p-3">
                <h3 className="mb-1 flex items-center gap-2 text-xs font-semibold text-foreground">
                  <BarChart3 size={12} />
                  {t("lossCurve")}
                </h3>
                <LossChart trainLoss={trainLossData} valLoss={valLossData} totalIters={params.iters} />
              </div>
            )}

            {/* Training Log */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <FileText size={14} />
                  {t("log")}
                </h3>
                {logs.length > 0 && (
                  <button
                    onClick={() => { navigator.clipboard.writeText(logs.join("\n")); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
                  >
                    {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                    {copied ? tc("copied") : tc("copyLog")}
                  </button>
                )}
              </div>
              <div
                ref={logRef}
                className="h-[400px] overflow-auto rounded-lg border border-border bg-card p-3 font-mono text-xs leading-relaxed"
              >
                {logs.length === 0 ? (
                  <p className="py-8 text-center text-muted-foreground">{t("noLog")}</p>
                ) : (
                  logs.map((line, i) => (
                    <div key={i} className={
                      line.startsWith("ERROR") || line.includes("error") ? "text-red-400" :
                      line.includes("Train loss") ? "text-blue-400" :
                      line.includes("Val loss") ? "text-amber-400" :
                      line.includes("Saved") ? "text-green-400" :
                      "text-foreground"
                    }>
                      {line}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
