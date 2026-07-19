import { useEffect, useState } from "react";

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "rnsi.theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");

function stored(): ThemeMode {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === "light" || value === "dark" ? value : "system";
}

function apply(mode: ThemeMode): void {
  const dark = mode === "dark" || (mode === "system" && media.matches);
  document.documentElement.classList.toggle("dark", dark);
}

apply(stored());
media.addEventListener("change", () => apply(stored()));

export function useTheme(): { mode: ThemeMode; cycle: () => void } {
  const [mode, setMode] = useState<ThemeMode>(stored);

  useEffect(() => apply(mode), [mode]);

  return {
    mode,
    cycle() {
      const order: ThemeMode[] = ["system", "light", "dark"];
      const next = order[(order.indexOf(mode) + 1) % order.length] ?? "system";
      localStorage.setItem(STORAGE_KEY, next);
      setMode(next);
    },
  };
}
