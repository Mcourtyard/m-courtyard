import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import {
  ChevronDown, ChevronRight, CheckCircle2, RefreshCw,
  FolderOpen, Globe, Download, HardDrive, Settings,
} from "lucide-react";

export interface LocalModelInfo {
  name: string;
  path: string;
  size_mb: number;
  is_mlx: boolean;
  source: string;
}

export interface AdapterInfo {
  name: string;
  path: string;
  created: string;
  has_weights: boolean;
  base_model: string;
}

export type ModelSelectorMode = "training" | "dataprep" | "export";

interface Props {
  mode: ModelSelectorMode;
  selectedModel: string;
  onSelect: (modelId: string, isLocalPath?: boolean) => void;
  disabled?: boolean;
  projectId?: string;
  onSelectAdapter?: (adapter: AdapterInfo) => void;
}

const SOURCE_LABELS_STATIC: Record<string, string> = {
  huggingface: "HuggingFace",
  modelscope: "ModelScope",
  ollama: "Ollama",
};
const SOURCE_COLORS: Record<string, string> = {
  huggingface: "text-tag-hf bg-tag-hf/15",
  modelscope: "text-tag-ms bg-tag-ms/15",
  ollama: "text-success bg-success/15",
  trained: "text-tag-trained bg-tag-trained/15",
};
const RECOMMENDED_HF_MODELS = [
  { id: "mlx-community/Llama-3.2-3B-Instruct-4bit", label: "Llama 3.2 3B", size: "~2GB", descKey: "balanced" },
  { id: "mlx-community/Llama-3.2-1B-Instruct-4bit", label: "Llama 3.2 1B", size: "~0.8GB", descKey: "lightweight" },
  { id: "mlx-community/Qwen2.5-3B-Instruct-4bit", label: "Qwen 2.5 3B", size: "~2GB", descKey: "chineseGood" },
  { id: "mlx-community/Qwen2.5-7B-Instruct-4bit", label: "Qwen 2.5 7B", size: "~4.7GB", descKey: "chineseBetter" },
  { id: "mlx-community/DeepSeek-R1-Distill-Qwen-7B-4bit", label: "DeepSeek R1 7B", size: "~4.7GB", descKey: "reasoning" },
  { id: "mlx-community/DeepSeek-R1-Distill-Llama-8B-4bit-mlx", label: "DeepSeek R1 8B", size: "~5GB", descKey: "reasoningGeneral" },
  { id: "mlx-community/DeepSeek-R1-Distill-Qwen-1.5B-4bit", label: "DeepSeek R1 1.5B", size: "~1GB", descKey: "reasoningLight" },
  { id: "mlx-community/Phi-3.5-mini-instruct-4bit", label: "Phi 3.5 Mini", size: "~2.4GB", descKey: "codeStrong" },
  { id: "mlx-community/Mistral-7B-Instruct-v0.3-4bit", label: "Mistral 7B", size: "~4GB", descKey: "euOpen" },
  { id: "mlx-community/gemma-2-2b-it-4bit", label: "Gemma 2 2B", size: "~1.5GB", descKey: "google" },
];

const RECOMMENDED_OLLAMA_MODELS = [
  { id: "llama3.2:3b", label: "Llama 3.2 3B", size: "~2GB", descKey: "balanced" },
  { id: "llama3.2:1b", label: "Llama 3.2 1B", size: "~1.3GB", descKey: "lightweight" },
  { id: "qwen2.5:3b", label: "Qwen 2.5 3B", size: "~2GB", descKey: "chineseGood" },
  { id: "qwen2.5:7b", label: "Qwen 2.5 7B", size: "~4.7GB", descKey: "higherQuality" },
  { id: "deepseek-r1:1.5b", label: "DeepSeek R1 1.5B", size: "~1.1GB", descKey: "reasoningLight" },
  { id: "deepseek-r1:7b", label: "DeepSeek R1 7B", size: "~4.7GB", descKey: "reasoning" },
  { id: "deepseek-r1:8b", label: "DeepSeek R1 8B", size: "~5GB", descKey: "reasoningGeneral" },
  { id: "phi3.5:latest", label: "Phi 3.5 Mini", size: "~2.2GB", descKey: "codeStrong" },
  { id: "mistral:7b", label: "Mistral 7B", size: "~4.1GB", descKey: "euOpen" },
  { id: "gemma2:2b", label: "Gemma 2 2B", size: "~1.6GB", descKey: "google" },
];

interface OllamaModelInfo {
  name: string;
  size: string;
}

