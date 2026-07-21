import { create } from "zustand";

/**
 * Layout dos painéis dockados — largura/altura e estado recolhido de cada um.
 * Preferência de UI, não dado: mora fora do store do Studio e persiste em
 * localStorage, na mesma convenção do tema (namespace `rnsi.*`).
 */
export type PanelId =
  | "sidebar"
  | "keyList"
  | "tableList"
  | "history"
  | "activity"
  | "sqlConsole";

export interface PanelSpec {
  /** extensão padrão em px — largura para painéis laterais, altura para os dockados embaixo */
  size: number;
  min: number;
  max: number;
  /** estado inicial recolhido (só o console SQL começa fechado) */
  collapsed?: boolean;
}

/** Limites por painel. O centro é sempre `flex-1`, então nunca some. */
export const PANELS: Record<PanelId, PanelSpec> = {
  sidebar: { size: 208, min: 160, max: 440 },
  keyList: { size: 288, min: 200, max: 560 },
  tableList: { size: 224, min: 160, max: 480 },
  history: { size: 240, min: 180, max: 480 },
  activity: { size: 176, min: 96, max: 560 },
  sqlConsole: { size: 280, min: 200, max: 640, collapsed: true },
};

interface PanelState {
  size: number;
  collapsed: boolean;
}

interface LayoutState {
  panels: Record<PanelId, PanelState>;
  setSize(id: PanelId, size: number): void;
  nudge(id: PanelId, delta: number): void;
  toggleCollapsed(id: PanelId): void;
  reset(id: PanelId): void;
}

const STORAGE_KEY = "rnsi.layout";

function clamp(id: PanelId, size: number): number {
  const spec = PANELS[id];
  return Math.max(spec.min, Math.min(spec.max, Math.round(size)));
}

function initial(): Record<PanelId, PanelState> {
  const base = Object.fromEntries(
    (Object.keys(PANELS) as PanelId[]).map((id) => [
      id,
      { size: PANELS[id].size, collapsed: PANELS[id].collapsed ?? false },
    ]),
  ) as Record<PanelId, PanelState>;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<Record<PanelId, Partial<PanelState>>>;
    for (const id of Object.keys(PANELS) as PanelId[]) {
      const s = saved[id];
      if (!s) continue;
      if (typeof s.size === "number" && Number.isFinite(s.size)) {
        base[id].size = clamp(id, s.size);
      }
      if (typeof s.collapsed === "boolean") base[id].collapsed = s.collapsed;
    }
  } catch {
    // storage indisponível ou corrompido — cai no padrão, sem quebrar a UI
  }
  return base;
}

export const useLayout = create<LayoutState>((set) => ({
  panels: initial(),
  setSize: (id, size) =>
    set((state) => ({
      panels: { ...state.panels, [id]: { ...state.panels[id], size: clamp(id, size) } },
    })),
  nudge: (id, delta) =>
    set((state) => ({
      panels: {
        ...state.panels,
        [id]: { ...state.panels[id], size: clamp(id, state.panels[id].size + delta) },
      },
    })),
  toggleCollapsed: (id) =>
    set((state) => ({
      panels: {
        ...state.panels,
        [id]: { ...state.panels[id], collapsed: !state.panels[id].collapsed },
      },
    })),
  reset: (id) =>
    set((state) => ({
      panels: { ...state.panels, [id]: { size: PANELS[id].size, collapsed: false } },
    })),
}));

// Persistência — mesma convenção do tema (localStorage, síncrono, sem middleware).
useLayout.subscribe((state) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.panels));
  } catch {
    // sem storage — segue só em memória nesta sessão
  }
});
