import { create } from "zustand";
import type { KeyEntry, ProviderDescriptor, ChangeSource, TableSchema } from "@rnsi/protocol";

export type Phase =
  | "no-token" // aberto sem a CLI — sem token na URL
  | "rejected" // o serviço recusou este cliente — estado terminal, ver Rejection
  | "connecting" // conectando ao serviço local
  | "waiting-app" // serviço ok, aguardando o app
  | "connected"; // app conectado

/**
 * Motivo da recusa no handshake. Guardado porque as causas pedem instruções
 * diferentes: token de uma execução antiga (feche a aba) não é a mesma coisa
 * que versão incompatível (atualize o pacote) — e o serviço já manda o texto
 * certo, que antes era descartado.
 */
export interface Rejection {
  code: string;
  message: string;
}

export interface ActivityItem {
  id: number;
  timestamp: number;
  providerId: string;
  providerLabel: string;
  instanceId: string;
  key: string;
  change: "created" | "updated" | "removed";
  source: ChangeSource;
  preview: string | null;
  target:
    { kind: "key-value"; key: string } | { kind: "database"; table: string; rowId: number | null };
  /** >1 quando o runtime fundiu uma rajada de mudanças neste item. */
  coalesced?: number;
}

export interface ActivityFocus {
  token: number;
  providerId: string;
  instanceId: string;
  target: ActivityItem["target"];
}

export interface Selection {
  providerId: string;
  instanceId: string;
}

/** Módulo ativo na área principal. Preferência de UI, independente do device. */
export type ActiveModule = "storage" | "network";

export interface Device {
  deviceId: string;
  name: string;
  platform: string;
  /** Rótulo legível pro seletor (ex. "iOS", "Android"). */
  label: string;
  /** null = runtime antigo, sem sinal; boolean = configuração reportada pelo app. */
  storageReactQuerySync: boolean | null;
}

const ACTIVITY_LIMIT = 200;
const KEY_HISTORY_LIMIT = 20;
const KEY_HISTORY_KEY_LIMIT = 500;
const RECENT_CHANGE_LIMIT = 1_000;

function withBoundedEntry<T>(
  record: Record<string, T>,
  key: string,
  value: T,
  limit: number,
): Record<string, T> {
  const next = { ...record };
  // Reinsert existing keys so insertion order remains a useful LRU signal.
  delete next[key];
  next[key] = value;
  const overflow = Object.keys(next).length - limit;
  if (overflow > 0) {
    for (const staleKey of Object.keys(next).slice(0, overflow)) delete next[staleKey];
  }
  return next;
}

export interface KeyHistoryEntry {
  timestamp: number;
  change: "created" | "updated" | "removed";
  source: ChangeSource;
  preview: string | null;
}

interface StudioState {
  phase: Phase;
  /** Módulo ativo na área principal (storage por padrão). */
  activeModule: ActiveModule;
  /** Preenchido junto com phase "rejected"; null no resto do tempo. */
  rejection: Rejection | null;
  /** Devices (runtimes) conectados agora — o seletor lê daqui. */
  devices: Device[];
  /** Device em foco; comandos e a view inteira são escopados a ele. */
  selectedDeviceId: string | null;
  providers: ProviderDescriptor[];
  /**
   * Providers que chegaram DEPOIS da lista inicial — porque o app importou a
   * lib de storage mais tarde (tela lazy, import dinâmico). Sem sinal, o item
   * brota no meio da sidebar e parece glitch; com sinal, é informação.
   */
  arrivedLate: string[];
  /** Início da janela de sincronização do device em foco (ver PROVIDER_SYNC_GRACE_MS). */
  syncStartedAt: number;
  /** chaves por `${providerId} ${instanceId}` — só a janela já carregada */
  keys: Record<string, KeyEntry[]>;
  /**
   * Paginação da lista de chaves: cursor da próxima página e total real na
   * instância. A UI mostra "N de total" e carrega o resto sob demanda —
   * um device com 1M de chaves nunca entra inteiro na memória do Studio.
   */
  keysMeta: Record<string, { nextAfterKey: string | null; total: number }>;
  activity: ActivityItem[];
  /** Último destino aberto pelo feed de atividade; o token reinicia o destaque. */
  activityFocus: ActivityFocus | null;
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
  setActiveModule(module: ActiveModule): void;
  /** Abre uma janela de sincronização: o que chegar dentro dela é lote inicial. */
  beginProviderSync(): void;
  /** Entra no estado terminal de recusa. Nenhuma fase posterior o sobrescreve. */
  setRejected(rejection: Rejection): void;
  upsertDevice(device: Device): void;
  removeDevice(deviceId: string): void;
  /** Troca o device em foco: reseta a view (refetch lazy) — nunca mistura dados
   * de dois devices. No-op se já for o selecionado. */
  selectDevice(deviceId: string): void;
  setProviders(providers: ProviderDescriptor[]): void;
  upsertProvider(provider: ProviderDescriptor): void;
  /** "Recém-chegado" é estado transitório: some quando o realce termina. */
  clearArrivedLate(providerId: string): void;
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
  focusActivity(item: ActivityItem): void;
  clearActivityFocus(token: number): void;
}

