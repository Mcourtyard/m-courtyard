import { create } from "zustand";

export type ThemeId = "midnight" | "ocean" | "sunset" | "nebula" | "light";

export type UIScale = "small" | "normal" | "large" | "extra-large";

interface ThemeState {
  theme: ThemeId;
  uiScale: UIScale;
  setTheme: (theme: ThemeId) => void;
  setUiScale: (scale: UIScale) => void;
}

const STORAGE_KEY = "courtyard-theme";
const SCALE_STORAGE_KEY = "courtyard-ui-scale";

const SCALE_MAP: Record<UIScale, string> = {
  "small": "14px",
  "normal": "16px",
  "large": "18px",
  "extra-large": "20px",
};

function getInitialTheme(): ThemeId {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && ["midnight", "ocean", "sunset", "nebula", "light"].includes(stored)) {
    return stored as ThemeId;
  }
  return "midnight";
}

function getInitialScale(): UIScale {
  const stored = localStorage.getItem(SCALE_STORAGE_KEY);
  if (stored && ["small", "normal", "large", "extra-large"].includes(stored)) {
    return stored as UIScale;
  }
  return "normal";
}

function applyTheme(theme: ThemeId) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(STORAGE_KEY, theme);
}

function applyScale(scale: UIScale) {
  document.documentElement.style.fontSize = SCALE_MAP[scale];
  localStorage.setItem(SCALE_STORAGE_KEY, scale);
}

// Apply on load
applyTheme(getInitialTheme());
applyScale(getInitialScale());

export const useThemeStore = create<ThemeState>((set) => ({
  theme: getInitialTheme(),
  uiScale: getInitialScale(),
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
  setUiScale: (uiScale) => {
    applyScale(uiScale);
    set({ uiScale });
  }
}));
