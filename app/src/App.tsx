import { useEffect, useRef } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppLayout } from "@/components/layout";
import { DashboardPage } from "@/pages/Dashboard";
import { ProjectsPage } from "@/pages/Projects";
import { DataPrepPage } from "@/pages/DataPrep";
import { TrainingPage } from "@/pages/Training";
import { TestingPage } from "@/pages/Testing";
import { ExportPage } from "@/pages/Export";
import { SettingsPage } from "@/pages/Settings";
import { useProjectStore } from "@/stores/projectStore";
import { useGenerationStore } from "@/stores/generationStore";
import { useTrainingStore } from "@/stores/trainingStore";
import { useExportStore } from "@/stores/exportStore";
import { useExportGgufStore } from "@/stores/exportGgufStore";
import { useTestingStore } from "@/stores/testingStore";

import { TooltipProvider } from "@/components/ui/tooltip";

function App() {
  const { currentProject } = useProjectStore();
  const prevProjectIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const pid = currentProject?.id;
    if (pid === prevProjectIdRef.current) return;
    prevProjectIdRef.current = pid;

    const genStore = useGenerationStore.getState();
    if (!genStore.generating) {
      genStore.resetGeneration();
      genStore.resetForm();
    }
    const trainStore = useTrainingStore.getState();
    if (trainStore.status !== "running") {
      trainStore.resetAll();
    }
    const exportStore = useExportStore.getState();
    if (!exportStore.isExporting) {
      exportStore.clearAll();
    }
    const ggufStore = useExportGgufStore.getState();
    if (!ggufStore.isExporting) {
      ggufStore.clearAll();
    }
    if (pid) {
      useTestingStore.getState().switchProject(pid);
    }
  }, [currentProject?.id]);

  return (
    <TooltipProvider delayDuration={300}>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/data-prep" element={<DataPrepPage />} />
            <Route path="/training" element={<TrainingPage />} />
            <Route path="/testing" element={<TestingPage />} />
            <Route path="/export" element={<ExportPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  );
}

export default App;