export function keysId(providerId: string, instanceId: string): string {
  return `${providerId} ${instanceId}`;
}

/**
 * O lote inicial chega como N eventos separados (um provider.registered por
 * storage), então "tardio" não pode ser decidido por ordem — do segundo em
 * diante tudo pareceria tardio. É decidido por tempo: o que chega depois que a
 * tela já se estabeleceu é que merece sinal.
 */
const PROVIDER_SYNC_GRACE_MS = 1500;

/** Estado zerado da view ao trocar/perder o device em foco. Os caches valem
 * para um device por vez (single-active-view); trocar re-busca lazy. */
function clearedView(): Partial<StudioState> {
  return {
    providers: [],
    arrivedLate: [],
    syncStartedAt: Date.now(),
    keys: {},
    keysMeta: {},
    tables: {},
    tableTabs: {},
    recentChanges: {},
    keyHistory: {},
    activity: [],
    selection: null,
    selectedKey: null,
    selectedTable: null,
    creating: false,
    keyFilter: "",
    activityFocus: null,
  };
}

let nextActivityId = 1;
let nextActivityFocusToken = 1;

export const useStudio = create<StudioState>((set) => ({
  phase: "connecting",
  activeModule: "storage",
  rejection: null,
  devices: [],
  selectedDeviceId: null,
  providers: [],
  arrivedLate: [],
  syncStartedAt: Date.now(),
  keys: {},
  keysMeta: {},
  activity: [],
  activityFocus: null,
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

  // "rejected" é terminal: o transporte já está fechado e nada pode reescrever
  // a fase por baixo. Sem esta guarda, o ciclo de reconexão devolvia a tela
  // para "connecting" a cada tentativa — era o que fazia a UI piscar.
  setPhase: (phase) => set((state) => (state.phase === "rejected" ? {} : { phase })),

  setActiveModule: (activeModule) => set({ activeModule }),

  setRejected: (rejection) => set({ phase: "rejected", rejection }),

  beginProviderSync: () => set({ syncStartedAt: Date.now() }),

  upsertDevice: (device) =>
    set((state) => ({
      devices: [...state.devices.filter((d) => d.deviceId !== device.deviceId), device],
      // Primeiro device a chegar entra em foco automaticamente.
      selectedDeviceId: state.selectedDeviceId ?? device.deviceId,
    })),

  removeDevice: (deviceId) =>
    set((state) => {
      const devices = state.devices.filter((d) => d.deviceId !== deviceId);
      if (state.selectedDeviceId !== deviceId) return { devices };
      // Caiu o device em foco: passa o foco pro próximo vivo (ou nada) e zera a
      // view — os dados eram daquele device.
      const next = devices[0]?.deviceId ?? null;
      return { ...clearedView(), devices, selectedDeviceId: next };
    }),

  selectDevice: (deviceId) =>
    set((state) =>
      state.selectedDeviceId === deviceId ? {} : { ...clearedView(), selectedDeviceId: deviceId },
    ),

  // Snapshot: é a lista inicial por definição, ninguém "chegou depois".
  setProviders: (providers) => set({ providers, arrivedLate: [] }),

  upsertProvider: (provider) =>
    set((state) => {
      const known = state.providers.some((p) => p.providerId === provider.providerId);
      return {
        providers: [
          ...state.providers.filter((p) => p.providerId !== provider.providerId),
          provider,
        ].sort((a, b) => a.label.localeCompare(b.label)),
        // Tardio = chegou fora da janela de sincronização do device.
        arrivedLate:
          known || Date.now() - state.syncStartedAt <= PROVIDER_SYNC_GRACE_MS
            ? state.arrivedLate
            : [...state.arrivedLate, provider.providerId],
      };
    }),

  clearArrivedLate: (providerId) =>
    set((state) =>
      state.arrivedLate.includes(providerId)
        ? { arrivedLate: state.arrivedLate.filter((id) => id !== providerId) }
        : {},
    ),

  setKeys: (providerId, instanceId, page, mode) =>
    set((state) => {
      const id = keysId(providerId, instanceId);
      let entries = page.entries;
      if (mode === "append") {
        // Páginas são disjuntas por cursor, mas eventos podem ter inserido
        // chaves na janela — dedupe por chave, a versão nova vence.
        const merged = new Map((state.keys[id] ?? []).map((e) => [e.key, e]));
        for (const entry of page.entries) merged.set(entry.key, entry);
        entries = [...merged.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
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
        providerId: input.providerId,
        providerLabel: input.providerLabel,
        instanceId: input.instanceId,
        key: input.key,
        change: input.change,
        source: input.source,
        preview: input.entry?.preview ?? null,
        target: { kind: "key-value", key: input.key },
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
        recentChanges: withBoundedEntry(
          state.recentChanges,
          historyKey,
          Date.now(),
          RECENT_CHANGE_LIMIT,
        ),
        keyHistory: withBoundedEntry(
          state.keyHistory,
          historyKey,
          [historyEntry, ...(state.keyHistory[historyKey] ?? [])].slice(0, KEY_HISTORY_LIMIT),
          KEY_HISTORY_KEY_LIMIT,
        ),
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
          activityFocus: null,
        };
      }
      const id = keysId(selection.providerId, selection.instanceId);
      const tabs = state.tableTabs[id] ?? [];
      return {
        selection,
        // Key pages can be large. Keep only the selected instance cached so
        // switching through many stores cannot retain every visited dataset.
        keys: state.keys[id] ? { [id]: state.keys[id] } : {},
        keysMeta: state.keysMeta[id] ? { [id]: state.keysMeta[id] } : {},
        selectedKey: null,
        creating: false,
        keyFilter: "",
        selectedTable: tabs.includes(state.selectedTable ?? "")
          ? state.selectedTable
          : (tabs[0] ?? null),
        activityFocus: null,
      };
    }),
  selectKey: (selectedKey) => set({ selectedKey, creating: false, activityFocus: null }),
  setCreating: (creating) => set(creating ? { creating, selectedKey: null } : { creating }),
  setKeyFilter: (keyFilter) => set({ keyFilter, activityFocus: null }),

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
          ? (nextTabs[0] ?? null)
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
      const nextTabs = current.includes(selectedTable) ? current : [...current, selectedTable];
      return {
        selectedTable,
        tableTabs: { ...state.tableTabs, [id]: nextTabs },
        activityFocus: null,
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
        activityFocus: null,
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
        providerId: input.providerId,
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
        target: { kind: "database", table: input.table, rowId: input.rowId },
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
        recentChanges: withBoundedEntry(
          state.recentChanges,
          tableHistoryKey,
          Date.now(),
          RECENT_CHANGE_LIMIT,
        ),
      };
    }),

  focusActivity: (item) =>
    set((state) => {
      const selection = {
        providerId: item.providerId,
        instanceId: item.instanceId,
      };
      const activityFocus: ActivityFocus = {
        token: nextActivityFocusToken++,
        ...selection,
        target: item.target,
      };

      if (item.target.kind === "key-value") {
        const id = keysId(item.providerId, item.instanceId);
        return {
          selection,
          keys: state.keys[id] ? { [id]: state.keys[id] } : {},
          keysMeta: state.keysMeta[id] ? { [id]: state.keysMeta[id] } : {},
          selectedKey: item.change === "removed" ? null : item.target.key,
          creating: false,
          keyFilter: item.target.key,
          selectedTable: null,
          activityFocus,
        };
      }

      const id = keysId(item.providerId, item.instanceId);
      const tabs = state.tableTabs[id] ?? [];
      return {
        selection,
        keys: state.keys[id] ? { [id]: state.keys[id] } : {},
        keysMeta: state.keysMeta[id] ? { [id]: state.keysMeta[id] } : {},
        selectedKey: null,
        creating: false,
        keyFilter: "",
        selectedTable: item.target.table,
        tableTabs: {
          ...state.tableTabs,
          [id]: tabs.includes(item.target.table) ? tabs : [...tabs, item.target.table],
        },
        activityFocus,
      };
    }),
  clearActivityFocus: (token) =>
    set((state) => (state.activityFocus?.token === token ? { activityFocus: null } : {})),
}));
