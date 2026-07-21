"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const STORAGE_KEY = "nativescope-theme";

/**
 * Alterna a classe `dark` no <html> — a variante que packages/tokens usa.
 *
 * O estado inicial é lido do DOM, não recalculado: o script inline do layout
 * já decidiu antes da pintura, e recalcular aqui causaria divergência de
 * hidratação.
 */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    setMounted(true);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
    } catch {
      /* storage bloqueado: o tema ainda funciona nesta sessão */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      data-theme-toggle
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      // Antes de montar não sabemos o tema; o ícone entra depois para não
      // renderizar o oposto do que o script inline já aplicou.
      suppressHydrationWarning
    >
      {mounted ? (
        dark ? (
          <Sun size={16} aria-hidden />
        ) : (
          <Moon size={16} aria-hidden />
        )
      ) : (
        <span style={{ display: "inline-block", width: 16, height: 16 }} />
      )}
    </button>
  );
}
