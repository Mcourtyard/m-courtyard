import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppLayout } from "@/components/layout";
import { DashboardPage } from "@/pages/Dashboard";
import { ProjectsPage } from "@/pages/Projects";
import { DataPrepPage } from "@/pages/DataPrep";
import { TrainingPage } from "@/pages/Training";
import { TestingPage } from "@/pages/Testing";
import { ExportPage } from "@/pages/Export";
import { SettingsPage } from "@/pages/Settings";

function App() {
  return (
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
  );
}

export default App;
