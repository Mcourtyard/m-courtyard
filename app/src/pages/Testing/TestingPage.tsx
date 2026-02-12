import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Send, Trash2, MessageSquare, Settings, FolderOpen, ChevronDown, ChevronRight, CheckCircle2, Circle } from "lucide-react";
import { useProjectStore } from "@/stores/projectStore";
import { useTestingStore } from "@/stores/testingStore";
import { StepProgress } from "@/components/StepProgress";

interface AdapterInfo {
  name: string;
  path: string;
  created: string;
  has_weights: boolean;
  base_model: string;
}

export function TestingPage() {
  const { t } = useTranslation("testing");
  const { t: tc } = useTranslation("common");
  const { currentProject } =
    useProjectStore();
  const {
    messages, selectedAdapter, modelId,
    addMessage, setSelectedAdapter, setModelId, resetAll: resetTestingState,
    switchProject,
  } = useTestingStore();
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [maxTokens, setMaxTokens] = useState(512);
  const [temperature, setTemperature] = useState(0.7);
  const [showConfig, setShowConfig] = useState(false);
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [adapterDropdownOpen, setAdapterDropdownOpen] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  const selectAdapter = (adapter: AdapterInfo | null) => {
    if (adapter) {
      setSelectedAdapter(adapter.path);
      if (adapter.base_model) setModelId(adapter.base_model);
    } else {
      setSelectedAdapter("");
    }
    setAdapterDropdownOpen(false);
  };

  const selectedAdapterInfo = adapters.find((a) => a.path === selectedAdapter);

  const loadAdapters = async () => {
    if (!currentProject) return;
    try {
      const list = await invoke<AdapterInfo[]>("list_adapters", {
        projectId: currentProject.id,
      });
      const withWeights = list.filter((a) => a.has_weights);
      setAdapters(withWeights);
      // Auto-select the latest adapter with weights if none selected for this project
      if (withWeights.length > 0 && !selectedAdapter) {
        selectAdapter(withWeights[0]);
      }
    } catch {
      setAdapters([]);
    }
  };

  // Switch testing store context when project changes
  useEffect(() => {
    if (currentProject) {
      switchProject(currentProject.id);
      loadAdapters();
    }
  }, [currentProject]);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  // Listen for inference events
  useEffect(() => {
    const unsubs: (() => void)[] = [];

    listen<{ text?: string }>("inference:response", (e) => {
      const text = e.payload.text || "";
      useTestingStore.getState().addMessage({ role: "assistant", content: text });
      setIsGenerating(false);
    }).then((u) => unsubs.push(u));

    listen<{ message?: string }>("inference:error", (e) => {
      useTestingStore.getState().addMessage({ role: "assistant", content: `Error: ${e.payload.message || "Unknown error"}` });
      setIsGenerating(false);
    }).then((u) => unsubs.push(u));

    listen<{ message?: string }>("inference:status", (e) => {
      console.log("Inference status:", e.payload.message);
    }).then((u) => unsubs.push(u));

    return () => { unsubs.forEach((u) => u()); };
  }, []);

  const handleSend = async () => {
    if (!input.trim() || isGenerating || !currentProject) return;
    const userMsg = { role: "user" as const, content: input.trim() };
    addMessage(userMsg);
    setInput("");
    setIsGenerating(true);

    try {
      await invoke("start_inference", {
        projectId: currentProject.id,
        prompt: userMsg.content,
        model: modelId,
        adapterPath: selectedAdapter || null,
        maxTokens,
        temperature,
      });
    } catch (e) {
      addMessage({ role: "assistant", content: `Error: ${String(e)}` });
      setIsGenerating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const [step1Open, setStep1Open] = useState(true);

  const adapterValid = !!selectedAdapter && adapters.some((a) => a.path === selectedAdapter);

  const testingSubSteps = [
    { key: "adapter", label: t("step.adapter"), done: adapterValid },
    { key: "test", label: t("step.test"), done: messages.length > 0 },
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
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between pb-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("pageTitle")}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {currentProject.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowConfig(!showConfig)}
            className={`rounded-md border border-border p-2 transition-colors hover:bg-accent ${showConfig ? "bg-accent text-foreground" : "text-muted-foreground"}`}
          >
            <Settings size={16} />
          </button>
          <button
            onClick={() => resetTestingState()}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent"
          >
            <Trash2 size={14} />
            {tc("clearAll")}
          </button>
        </div>
      </div>

      {/* Unified Step Progress */}
      <StepProgress subSteps={testingSubSteps} />

      {/* 3.1 Select Adapter - collapsible card */}
      <div className="mb-3 rounded-lg border border-border bg-card">
        <button
          onClick={() => setStep1Open(!step1Open)}
          className="flex w-full items-center justify-between p-4"
        >
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            {step1Open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="flex items-center gap-1.5">
              {adapterValid ? <CheckCircle2 size={18} className="text-green-400 drop-shadow-[0_0_3px_rgba(74,222,128,0.4)]" /> : <Circle size={18} className="text-muted-foreground/30" />}
              3.1 {t("section.selectAdapter")}
            </span>
          </h3>
          {selectedAdapter && (
            <button
              onClick={(e) => { e.stopPropagation(); invoke("open_adapter_folder", { adapterPath: selectedAdapter }); }}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
              <FolderOpen size={10} />
              {tc("openFolder")}
            </button>
          )}
        </button>
        {step1Open && (
          <div className="border-t border-border p-4 space-y-2">
        {adapters.length === 0 ? (
          <p className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
            {t("noAdapter")}
          </p>
        ) : (
          <div className="relative">
            {/* Collapsed: show selected adapter */}
            <button
              onClick={() => setAdapterDropdownOpen(!adapterDropdownOpen)}
              disabled={isGenerating}
              className="flex w-full items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-left text-xs transition-colors hover:bg-accent disabled:opacity-50"
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-primary"><span className="h-2 w-2 rounded-full bg-primary" /></span>
              <div className="min-w-0 flex-1">
                {selectedAdapterInfo ? (
                  <>
                    <span className="font-medium text-foreground">{selectedAdapterInfo.created}</span>
                    <span className="ml-1.5 text-muted-foreground/50">{selectedAdapterInfo.name.slice(0, 8)}</span>
                    {selectedAdapterInfo.base_model && (
                      <span className="ml-1.5 text-muted-foreground/40">· {selectedAdapterInfo.base_model}</span>
                    )}
                  </>
                ) : (
                  <span className="text-muted-foreground">{t("noAdapterOption")}</span>
                )}
              </div>
              <ChevronDown size={14} className={`shrink-0 text-muted-foreground transition-transform ${adapterDropdownOpen ? "rotate-180" : ""}`} />
            </button>

            {/* Expanded: all options */}
            {adapterDropdownOpen && (
              <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border bg-background p-2 shadow-lg">
                {adapters.map((a) => {
                  const isSelected = selectedAdapter === a.path;
                  return (
                    <button
                      key={a.path}
                      onClick={() => selectAdapter(a)}
                      className={`flex w-full items-center gap-2 rounded-md border px-3 py-1.5 text-left text-xs transition-colors ${
                        isSelected
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      {isSelected ? <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-primary"><span className="h-2 w-2 rounded-full bg-primary" /></span> : <span className="h-4 w-4 shrink-0 rounded-full border-2 border-muted-foreground/30" />}
                      <div className="min-w-0 flex-1">
                        <span className="font-medium text-foreground">{a.created}</span>
                        <span className="ml-1.5 text-muted-foreground/50">{a.name.slice(0, 8)}</span>
                      </div>
                    </button>
                  );
                })}
                {/* No adapter - at bottom */}
                <button
                  onClick={() => selectAdapter(null)}
                  className={`flex w-full items-center gap-2 rounded-md border px-3 py-1.5 text-left text-xs transition-colors ${
                    !selectedAdapter
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {!selectedAdapter ? <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-primary"><span className="h-2 w-2 rounded-full bg-primary" /></span> : <span className="h-4 w-4 shrink-0 rounded-full border-2 border-muted-foreground/30" />}
                  <span>{t("noAdapterOption")}</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Base model info (read-only) */}
        {modelId && (
          <p className="text-[10px] text-muted-foreground/60">
            {t("baseModel")}{modelId}
          </p>
        )}

        {/* Advanced Config */}
        {showConfig && (
          <div className="grid grid-cols-2 gap-3 border-t border-border pt-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">
                {t("config.maxTokens")}
              </label>
              <input
                type="number"
                value={maxTokens}
                onChange={(e) => setMaxTokens(Number(e.target.value))}
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">
                {t("config.temperature")}
              </label>
              <input
                type="number"
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>
        )}
          </div>
        )}
      </div>

      {/* Chat Messages */}
      <div
        ref={chatRef}
        className="flex-1 overflow-y-auto space-y-4 rounded-lg border border-border bg-card p-4"
        style={{ minHeight: "300px" }}
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center py-16">
            <MessageSquare size={40} className="text-muted-foreground/30" />
            <p className="mt-3 text-sm text-muted-foreground">
              {t("chat.empty")}
            </p>
            {selectedAdapter && (
              <p className="mt-1 text-xs text-muted-foreground/70">
                {t("adapterLoaded")}
              </p>
            )}
          </div>
        ) : (
          messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"
                }`}
              >
                <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
              </div>
            </div>
          ))
        )}
        {isGenerating && (
          <div className="flex justify-start">
            <div className="rounded-lg bg-muted px-4 py-2.5 text-sm text-muted-foreground">
              {t("chat.thinking")}
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="mt-4 flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("chat.placeholder")}
          rows={1}
          className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || isGenerating}
          className="rounded-md bg-primary px-4 py-2.5 text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
