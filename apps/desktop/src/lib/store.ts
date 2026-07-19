import { create } from "zustand";
import type { KeyEntry, ProviderDescriptor, ChangeSource, TableSchema } from "@rnsi/protocol";

export type Phase =
  | "no-token" // aberto sem a CLI — sem token na URL
  | "connecting" // conectando ao serviço local
  | "waiting-app" // serviço ok, aguardando o app
  | "connected"; // app conectado

export interface ActivityItem {
  id: number;
  timestamp: number;
  providerLabel: string;
  instanceId: string;
  key: string;
  change: "created" | "updated" | "removed";
  source: ChangeSource;
  preview: string | null;
  /** >1 quando o runtime fundiu uma rajada de mudanças neste item. */
  coalesced?: number;
}

export interface Selection {
  providerId: string;
  instanceId: string;
}

const ACTIVITY_LIMIT = 200;
const KEY_HISTORY_LIMIT = 20;

export interface KeyHistoryEntry {
  timestamp: number;
  change: "created" | "updated" | "removed";
  source: ChangeSource;
  preview: string | null;
}

interface StudioState {
  phase: Phase;
  appClient: { name: string; platform: string } | null;
  providers: ProviderDescriptor[];
  /** chaves por `${providerId} ${instanceId}` — só a janela já carregada */
  keys: Record<string, KeyEntry[]>;
  /**
   * Paginação da lista de chaves: cursor da próxima página e total real na
   * instância. A UI mostra "N de total" e carrega o resto sob demanda —
   * um device com 1M de chaves nunca entra inteiro na memória do Studio.
   */
  keysMeta: Record<string, { nextAfterKey: string | null; total: number }>;
  activity: ActivityItem[];
  selection: Selection | null;
  selectedKey: string | null;
  /** modo de criação de chave nova no editor */
  creating: boolean;
  /** filtro client-side da lista de chaves */
  keyFilter: string;
  /** tabelas por `${providerId} ${instanceId}` (providers database.*) */
  tables: Record<string, TableSchema[]>;
  /** tabs abertas por banco SQLite — `${providerId} ${instanceId}` → table names */
  tableTabs: Record<string, string[]>;
  selectedTable: string | null;
  /** incrementado a cada database.changed — o grid re-consulta ao mudar */
  dbRefreshNonce: number;
  /** timestamps de mudança recente, para o flash da linha */
  recentChanges: Record<string, number>;
  /**
   * Histórico por chave — `${keysId} ${key}` → mudanças mais recentes
   * primeiro. É o diferencial do produto aplicado no nível da chave
   * (plano §5.2): "mudou 4 vezes no último minuto", com os valores.
   */
  keyHistory: Record<string, KeyHistoryEntry[]>;

  setPhase(phase: Phase): void;
  setAppClient(client: StudioState["appClient"]): void;
  setProviders(providers: ProviderDescriptor[]): void;
  upsertProvider(provider: ProviderDescriptor): void;
  setKeys(
    providerId: string,
    instanceId: string,
    page: { entries: KeyEntry[]; nextAfterKey: string | null; total: number },
    mode: "replace" | "append",
  ): void;
  applyChange(input: {
    providerId: string;
    providerLabel: string;
    instanceId: string;
    key: string;
    change: "created" | "updated" | "removed";
    source: ChangeSource;
    entry: KeyEntry | null;
    timestamp: number;
    coalescedCount?: number;
  }): void;
  select(selection: Selection | null): void;
  selectKey(key: string | null): void;
  setCreating(creating: boolean): void;
  setKeyFilter(filter: string): void;
  setTables(providerId: string, instanceId: string, tables: TableSchema[]): void;
  selectTable(table: string | null): void;
  openTableTab(table: string): void;
  closeTableTab(table: string): void;
  reorderTableTabs(tabs: string[]): void;
  applyDatabaseChange(input: {
    providerId: string;
    providerLabel: string;
    instanceId: string;
    table: string;
    rowId: number | null;
    operation: "insert" | "update" | "delete" | "unknown";
    source: ChangeSource;
    timestamp: number;
    coalescedCount?: number;
  }): void;
}

export function keysId(providerId: string, instanceId: string): string {
  return `${providerId} ${instanceId}`;
}

let nextActivityId = 1;

