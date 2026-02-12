import { create } from "zustand";

export type ThemeId = "midnight" | "ocean" | "sunset" | "nebula" | "light";

interface ThemeState {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
}

const STORAGE_KEY = "courtyard-theme";

function getInitialTheme(): ThemeId {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && ["midnight", "ocean", "sunset", "nebula", "light"].includes(stored)) {
    return stored as ThemeId;
  }
  return "midnight";
}

function applyTheme(theme: ThemeId) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(STORAGE_KEY, theme);
}

// Apply on load
applyTheme(getInitialTheme());

export const useThemeStore = create<ThemeState>((set) => ({
  theme: getInitialTheme(),
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
}));
