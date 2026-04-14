import { useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";

interface ShortcutHandlers {
  [key: string]: () => void;
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const key = [
        event.metaKey || event.ctrlKey ? "mod" : "",
        event.shiftKey ? "shift" : "",
        event.altKey ? "alt" : "",
        event.key.toLowerCase(),
      ]
        .filter(Boolean)
        .join("+");

      const handler = handlers[key];
      if (handler) {
        event.preventDefault();
        handler();
      }
    },
    [handlers]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}

export function useNavigationShortcuts() {
  const navigate = useNavigate();

  useKeyboardShortcuts({
    "mod+1": () => navigate("/"),
    "mod+2": () => navigate("/projects"),
    "mod+3": () => navigate("/data-prep"),
    "mod+4": () => navigate("/training"),
    "mod+5": () => navigate("/testing"),
    "mod+6": () => navigate("/export"),
    "mod+7": () => navigate("/settings"),
    "mod+,": () => navigate("/settings"),
    "mod+enter": () => {
      // Focus first primary action on current page
      const button = document.querySelector("[data-primary-action]") as HTMLButtonElement;
      button?.click();
    },
    "mod+shift+c": () => {
      // Close current modal/panel
      const dialog = document.querySelector("[role='dialog']") as HTMLElement;
      if (dialog) {
        const closeBtn = dialog.querySelector("[data-close]") as HTMLButtonElement;
        closeBtn?.click();
      }
    },
  });
}