import { create } from "zustand";
import { networkRequestSchema, type NetworkRequest } from "@rnsi/protocol";

/**
 * Store do módulo de Network — separado do `useStudio` (storage) de propósito:
 * são domínios distintos sobre a MESMA conexão. Escopado ao device em foco; o
 * studio-client chama `reset()` ao trocar/perder o device.
 *
 * Anel limitado: mesmo um app que dispara milhares de requests nunca faz a aba
 * crescer sem teto — as mais antigas caem.
 */

const MAX_REQUESTS = 2000;

export type StatusClass = "2xx" | "3xx" | "4xx" | "5xx" | "err";

export interface NetworkFilters {
  /** Vazio = todos os métodos. */
  methods: string[];
  /** Vazio = todas as classes de status. */
  statusClasses: StatusClass[];
  /** Busca textual em url/headers/body (substring, case-insensitive). */
  search: string;
  /** Só requests com duração ≥ este valor (ms). null = sem filtro de lentidão. */
  slowerThanMs: number | null;
  /** Agrupa por método+baseURL+path (reduz ruído de endpoints repetidos). */
  grouped: boolean;
}

const INITIAL_FILTERS: NetworkFilters = {
  methods: [],
  statusClasses: [],
  search: "",
  slowerThanMs: null,
  grouped: true,
};

interface NetworkState {
  /** Mais recentes primeiro. */
  requests: NetworkRequest[];
  byId: Record<string, NetworkRequest>;
  selectedId: string | null;
  filters: NetworkFilters;
  /** Chaves de grupo expandidas (agrupamento). */
  expandedGroups: string[];

  /** Recebe o `data` cru do module.event; valida e faz upsert por id. */
  addRequest(raw: unknown): void;
  select(id: string | null): void;
  reset(): void;

  toggleMethod(method: string): void;
  toggleStatusClass(cls: StatusClass): void;
  setSearch(query: string): void;
  setSlowerThan(ms: number | null): void;
  setGrouped(grouped: boolean): void;
  clearFilters(): void;
  toggleGroup(key: string): void;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export const useNetwork = create<NetworkState>((set) => ({
  requests: [],
  byId: {},
  selectedId: null,
  filters: INITIAL_FILTERS,
  expandedGroups: [],

  addRequest: (raw) =>
    set((state) => {
      const parsed = networkRequestSchema.safeParse(raw);
      if (!parsed.success) return {};
      const record = parsed.data;

      const exists = state.byId[record.id] !== undefined;
      let requests: NetworkRequest[];
      if (exists) {
        // upsert: um replay/atualização reusa o id — substitui no lugar.
        requests = state.requests.map((r) => (r.id === record.id ? record : r));
      } else {
        requests = [record, ...state.requests];
        if (requests.length > MAX_REQUESTS) {
          const dropped = requests.slice(MAX_REQUESTS);
          requests = requests.slice(0, MAX_REQUESTS);
          const byId = { ...state.byId, [record.id]: record };
          for (const r of dropped) delete byId[r.id];
          return { requests, byId };
        }
      }
      return { requests, byId: { ...state.byId, [record.id]: record } };
    }),

  select: (selectedId) => set({ selectedId }),

  reset: () => set({ requests: [], byId: {}, selectedId: null, expandedGroups: [] }),

  toggleMethod: (method) =>
    set((state) => ({ filters: { ...state.filters, methods: toggle(state.filters.methods, method) } })),

  toggleStatusClass: (cls) =>
    set((state) => ({
      filters: { ...state.filters, statusClasses: toggle(state.filters.statusClasses, cls) },
    })),

  setSearch: (search) => set((state) => ({ filters: { ...state.filters, search } })),

  setSlowerThan: (slowerThanMs) => set((state) => ({ filters: { ...state.filters, slowerThanMs } })),

  setGrouped: (grouped) => set((state) => ({ filters: { ...state.filters, grouped } })),

  clearFilters: () =>
    set((state) => ({ filters: { ...INITIAL_FILTERS, grouped: state.filters.grouped } })),

  toggleGroup: (key) =>
    set((state) => ({ expandedGroups: toggle(state.expandedGroups, key) })),
}));