const HF_DOWNLOAD_LINKS = [
  { labelKey: "hfLinks.official", url: "https://huggingface.co/mlx-community" },
  { labelKey: "hfLinks.mirror", url: "https://hf-mirror.com/mlx-community" },
  { labelKey: "hfLinks.modelscope", url: "https://modelscope.cn/models?nameContains=mlx" },
];

const OLLAMA_LINKS = [
  { labelKey: "ollamaLinks.website", url: "https://ollama.com" },
  { labelKey: "ollamaLinks.library", url: "https://ollama.com/library" },
];

function isModelUsable(source: string, mode: ModelSelectorMode): boolean {
  if (mode === "training") return source !== "ollama" && source !== "trained";
  if (mode === "dataprep") return source === "ollama";
  if (mode === "export") return source === "trained";
  return true;
}

function getDisabledReasonKey(source: string, mode: ModelSelectorMode): string {
  if (mode === "training") {
    if (source === "ollama") return "modelSelector.disabledReason.ollamaNoLora";
    if (source === "trained") return "modelSelector.disabledReason.trainedNotBase";
  }
  if (mode === "dataprep") {
    if (source === "trained") return "modelSelector.disabledReason.adapterNoGen";
    if (source !== "ollama") return "modelSelector.disabledReason.ollamaOnly";
  }
  if (mode === "export") {
    if (source !== "trained") return "modelSelector.disabledReason.selectAdapter";
  }
  return "";
}

