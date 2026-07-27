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

interface NetworkState {
  /** Mais recentes primeiro. */
  requests: NetworkRequest[];
  byId: Record<string, NetworkRequest>;
  selectedId: string | null;
  /** Recebe o `data` cru do module.event; valida e faz upsert por id. */
  addRequest(raw: unknown): void;
  select(id: string | null): void;
  reset(): void;
}

export const useNetwork = create<NetworkState>((set) => ({
  requests: [],
  byId: {},
  selectedId: null,

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

  reset: () => set({ requests: [], byId: {}, selectedId: null }),
}));
