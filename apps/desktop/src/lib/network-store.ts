import { create } from "zustand";
import { networkRequestSchema, type NetworkRequest } from "@rnsi/protocol";
import {
  loadNetworkSoundSettings,
  playNetworkRequestSound,
  saveNetworkSoundSettings,
  type NetworkSoundSettings,
} from "./network-sound.ts";

/**
 * Store do módulo de Network — separado do `useStudio` (storage) de propósito:
 * são domínios distintos sobre a MESMA conexão. Escopado ao device em foco; o
 * studio-client chama `reset()` ao trocar/perder o device.
 *
 * Anel limitado: mesmo um app que dispara milhares de requests nunca faz a aba
 * crescer sem teto — as mais antigas caem.
 */

const MAX_REQUESTS = 2000;
const ARRIVAL_HIGHLIGHT_MS = 1500;
const arrivalTimers = new Map<string, number>();

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
  /** Segunda request para o diff (comparada com a selecionada). */
  compareId: string | null;
  filters: NetworkFilters;
  /** Chaves de grupo expandidas (agrupamento). */
  expandedGroups: string[];
  /** Requests recebidas enquanto pausado não entram no histórico do Studio. */
  capturePaused: boolean;
  /** Fronteira local para focar apenas no tráfego gerado após uma mudança. */
  sessionStartedAt: number | null;
  /** Snapshot dos ids existentes ao criar a fronteira; não depende do relógio do device. */
  sessionEarlierIds: string[];
  showEarlier: boolean;
  /** Requests inéditas ainda dentro da janela de destaque visual. */
  recentRequestIds: string[];
  sound: NetworkSoundSettings;

  /** Recebe o `data` cru do module.event; valida e faz upsert por id. */
  addRequest(raw: unknown): void;
  select(id: string | null): void;
  setCompare(id: string | null): void;
  reset(): void;
  startNewCapture(): void;
  setCapturePaused(paused: boolean): void;
  setShowEarlier(show: boolean): void;
  clearEarlier(): void;
  clearRequests(): void;
  setSound(settings: NetworkSoundSettings): void;

  toggleMethod(method: string): void;
  toggleStatusClass(cls: StatusClass): void;
  setSearch(query: string): void;
  setSlowerThan(ms: number | null): void;
  setGrouped(grouped: boolean): void;
  clearFilters(): void;
  toggleGroup(key: string): void;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

export const useNetwork = create<NetworkState>((set, get) => ({
  requests: [],
  byId: {},
  selectedId: null,
  compareId: null,
  filters: INITIAL_FILTERS,
  expandedGroups: [],
  capturePaused: false,
  sessionStartedAt: null,
  sessionEarlierIds: [],
  showEarlier: false,
  recentRequestIds: [],
  sound: loadNetworkSoundSettings(),

  addRequest: (raw) => {
    const parsed = networkRequestSchema.safeParse(raw);
    if (!parsed.success) return;
    const record = parsed.data;
    const current = get();
    if (current.capturePaused) return;
    const isNew = current.byId[record.id] === undefined;

    set((state) => {
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
          return {
            requests,
            byId,
            recentRequestIds: [...state.recentRequestIds, record.id].slice(-80),
          };
        }
      }
      return {
        requests,
        byId: { ...state.byId, [record.id]: record },
        ...(isNew
          ? {
              recentRequestIds: [...state.recentRequestIds, record.id].slice(
                -80,
              ),
            }
          : {}),
      };
    });

    if (isNew) {
      scheduleArrivalHighlightRemoval(record.id);
      playNetworkRequestSound(record, current.sound);
    }
  },

  // Selecionar uma nova request primária encerra qualquer diff em curso.
  select: (selectedId) => set({ selectedId, compareId: null }),

  setCompare: (compareId) => set({ compareId }),

  reset: () =>
    set({
      requests: [],
      byId: {},
      selectedId: null,
      compareId: null,
      expandedGroups: [],
      capturePaused: false,
      sessionStartedAt: null,
      sessionEarlierIds: [],
      showEarlier: false,
      recentRequestIds: [],
    }),

  startNewCapture: () =>
    set((state) => ({
      sessionStartedAt: Date.now(),
      sessionEarlierIds: state.requests.map((request) => request.id),
      showEarlier: false,
      selectedId: null,
      compareId: null,
      recentRequestIds: [],
      expandedGroups: [],
    })),

  setCapturePaused: (capturePaused) => set({ capturePaused }),

  setShowEarlier: (showEarlier) => set({ showEarlier }),

  clearEarlier: () =>
    set((state) => {
      if (state.sessionStartedAt === null) return {};
      const earlierIds = new Set(state.sessionEarlierIds);
      const requests = state.requests.filter(
        (request) => !earlierIds.has(request.id),
      );
      return {
        requests,
        byId: Object.fromEntries(
          requests.map((request) => [request.id, request]),
        ),
        selectedId:
          state.selectedId &&
          requests.some((request) => request.id === state.selectedId)
            ? state.selectedId
            : null,
        compareId:
          state.compareId &&
          requests.some((request) => request.id === state.compareId)
            ? state.compareId
            : null,
        sessionStartedAt: null,
        sessionEarlierIds: [],
        showEarlier: false,
        expandedGroups: [],
      };
    }),

  clearRequests: () =>
    set({
      requests: [],
      byId: {},
      selectedId: null,
      compareId: null,
      sessionStartedAt: null,
      sessionEarlierIds: [],
      showEarlier: false,
      recentRequestIds: [],
      expandedGroups: [],
    }),

  setSound: (sound) => {
    saveNetworkSoundSettings(sound);
    set({ sound });
  },

  toggleMethod: (method) =>
    set((state) => ({
      filters: {
        ...state.filters,
        methods: toggle(state.filters.methods, method),
      },
    })),

  toggleStatusClass: (cls) =>
    set((state) => ({
      filters: {
        ...state.filters,
        statusClasses: toggle(state.filters.statusClasses, cls),
      },
    })),

  setSearch: (search) =>
    set((state) => ({ filters: { ...state.filters, search } })),

  setSlowerThan: (slowerThanMs) =>
    set((state) => ({ filters: { ...state.filters, slowerThanMs } })),

  setGrouped: (grouped) =>
    set((state) => ({ filters: { ...state.filters, grouped } })),

  clearFilters: () =>
    set((state) => ({
      filters: { ...INITIAL_FILTERS, grouped: state.filters.grouped },
    })),

  toggleGroup: (key) =>
    set((state) => ({ expandedGroups: toggle(state.expandedGroups, key) })),
}));

function scheduleArrivalHighlightRemoval(id: string): void {
  if (typeof window === "undefined") return;
  const existing = arrivalTimers.get(id);
  if (existing !== undefined) window.clearTimeout(existing);
  const timer = window.setTimeout(() => {
    arrivalTimers.delete(id);
    useNetwork.setState((state) => ({
      recentRequestIds: state.recentRequestIds.filter(
        (requestId) => requestId !== id,
      ),
    }));
  }, ARRIVAL_HIGHLIGHT_MS);
  arrivalTimers.set(id, timer);
}
