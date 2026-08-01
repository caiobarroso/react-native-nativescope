import { create } from "zustand";
import { logBatchSchema, type LogEntry, type LogLevel } from "@rnsi/protocol";

/**
 * Store do módulo de Logs — separado do `useStudio` (storage) e do `useNetwork`,
 * como manda o padrão: domínios distintos sobre a MESMA conexão. Escopado ao
 * device em foco; o studio-client chama `reset()` ao trocar/perder o device.
 *
 * Duas escolhas que divergem do network de propósito:
 *
 *  1. **Cronológico** (mais antigo primeiro, novos no fim). Log é fluxo
 *     narrativo — você lê de cima para baixo procurando causa e efeito.
 *     Request é registro, e ali newest-first é certo. Também é o que mantém
 *     coerência com a Timeline, que é obrigatoriamente cronológica.
 *
 *  2. **Append puro**: a fusão do "×N" acontece na renderização
 *     (`logs-select.ts`), não aqui. O device já funde idênticas dentro do lote;
 *     fundir de novo no store exigiria mexer em entradas já indexadas, e um
 *     store append-only é muito mais fácil de manter correto.
 */

const MAX_ENTRIES = 5000;

/**
 * Direção do tempo na lista. `asc` (padrão) é o modelo de terminal — antigo em
 * cima, novo embaixo, ancorado no fim. `desc` inverte, para quem prefere o
 * comportamento do Network. É preferência, não dado: sobrevive ao `reset()` e
 * persiste, na mesma convenção `rnsi.*` do tema e do som do Network.
 */
export type LogsOrder = "asc" | "desc";

const ORDER_STORAGE_KEY = "rnsi.logs.order";

function loadOrder(): LogsOrder {
  if (typeof window === "undefined") return "asc";
  try {
    return window.localStorage.getItem(ORDER_STORAGE_KEY) === "desc" ? "desc" : "asc";
  } catch {
    return "asc"; // sem storage — segue no padrão nesta sessão
  }
}

function saveOrder(order: LogsOrder): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ORDER_STORAGE_KEY, order);
  } catch {
    /* sem storage — a preferência vale só nesta sessão */
  }
}

export interface LogsFilters {
  /** Vazio = todos os níveis. */
  levels: LogLevel[];
  /** Busca textual em mensagem/namespace/args (substring, case-insensitive). */
  search: string;
  /** null = todos os namespaces. */
  namespace: string | null;
}

const INITIAL_FILTERS: LogsFilters = {
  levels: [],
  search: "",
  namespace: null,
};

interface LogsState {
  /** Cronológico: mais antigo primeiro. */
  entries: LogEntry[];
  byId: Record<string, LogEntry>;
  selectedId: string | null;
  filters: LogsFilters;
  /** Entradas recebidas enquanto pausado não entram no histórico do Studio. */
  capturePaused: boolean;
  /** Quantas o backpressure do device descartou nesta sessão. */
  dropped: number;
  /**
   * Fronteira do "Mark": `seq` da última entrada existente quando o usuário
   * marcou. Ancorar no `seq` (e não no relógio) é o que torna a marca exata —
   * mesmo com várias entradas no mesmo milissegundo.
   */
  markedSeq: number | null;
  markedAt: number | null;
  showEarlier: boolean;
  /** Direção do tempo na lista. Preferência do usuário, persistida. */
  order: LogsOrder;

  /** Recebe o `data` cru do module.event; valida e anexa. */
  addBatch(raw: unknown): void;
  select(id: string | null): void;
  reset(): void;
  clearEntries(): void;
  setCapturePaused(paused: boolean): void;
  mark(): void;
  clearMark(): void;
  setShowEarlier(show: boolean): void;
  toggleOrder(): void;

  toggleLevel(level: LogLevel): void;
  setSearch(query: string): void;
  setNamespace(namespace: string | null): void;
  clearFilters(): void;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export const useLogs = create<LogsState>((set, get) => ({
  entries: [],
  byId: {},
  selectedId: null,
  filters: INITIAL_FILTERS,
  capturePaused: false,
  dropped: 0,
  markedSeq: null,
  markedAt: null,
  showEarlier: false,
  order: loadOrder(),

  addBatch: (raw) => {
    const parsed = logBatchSchema.safeParse(raw);
    if (!parsed.success) return;
    const batch = parsed.data;
    if (get().capturePaused) return;
    if (batch.entries.length === 0 && batch.dropped === 0) return;

    set((state) => {
      const byId = { ...state.byId };
      const entries = state.entries.slice();
      for (const entry of batch.entries) {
        // Reconexão pode redrenar o buffer do device: id é a chave de de-dup.
        if (byId[entry.id] !== undefined) continue;
        entries.push(entry);
        byId[entry.id] = entry;
      }

      if (entries.length > MAX_ENTRIES) {
        const evicted = entries.splice(0, entries.length - MAX_ENTRIES);
        for (const entry of evicted) delete byId[entry.id];
      }

      return { entries, byId, dropped: state.dropped + batch.dropped };
    });
  },

  select: (selectedId) => set({ selectedId }),

  reset: () =>
    set({
      entries: [],
      byId: {},
      selectedId: null,
      capturePaused: false,
      dropped: 0,
      markedSeq: null,
      markedAt: null,
      showEarlier: false,
    }),

  clearEntries: () =>
    set({
      entries: [],
      byId: {},
      selectedId: null,
      dropped: 0,
      markedSeq: null,
      markedAt: null,
      showEarlier: false,
    }),

  setCapturePaused: (capturePaused) => set({ capturePaused }),

  mark: () =>
    set((state) => {
      const last = state.entries[state.entries.length - 1];
      return {
        markedSeq: last ? last.seq : -1,
        markedAt: Date.now(),
        showEarlier: false,
        selectedId: null,
      };
    }),

  clearMark: () => set({ markedSeq: null, markedAt: null, showEarlier: false }),

  setShowEarlier: (showEarlier) => set({ showEarlier }),

  toggleOrder: () => {
    const order: LogsOrder = get().order === "asc" ? "desc" : "asc";
    saveOrder(order);
    set({ order });
  },

  toggleLevel: (level) =>
    set((state) => ({
      filters: { ...state.filters, levels: toggle(state.filters.levels, level) },
    })),

  setSearch: (search) => set((state) => ({ filters: { ...state.filters, search } })),

  setNamespace: (namespace) => set((state) => ({ filters: { ...state.filters, namespace } })),

  clearFilters: () => set({ filters: INITIAL_FILTERS }),
}));