export const useStudio = create<StudioState>((set) => ({
  phase: "connecting",
  appClient: null,
  providers: [],
  keys: {},
  keysMeta: {},
  activity: [],
  selection: null,
  selectedKey: null,
  creating: false,
  keyFilter: "",
  tables: {},
  tableTabs: {},
  selectedTable: null,
  dbRefreshNonce: 0,
  recentChanges: {},
  keyHistory: {},

  setPhase: (phase) => set({ phase }),
  setAppClient: (appClient) => set({ appClient }),
  setProviders: (providers) => set({ providers }),

  upsertProvider: (provider) =>
    set((state) => ({
      providers: [
        ...state.providers.filter((p) => p.providerId !== provider.providerId),
        provider,
      ].sort((a, b) => a.label.localeCompare(b.label)),
    })),

  setKeys: (providerId, instanceId, page, mode) =>
    set((state) => {
      const id = keysId(providerId, instanceId);
      let entries = page.entries;
      if (mode === "append") {
        // Páginas são disjuntas por cursor, mas eventos podem ter inserido
        // chaves na janela — dedupe por chave, a versão nova vence.
        const merged = new Map((state.keys[id] ?? []).map((e) => [e.key, e]));
        for (const entry of page.entries) merged.set(entry.key, entry);
        entries = [...merged.values()].sort((a, b) =>
          a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
        );
      }
      return {
        keys: { ...state.keys, [id]: entries },
        keysMeta: {
          ...state.keysMeta,
          [id]: { nextAfterKey: page.nextAfterKey, total: page.total },
        },
      };
    }),

  applyChange: (input) =>
    set((state) => {
      const id = keysId(input.providerId, input.instanceId);
      const current = state.keys[id];
      const meta = state.keysMeta[id];
      let nextEntries = current;
      let nextMeta = meta;
      if (current) {
        if (input.change === "removed") {
          const existed = current.some((e) => e.key === input.key);
          nextEntries = existed ? current.filter((e) => e.key !== input.key) : current;
          if (meta && meta.total > 0) {
            nextMeta = { ...meta, total: meta.total - 1 };
          }
        } else if (input.entry) {
          const entry = input.entry;
          const exists = current.some((e) => e.key === entry.key);
          if (exists) {
            nextEntries = current.map((e) => (e.key === entry.key ? entry : e));
          } else if (meta?.nextAfterKey != null && entry.key > meta.nextAfterKey) {
            // Chave além da janela carregada: não inserir fora de ordem —
            // ela aparece quando aquela página for carregada.
            if (input.change === "created") {
              nextMeta = { ...meta, total: meta.total + 1 };
            }
          } else {
            nextEntries = [...current, entry].sort((a, b) =>
              a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
            );
            if (meta && input.change === "created") {
              nextMeta = { ...meta, total: meta.total + 1 };
            }
          }
        }
      }

      const item: ActivityItem = {
        id: nextActivityId++,
        timestamp: input.timestamp,
        providerLabel: input.providerLabel,
        instanceId: input.instanceId,
        key: input.key,
        change: input.change,
        source: input.source,
        preview: input.entry?.preview ?? null,
        ...(input.coalescedCount !== undefined ? { coalesced: input.coalescedCount } : {}),
      };

      const historyKey = `${id} ${input.key}`;
      const historyEntry: KeyHistoryEntry = {
        timestamp: input.timestamp,
        change: input.change,
        source: input.source,
        preview: input.entry?.preview ?? null,
      };

      return {
        keys: nextEntries === current ? state.keys : { ...state.keys, [id]: nextEntries ?? [] },
        keysMeta:
          nextMeta === meta || nextMeta === undefined
            ? state.keysMeta
            : { ...state.keysMeta, [id]: nextMeta },
        activity: [item, ...state.activity].slice(0, ACTIVITY_LIMIT),
        recentChanges: { ...state.recentChanges, [historyKey]: Date.now() },
        keyHistory: {
          ...state.keyHistory,
          [historyKey]: [historyEntry, ...(state.keyHistory[historyKey] ?? [])].slice(
            0,
            KEY_HISTORY_LIMIT,
          ),
        },
      };
    }),

  select: (selection) =>
    set((state) => {
      if (!selection) {
        return {
          selection,
          selectedKey: null,
          creating: false,
          keyFilter: "",
          selectedTable: null,
        };
      }
      const id = keysId(selection.providerId, selection.instanceId);
      const tabs = state.tableTabs[id] ?? [];
      return {
        selection,
        selectedKey: null,
        creating: false,
        keyFilter: "",
        selectedTable: tabs.includes(state.selectedTable ?? "")
          ? state.selectedTable
          : tabs[0] ?? null,
      };
    }),
  selectKey: (selectedKey) => set({ selectedKey, creating: false }),
  setCreating: (creating) => set(creating ? { creating, selectedKey: null } : { creating }),
  setKeyFilter: (keyFilter) => set({ keyFilter }),

  setTables: (providerId, instanceId, tables) =>
    set((state) => {
      const id = keysId(providerId, instanceId);
      const valid = new Set(tables.map((table) => table.name));
      const currentTabs = state.tableTabs[id] ?? [];
      const nextTabs = currentTabs.filter((table) => valid.has(table));
      const isCurrentSelection =
        state.selection?.providerId === providerId && state.selection.instanceId === instanceId;
      const selectedTable =
        isCurrentSelection && state.selectedTable && !valid.has(state.selectedTable)
          ? nextTabs[0] ?? null
          : state.selectedTable;
      return {
        tables: { ...state.tables, [id]: tables },
        tableTabs: { ...state.tableTabs, [id]: nextTabs },
        selectedTable,
      };
    }),

  selectTable: (selectedTable) =>
    set((state) => {
      if (!selectedTable || !state.selection) return { selectedTable };
      const id = keysId(state.selection.providerId, state.selection.instanceId);
      const current = state.tableTabs[id] ?? [];
      const nextTabs = current.includes(selectedTable)
        ? current
        : [...current, selectedTable];
      return {
        selectedTable,
        tableTabs: { ...state.tableTabs, [id]: nextTabs },
      };
    }),

  openTableTab: (table) =>
    set((state) => {
      if (!state.selection) return {};
      const id = keysId(state.selection.providerId, state.selection.instanceId);
      const current = state.tableTabs[id] ?? [];
      return {
        selectedTable: table,
        tableTabs: {
          ...state.tableTabs,
          [id]: current.includes(table) ? current : [...current, table],
        },
      };
    }),

  closeTableTab: (table) =>
    set((state) => {
      if (!state.selection) return {};
      const id = keysId(state.selection.providerId, state.selection.instanceId);
      const current = state.tableTabs[id] ?? [];
      const index = current.indexOf(table);
      const nextTabs = current.filter((name) => name !== table);
      const fallback = nextTabs[Math.min(index, nextTabs.length - 1)] ?? null;
      return {
        tableTabs: { ...state.tableTabs, [id]: nextTabs },
        selectedTable: state.selectedTable === table ? fallback : state.selectedTable,
      };
    }),

  reorderTableTabs: (tabs) =>
    set((state) => {
      if (!state.selection) return {};
      const id = keysId(state.selection.providerId, state.selection.instanceId);
      const current = state.tableTabs[id] ?? [];
      const sameMembers =
        current.length === tabs.length && current.every((table) => tabs.includes(table));
      if (!sameMembers) return {};
      return { tableTabs: { ...state.tableTabs, [id]: tabs } };
    }),

  applyDatabaseChange: (input) =>
    set((state) => {
      const item: ActivityItem = {
        id: nextActivityId++,
        timestamp: input.timestamp,
        providerLabel: input.providerLabel,
        instanceId: input.instanceId,
        key: input.rowId !== null ? `${input.table} · rowid ${input.rowId}` : input.table,
        change:
          input.operation === "insert"
            ? "created"
            : input.operation === "delete"
              ? "removed"
              : "updated",
        source: input.source,
        preview: null,
        ...(input.coalescedCount !== undefined ? { coalesced: input.coalescedCount } : {}),
      };
      const tableHistoryKey = `${keysId(input.providerId, input.instanceId)} ${input.table}`;
      // O nonce dispara refetch no RowGrid — só bump quando o evento é da
      // instância selecionada; evento de outro banco não deve custar query.
      const matchesSelection =
        state.selection?.providerId === input.providerId &&
        state.selection.instanceId === input.instanceId;
      return {
        activity: [item, ...state.activity].slice(0, ACTIVITY_LIMIT),
        dbRefreshNonce: matchesSelection ? state.dbRefreshNonce + 1 : state.dbRefreshNonce,
        recentChanges: { ...state.recentChanges, [tableHistoryKey]: Date.now() },
      };
    }),
}));