export function ModelSelector({ mode, selectedModel, onSelect, disabled, projectId, onSelectAdapter }: Props) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const sourceLabel = (s: string) => s === "trained" ? t("modelSelector.sourceLabels.trained") : (SOURCE_LABELS_STATIC[s] || s);
  const [allModels, setAllModels] = useState<LocalModelInfo[]>([]);
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [ollamaModels, setOllamaModels] = useState<OllamaModelInfo[]>([]);
  const [hfSource, setHfSource] = useState<string>("huggingface");
  const [loading, setLoading] = useState(false);
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const [showOnline, setShowOnline] = useState(false);
  const [showPanel, setShowPanel] = useState(false);

  const loadModels = useCallback(async () => {
    setLoading(true);
    try {
      const list = await invoke<LocalModelInfo[]>("scan_local_models");
      setAllModels(list);
    } catch {
      setAllModels([]);
    }
    setLoading(false);
  }, []);

  const loadOllamaModels = useCallback(async () => {
    try {
      const list = await invoke<OllamaModelInfo[]>("list_ollama_models");
      setOllamaModels(list);
    } catch {
      setOllamaModels([]);
    }
  }, []);

  const loadHfSource = useCallback(async () => {
    try {
      const cfg = await invoke<{ hf_source: string }>("get_app_config");
      setHfSource(cfg.hf_source || "huggingface");
    } catch { /* ignore */ }
  }, []);

  const loadAdapters = useCallback(async () => {
    if (!projectId) { setAdapters([]); return; }
    try {
      const list = await invoke<AdapterInfo[]>("list_adapters", { projectId });
      setAdapters(list.filter((a) => a.has_weights));
    } catch {
      setAdapters([]);
    }
  }, [projectId]);

  useEffect(() => { loadModels(); loadOllamaModels(); loadHfSource(); }, [loadModels, loadOllamaModels, loadHfSource]);
  useEffect(() => { loadAdapters(); }, [loadAdapters]);

  // Combine scanned models with adapter pseudo-models
  const combinedModels: LocalModelInfo[] = [
    ...allModels,
    ...adapters.map((a) => ({
      name: `${a.base_model || a.name} \u2192 ${a.created}`,
      path: a.path,
      size_mb: 0,
      is_mlx: true,
      source: "trained",
    })),
  ];

  // Group by source
  const grouped = combinedModels.reduce<Record<string, LocalModelInfo[]>>((acc, m) => {
    if (!acc[m.source]) acc[m.source] = [];
    acc[m.source].push(m);
    return acc;
  }, {});

  // Sort sources: most usable models first
  const sortedSources = Object.keys(grouped).sort((a, b) => {
    const usableA = grouped[a].filter((m) => isModelUsable(m.source, mode)).length;
    const usableB = grouped[b].filter((m) => isModelUsable(m.source, mode)).length;
    return usableB - usableA;
  });

  // Check if an online model is already downloaded locally
  const isDownloaded = (modelId: string) =>
    allModels.some((m) => m.name === modelId);

  // Check if an Ollama model is installed (match by prefix, e.g. "llama3.2:3b" matches "llama3.2:3b-instruct-...")
  const isOllamaInstalled = (modelId: string) =>
    ollamaModels.some((m) => m.name === modelId || m.name.startsWith(modelId.split(":")[0] + ":" + modelId.split(":")[1]));

  const toggleSource = (source: string) => {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  };

  // Auto-expand the source with most usable models on first load
  useEffect(() => {
    if (combinedModels.length > 0 && expandedSources.size === 0) {
      const best = sortedSources[0];
      if (best) setExpandedSources(new Set([best]));
    }
  }, [combinedModels.length]);

  const navigateToSettings = () => {
    navigate("/settings");
    // Settings page has #storage section with model path config
  };

  const openUrl = (url: string) => {
    invoke("plugin:opener|open_url", { url });
  };

  const openSourceFolder = (source: string) => {
    if (source === "trained" && projectId) {
      invoke("open_project_folder", { projectId });
    } else {
      invoke("open_model_cache", { source });
    }
  };

  // Handle model selection - scanned models don't need isLocalPath
  const handleSelectModel = (m: LocalModelInfo) => {
    if (m.source === "trained") {
      const adapter = adapters.find((a) => a.path === m.path);
      if (adapter && onSelectAdapter) onSelectAdapter(adapter);
      onSelect(m.path);
    } else {
      onSelect(m.name);  // No isLocalPath - scanned models are already validated
    }
  };

  const totalModels = combinedModels.length;
  const usableModels = combinedModels.filter((m) => isModelUsable(m.source, mode)).length;

  return (
    <div className="space-y-2">
      {/* Toggle Panel Button */}
      <div className="flex gap-2">
        <button
          onClick={() => { if (showPanel && !showOnline) { setShowPanel(false); } else { setShowPanel(true); setShowOnline(false); } }}
          disabled={disabled}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2.5 text-xs font-medium transition-colors disabled:opacity-50 ${
            showPanel && !showOnline
              ? "border-primary bg-primary/10 text-foreground"
              : "border-border text-muted-foreground hover:bg-accent"
          }`}
        >
          {showPanel && !showOnline ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {t("modelSelector.selectExisting")}
        </button>
        <button
          onClick={() => { if (showPanel && showOnline) { setShowPanel(false); } else { setShowPanel(true); setShowOnline(true); } }}
          disabled={disabled}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2.5 text-xs font-medium transition-colors disabled:opacity-50 ${
            showPanel && showOnline
              ? "border-primary bg-primary/10 text-foreground"
              : "border-border text-muted-foreground hover:bg-accent"
          }`}
        >
          <Download size={12} />
          {t("modelSelector.onlineModels")}
        </button>
        <button
          onClick={navigateToSettings}
          disabled={disabled}
          className="flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
        >
          <Settings size={12} />
          {t("modelSelector.adjustSource")}
        </button>
      </div>

      {/* Panel */}
      {showPanel && (
        <div className="rounded-lg border border-border bg-background">
          {/* Tab Bar */}
          <div className="flex border-b border-border">
            <button
              onClick={() => setShowOnline(false)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors ${
                !showOnline ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <HardDrive size={12} />
              {t("modelSelector.localModels")}
            </button>
            <button
              onClick={() => setShowOnline(true)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors ${
                showOnline ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Download size={12} />
              {t("modelSelector.onlineTab")}
            </button>
          </div>

          <div className="p-3">
            {!showOnline ? (
              /* ======== Local Models Tab ======== */
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {t("modelSelector.scanStatus", { total: totalModels, usable: usableModels })}
                  </p>
                  <button
                    onClick={() => { loadModels(); loadAdapters(); }}
                    disabled={loading}
                    className="flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50"
                  >
                    <RefreshCw size={10} className={loading ? "animate-spin" : ""} />
                    {loading ? t("modelSelector.scanning") : t("modelSelector.refresh")}
                  </button>
                </div>

                {totalModels === 0 ? (
                  <div className="py-6 text-center">
                    <p className="text-xs text-muted-foreground/70">
                      {loading ? t("modelSelector.scanningModels") : t("modelSelector.noModelsFound")}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground/50">
                      {t("modelSelector.noModelsHint")}
                    </p>
                  </div>
                ) : (
                  <div className="max-h-64 space-y-1 overflow-y-auto">
                    {sortedSources.map((source) => {
                      const models = grouped[source];
                      const expanded = expandedSources.has(source);
                      const usableCount = models.filter((m) => isModelUsable(m.source, mode)).length;
                      return (
                        <div key={source}>
                          {/* Source Header */}
                          <div className="flex items-center justify-between rounded-md px-2 py-1.5">
                            <button
                              onClick={() => toggleSource(source)}
                              className="flex items-center gap-2 text-xs font-medium text-foreground transition-colors hover:bg-accent rounded-md px-1 py-0.5"
                            >
                              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                              <span className={`rounded px-1.5 py-0.5 text-[10px] ${SOURCE_COLORS[source] || "bg-muted text-muted-foreground"}`}>
                                {sourceLabel(source)}
                              </span>
                              <span className="text-muted-foreground">
                                {usableCount > 0 ? t("modelSelector.usableCount", { count: usableCount }) : t("modelSelector.notUsable")}
                                {usableCount < models.length && t("modelSelector.totalCount", { count: models.length })}
                              </span>
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); openSourceFolder(source); }}
                              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                              title={t("modelSelector.openFolderTitle", { source: sourceLabel(source) })}
                            >
                              <FolderOpen size={10} />
                              {t("modelSelector.openFolder")}
                            </button>
                          </div>

                          {/* Models List */}
                          {expanded && (
                            <div className="ml-4 space-y-0.5">
                              {models.map((m) => {
                                const usable = isModelUsable(m.source, mode);
                                const isSelected = selectedModel === m.name || selectedModel === m.path;
                                const reasonKey = getDisabledReasonKey(m.source, mode);
                                const reason = reasonKey ? t(reasonKey) : "";
                                return (
                                  <button
                                    key={m.path + m.name}
                                    onClick={() => usable && handleSelectModel(m)}
                                    disabled={!usable || disabled}
                                    className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                                      isSelected
                                        ? "border-primary bg-primary/10 text-foreground"
                                        : usable
                                        ? "border-border text-muted-foreground hover:bg-accent"
                                        : "border-border/50 text-muted-foreground/40 cursor-not-allowed"
                                    }`}
                                    title={reason}
                                  >
                                    {/* Radio indicator */}
                                    {isSelected ? (
                                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-primary"><span className="h-2 w-2 rounded-full bg-primary" /></span>
                                    ) : (
                                      <span className={`h-4 w-4 shrink-0 rounded-full border-2 ${usable ? "border-muted-foreground/30" : "border-muted-foreground/15"}`} />
                                    )}
                                    <div className="min-w-0 flex-1">
                                      <span className={`truncate font-medium ${usable ? "text-foreground" : "text-muted-foreground/40"}`}>{m.name}</span>
                                      {m.is_mlx && m.source !== "trained" && (
                                        <span className="ml-1.5 rounded bg-tag-mlx/15 px-1 py-0.5 text-[10px] text-tag-mlx">MLX</span>
                                      )}
                                      {!usable && reason && (
                                        <span className="ml-1.5 text-[10px] text-muted-foreground/40">({reason})</span>
                                      )}
                                    </div>
                                    <span className={`ml-2 shrink-0 ${usable ? "text-muted-foreground/70" : "text-muted-foreground/30"}`}>
                                      {m.size_mb > 1024 ? `${(m.size_mb / 1024).toFixed(1)} GB` : m.size_mb > 0 ? `${m.size_mb} MB` : ""}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Model source links */}
                <div className="space-y-2 border-t border-border pt-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-foreground">{t("modelSelector.downloadSources")}</p>
                    <button
                      onClick={() => invoke("open_model_cache")}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <FolderOpen size={10} />
                      {t("modelSelector.manageDownloaded")}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {HF_DOWNLOAD_LINKS.map((link) => (
                      <button
                        key={link.url}
                        onClick={() => openUrl(link.url)}
                        className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <Globe size={10} />
                        {t(`modelSelector.${link.labelKey}`)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              /* ======== Online Models Tab ======== */
              <div className="space-y-2">
                {mode === "dataprep" ? (
                  /* --- DataPrep: Ollama models --- */
                  <>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">
                        {t("modelSelector.downloadFrom", { source: "Ollama" })}
                      </p>
                    </div>
                    <div className="space-y-1">
                      {RECOMMENDED_OLLAMA_MODELS.map((m) => {
                        const downloaded = isOllamaInstalled(m.id);
                        const isSelected = selectedModel === m.id;
                        return (
                          <button
                            key={m.id}
                            onClick={() => onSelect(m.id)}
                            disabled={disabled}
                            className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors disabled:opacity-50 ${
                              isSelected
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-border text-muted-foreground hover:bg-accent"
                            }`}
                          >
                            {isSelected ? (
                              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-primary"><span className="h-2 w-2 rounded-full bg-primary" /></span>
                            ) : (
                              <span className="h-4 w-4 shrink-0 rounded-full border-2 border-muted-foreground/30" />
                            )}
                            <div className="min-w-0 flex-1">
                              <span className="font-medium text-foreground">{m.label}</span>
                              <span className="ml-1.5 text-muted-foreground/50">{t(`modelSelector.modelDesc.${m.descKey}`)}</span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {downloaded && (
                                <span className="flex items-center gap-0.5 rounded bg-success/15 px-1.5 py-0.5 text-[10px] text-success">
                                  <CheckCircle2 size={10} />
                                  {t("modelSelector.downloaded")}
                                </span>
                              )}
                              <span className="font-mono text-muted-foreground/70">{m.size}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    <div className="space-y-2 border-t border-border pt-2">
                      <p className="text-xs text-muted-foreground/60">
                        <span className="font-mono text-foreground/70">ollama pull qwen2.5:3b</span>
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {OLLAMA_LINKS.map((link) => (
                          <button
                            key={link.url}
                            onClick={() => openUrl(link.url)}
                            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          >
                            <Globe size={10} />
                            {t(`modelSelector.${link.labelKey}`)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  /* --- Training: HuggingFace MLX models --- */
                  <>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">
                        {t("modelSelector.downloadFrom", { source: t(`modelSelector.source${hfSource === "hf-mirror" ? "HfMirror" : hfSource === "modelscope" ? "Modelscope" : "Huggingface"}`) })}
                      </p>
                      <button
                        onClick={() => invoke("open_model_cache")}
                        className="flex items-center gap-1 shrink-0 text-[10px] text-muted-foreground hover:text-foreground"
                        title={t("modelSelector.openModelCache")}
                      >
                        <FolderOpen size={10} />
                        {t("modelSelector.modelCacheDir")}
                      </button>
                    </div>
                    {hfSource === "modelscope" && (
                      <p className="text-xs text-tag-hf/80 rounded-md bg-tag-hf/10 border border-tag-hf/20 px-3 py-2">
                        ⚠ {t("modelSelector.modelscopeWarnInline")}
                        <button onClick={navigateToSettings} className="underline mx-0.5">{t("modelSelector.settingsLink")}</button>
                        {t("modelSelector.modelscopeWarnSuffix")}
                      </p>
                    )}

                    <div className="space-y-1">
                      {RECOMMENDED_HF_MODELS.map((m) => {
                        const downloaded = isDownloaded(m.id);
                        const isSelected = selectedModel === m.id;
                        const unavailable = hfSource === "modelscope";
                        return (
                          <button
                            key={m.id}
                            onClick={() => !unavailable && onSelect(m.id)}
                            disabled={disabled || unavailable}
                            className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors disabled:opacity-50 ${
                              unavailable
                                ? "border-border/50 text-muted-foreground/40 cursor-not-allowed"
                                : isSelected
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-border text-muted-foreground hover:bg-accent"
                            }`}
                          >
                            {isSelected && !unavailable ? (
                              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-primary"><span className="h-2 w-2 rounded-full bg-primary" /></span>
                            ) : (
                              <span className={`h-4 w-4 shrink-0 rounded-full border-2 ${unavailable ? "border-muted-foreground/15" : "border-muted-foreground/30"}`} />
                            )}
                            <div className="min-w-0 flex-1">
                              <span className={`font-medium ${unavailable ? "text-muted-foreground/40" : "text-foreground"}`}>{m.label}</span>
                              <span className={`ml-1.5 rounded px-1 py-0.5 text-[10px] ${unavailable ? "bg-tag-mlx/5 text-tag-mlx/40" : "bg-tag-mlx/15 text-tag-mlx"}`}>MLX</span>
                              <span className="ml-1 text-muted-foreground/50">{t(`modelSelector.modelDesc.${m.descKey}`)}</span>
                              {unavailable && <span className="ml-1 text-[10px] text-muted-foreground/40">{t("modelSelector.unavailableSource")}</span>}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {downloaded && (
                                <span className="flex items-center gap-0.5 rounded bg-success/15 px-1.5 py-0.5 text-[10px] text-success">
                                  <CheckCircle2 size={10} />
                                  {t("modelSelector.downloaded")}
                                </span>
                              )}
                              <span className="font-mono text-muted-foreground/70">{m.size}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    <div className="space-y-2 border-t border-border pt-2">
                      <p className="text-xs text-muted-foreground/60">
                        {t("modelSelector.mlxHint")}
                        <button onClick={navigateToSettings} className="underline mx-0.5 text-primary/70">{t("modelSelector.settingsLink")}</button>
                        {t("modelSelector.mlxHintSuffix")}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {HF_DOWNLOAD_LINKS.map((link) => (
                          <button
                            key={link.url}
                            onClick={() => openUrl(link.url)}
                            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          >
                            <Globe size={10} />
                            {t(`modelSelector.${link.labelKey}`)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
