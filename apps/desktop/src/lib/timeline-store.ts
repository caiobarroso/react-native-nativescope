import { create } from "zustand";
import { useStudio } from "./store.ts";
import {
  DEFAULT_WINDOW_MS,
  EVENT_COUNT_OPTIONS,
  TIMELINE_SOURCES,
  type TimelineWindowMode,
  type TimelineAnchor,
  type TimelineSource,
} from "./timeline-select.ts";

export type TimelineOriginModule = "logs" | "network" | "timeline";

export interface TimelineOrigin {
  /** De onde o usuário abriu este recorte da Timeline. */
  module: TimelineOriginModule;
}

/**
 * Estado de escopo da Timeline. Minúsculo de propósito: a Timeline não tem
 * dados próprios — só a âncora, a janela e quais trilhas mostrar.
 */
interface TimelineState {
  anchor: TimelineAnchor | null;
  /** Mantido enquanto o usuário escolhe outro momento dentro do mesmo fluxo. */
  origin: TimelineOrigin | null;
  windowMode: TimelineWindowMode;
  windowMs: number;
  eventCount: number;
  sources: TimelineSource[];

  /** Abre a Timeline já escopada (usado pelos botões dentro dos módulos). */
  open(anchor: TimelineAnchor, origin?: TimelineOrigin): void;
  /** Volta para o módulo de origem, quando a Timeline foi aberta de lá. */
  goBack(): void;
  /** Abre o seletor sem perder a origem para que o retorno continue correto. */
  chooseAnother(): void;
  setAnchor(anchor: TimelineAnchor | null): void;
  setWindowMs(ms: number): void;
  setWindowMode(mode: TimelineWindowMode): void;
  setEventCount(count: number): void;
  toggleSource(source: TimelineSource): void;
}

export const useTimeline = create<TimelineState>((set, get) => ({
  anchor: null,
  origin: null,
  windowMode: "time",
  windowMs: DEFAULT_WINDOW_MS,
  eventCount: EVENT_COUNT_OPTIONS[0]!.count,
  sources: [...TIMELINE_SOURCES],

  open: (anchor, origin) => {
    set((state) => ({ anchor, origin: origin ?? state.origin }));
    useStudio.getState().setActiveModule("timeline");
  },

  goBack: () => {
    const origin = get().origin;
    set({ anchor: null, origin: null });
    if (origin?.module === "logs" || origin?.module === "network") {
      useStudio.getState().setActiveModule(origin.module);
    }
  },

  chooseAnother: () => set({ anchor: null }),

  setAnchor: (anchor) => set({ anchor }),

  setWindowMs: (windowMs) => set({ windowMode: "time", windowMs }),

  setWindowMode: (windowMode) => set({ windowMode }),

  setEventCount: (eventCount) => set({ windowMode: "events", eventCount }),

  toggleSource: (source) =>
    set((state) => {
      const next = state.sources.includes(source)
        ? state.sources.filter((item) => item !== source)
        : [...state.sources, source];
      // Desligar tudo deixaria a tela vazia sem explicação — mantém a última.
      return next.length === 0 ? {} : { sources: next };
    }),
}));
