import { useTranslation } from "react-i18next";
import logoImg from "@/assets/logo.png";
import { useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  FolderOpen,
  Database,
  Cpu,
  MessageSquare,
  Upload,
  Settings,
  Languages,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useProjectStore } from "@/stores/projectStore";

export function Sidebar() {
  const { t, i18n } = useTranslation("nav");
  const location = useLocation();
  const navigate = useNavigate();
  const { currentProject, projects } = useProjectStore();

  const hasProject = !!currentProject;
  const projectSubPaths = ["/data-prep", "/training", "/testing", "/export"];
  const isInProjectSection = projectSubPaths.includes(location.pathname) || location.pathname === "/projects";

  const toggleLanguage = () => {
    const next = i18n.language === "zh-CN" ? "en" : "zh-CN";
    i18n.changeLanguage(next);
  };

  const subNavItems = [
    { key: "dataPrep", icon: <Database size={16} />, path: "/data-prep" },
    { key: "training", icon: <Cpu size={16} />, path: "/training" },
    { key: "testing", icon: <MessageSquare size={16} />, path: "/testing" },
    { key: "export", icon: <Upload size={16} />, path: "/export" },
  ];

  return (
    <aside className="flex h-screen w-56 flex-col border-r border-border bg-sidebar-background">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <img src={logoImg} alt="M-Courtyard" className="h-8 w-8 rounded-lg" />
        <span className="text-sm font-semibold text-sidebar-foreground">
          M-Courtyard
        </span>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {/* Dashboard - top level */}
        <button
          onClick={() => navigate("/")}
          className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-lg font-medium transition-colors ${
            location.pathname === "/"
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          }`}
        >
          <LayoutDashboard size={20} />
          <span>{t("dashboard")}</span>
        </button>

        {/* Projects - top level with expandable sub-nav */}
        <div>
          <button
            onClick={() => navigate("/projects")}
            className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-lg font-medium transition-colors ${
              isInProjectSection
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            }`}
          >
            <FolderOpen size={20} />
            <span className="flex-1 text-left">{t("projects")}</span>
            {projects.length > 0 && (
              isInProjectSection
                ? <ChevronDown size={14} className="text-muted-foreground" />
                : <ChevronRight size={14} className="text-muted-foreground" />
            )}
          </button>

          {/* Current project indicator */}
          {currentProject && isInProjectSection && (
            <div className="mx-3 mt-1 mb-1 truncate rounded bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary">
              {currentProject.name}
            </div>
          )}

          {/* Sub-navigation items */}
          {isInProjectSection && (
            <div className="mt-0.5 space-y-0.5 pl-2">
              {subNavItems.map((item) => {
                const isActive = location.pathname === item.path;
                const isDisabled = !hasProject;
                return (
                  <button
                    key={item.key}
                    onClick={() => { if (!isDisabled) navigate(item.path); }}
                    disabled={isDisabled}
                    className={`flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-base transition-colors ${
                      isDisabled
                        ? "cursor-not-allowed text-muted-foreground/30"
                        : isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    }`}
                  >
                    {item.icon}
                    <span>{t(item.key)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </nav>

      {/* Bottom */}
      <div className="space-y-1 border-t border-border p-2">
        <button
          onClick={toggleLanguage}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <Languages size={20} />
          <span>{i18n.language === "zh-CN" ? "English" : "中文"}</span>
        </button>
        <button
          onClick={() => navigate("/settings")}
          className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
            location.pathname === "/settings"
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          }`}
        >
          <Settings size={20} />
          <span>{t("settings")}</span>
        </button>
      </div>
    </aside>
  );
}
