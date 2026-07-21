import type { ChangeSource, KeyEntry } from "@rnsi/protocol";
import type { DatabaseChange, KeyValueChange } from "./adapter.ts";

export type AppDevtoolsChange =
  | {
      kind: "key-value";
      providerId: string;
      instanceId: string;
      key: string;
      change: KeyValueChange["change"];
      source: ChangeSource;
      entry: KeyEntry | null;
      timestamp: number;
    }
  | {
      kind: "database";
      providerId: string;
      instanceId: string;
      table: string;
      rowId: number | null;
      operation: DatabaseChange["operation"];
      source: ChangeSource;
      timestamp: number;
    };

type AppDevtoolsBus = {
  version: number;
  lastEvent: AppDevtoolsChange | null;
  listeners: Set<(event: AppDevtoolsChange) => void>;
};

type ReactQueryBridgeState = {
  bridges: WeakMap<ReactQueryClientLike, () => void>;
  clients: Set<ReactQueryClientLike>;
  autoOptions: AutoReactQueryBridgeConfig | null;
};

const GLOBAL_KEY = "__RNSI_APP_DEVTOOLS__";
const REACT_QUERY_BRIDGE_KEY = "__RNSI_REACT_QUERY_BRIDGE_STATE__";
const MAX_DISCOVERED_REACT_QUERY_CLIENTS = 64;

export interface AppDevtoolsEventFilter {
  kind?: AppDevtoolsChange["kind"];
  providerId?: string;
  instanceId?: string;
  key?: string;
  table?: string;
  source?: ChangeSource;
}

export interface ReactQueryClientLike {
  invalidateQueries: (...args: any[]) => unknown;
}

export interface AutoReactQueryBridgeConfig {
  queryKey?: readonly unknown[];
  eventFilter?: AppDevtoolsEventFilter;
  shouldInvalidate?: (event: AppDevtoolsChange) => boolean;
}

export interface ReactQueryBridgeConfig extends AutoReactQueryBridgeConfig {
  queryClient: ReactQueryClientLike;
}

export type ReactQueryBridgeOptions =
  | true
  | ReactQueryClientLike
  | AutoReactQueryBridgeConfig
  | ReactQueryBridgeConfig;

export interface AppIndicatorConfig {
  autoHideMs?: number;
  bottomOffset?: number;
  eventFilter?: AppDevtoolsEventFilter;
}

export interface AppStorageModuleConfig {
  indicator?: boolean | AppIndicatorConfig;
  reactQuery?: ReactQueryBridgeOptions;
}

export interface AppDevtoolsConfig {
  modules?: {
    storage?: AppStorageModuleConfig;
  };
}

function getBus(): AppDevtoolsBus {
  const root = globalThis as unknown as Record<string, AppDevtoolsBus | undefined>;
  let bus = root[GLOBAL_KEY];
  if (!bus) {
    bus = { version: 0, lastEvent: null, listeners: new Set() };
    root[GLOBAL_KEY] = bus;
  }
  return bus;
}

function getReactQueryBridgeState(): ReactQueryBridgeState {
  const root = globalThis as unknown as Record<
    string,
    ReactQueryBridgeState | undefined
  >;
  let state = root[REACT_QUERY_BRIDGE_KEY];
  if (!state) {
    state = {
      bridges: new WeakMap(),
      clients: new Set(),
      autoOptions: null,
    };
    root[REACT_QUERY_BRIDGE_KEY] = state;
  }
  return state;
}

function eventMatches(event: AppDevtoolsChange, filter?: AppDevtoolsEventFilter): boolean {
  if (!filter) return true;
  if (filter.kind && event.kind !== filter.kind) return false;
  if (filter.providerId && event.providerId !== filter.providerId) return false;
  if (filter.instanceId && event.instanceId !== filter.instanceId) return false;
  if (event.kind === "key-value" && filter.key && event.key !== filter.key) return false;
  if (event.kind === "database" && filter.table && event.table !== filter.table) return false;
  if (filter.source && event.source !== filter.source) return false;
  return true;
}

export function subscribeAppDevtoolsChange(
  listener: (event: AppDevtoolsChange) => void,
  filter?: AppDevtoolsEventFilter,
): () => void {
  const bus = getBus();
  const wrapped = (event: AppDevtoolsChange) => {
    if (eventMatches(event, filter)) listener(event);
  };
  bus.listeners.add(wrapped);
  return () => bus.listeners.delete(wrapped);
}

function isReactQueryBridgeConfig(
  input: ReactQueryBridgeOptions,
): input is ReactQueryBridgeConfig {
  return typeof input === "object" && input !== null && "queryClient" in input;
}

function isReactQueryClientLike(input: ReactQueryBridgeOptions): input is ReactQueryClientLike {
  return (
    typeof input === "object" &&
    input !== null &&
    "invalidateQueries" in input &&
    typeof input.invalidateQueries === "function"
  );
}

function normalizeReactQueryOptions(input: ReactQueryClientLike | ReactQueryBridgeConfig): {
  queryClient: ReactQueryClientLike;
  queryKey?: readonly unknown[];
  eventFilter?: AppDevtoolsEventFilter;
  shouldInvalidate?: (event: AppDevtoolsChange) => boolean;
} | null {
  if (isReactQueryBridgeConfig(input)) {
    const { queryClient } = input;
    if (!queryClient || typeof queryClient.invalidateQueries !== "function") {
      console.warn(
        "[nativescope] reactQuery must be a QueryClient or { queryClient }.",
      );
      return null;
    }
    return {
      queryClient,
      queryKey: input.queryKey,
      eventFilter: input.eventFilter,
      shouldInvalidate: input.shouldInvalidate,
    };
  }

  const queryClient = input;
  if (!queryClient || typeof queryClient.invalidateQueries !== "function") {
    console.warn(
      "[nativescope] reactQuery must be a QueryClient or { queryClient }.",
    );
    return null;
  }
  return { queryClient };
}

function normalizeAutoReactQueryOptions(
  input: ReactQueryBridgeOptions,
): AutoReactQueryBridgeConfig | null {
  if (input === true) return {};
  if (isReactQueryClientLike(input) || isReactQueryBridgeConfig(input)) return null;
  return input;
}

function invalidateReactQuery(queryClient: ReactQueryClientLike, queryKey?: readonly unknown[]): void {
  try {
    const result =
      queryKey === undefined
        ? queryClient.invalidateQueries()
        : queryClient.invalidateQueries({ queryKey });
    if (result && typeof (result as Promise<unknown>).catch === "function") {
      void (result as Promise<unknown>).catch(() => {});
    }
  } catch {
    /* devtool bridge nunca pode derrubar o app */
  }
}

export function installReactQueryBridge(input: ReactQueryBridgeOptions): () => void {
  if (input === true) return enableAutoReactQueryBridge({});
  if (!isReactQueryClientLike(input) && !isReactQueryBridgeConfig(input)) {
    return enableAutoReactQueryBridge(input);
  }

  const options = normalizeReactQueryOptions(input);
  if (!options) return () => {};

  const { bridges } = getReactQueryBridgeState();
  const previous = bridges.get(options.queryClient);
  if (previous) return previous;

  const unsubscribe = subscribeAppDevtoolsChange(
    (event) => {
      if (options.shouldInvalidate && !options.shouldInvalidate(event)) return;
      invalidateReactQuery(options.queryClient, options.queryKey);
    },
    { source: "studio", ...(options.eventFilter ?? {}) },
  );

  const dispose = () => {
    unsubscribe();
    bridges.delete(options.queryClient);
  };
  bridges.set(options.queryClient, dispose);
  return dispose;
}

export function registerReactQueryClient(
  queryClient: ReactQueryClientLike,
  options?: AutoReactQueryBridgeConfig,
): () => void {
  if (!queryClient || typeof queryClient.invalidateQueries !== "function") {
    return () => {};
  }

  const state = getReactQueryBridgeState();
  if (!state.clients.has(queryClient) && state.clients.size >= MAX_DISCOVERED_REACT_QUERY_CLIENTS) {
    const oldest = state.clients.values().next().value as ReactQueryClientLike | undefined;
    if (oldest) {
      state.bridges.get(oldest)?.();
      state.clients.delete(oldest);
    }
  }
  state.clients.add(queryClient);
  const bridgeOptions = options ?? state.autoOptions;
  if (bridgeOptions) installReactQueryBridge({ queryClient, ...bridgeOptions });
  return () => {
    state.bridges.get(queryClient)?.();
    state.clients.delete(queryClient);
  };
}

export function enableAutoReactQueryBridge(options: AutoReactQueryBridgeConfig = {}): () => void {
  const state = getReactQueryBridgeState();
  state.autoOptions = options;
  for (const queryClient of state.clients) {
    installReactQueryBridge({ queryClient, ...options });
  }
  return () => {
    // A shim can discover QueryClients after configuration is installed.
    // Dispose the current set, not only the clients that existed initially.
    if (state.autoOptions !== options) return;
    state.autoOptions = null;
    for (const queryClient of state.clients) state.bridges.get(queryClient)?.();
  };
}

export function installAppDevtoolsConfig(config: AppDevtoolsConfig | null | undefined): () => void {
  const disposers: Array<() => void> = [];
  const reactQuery = config?.modules?.storage?.reactQuery;
  if (reactQuery) {
    const autoOptions = normalizeAutoReactQueryOptions(reactQuery);
    disposers.push(
      autoOptions
        ? enableAutoReactQueryBridge(autoOptions)
        : installReactQueryBridge(reactQuery),
    );
  }
  return () => {
    for (const dispose of disposers) dispose();
  };
}

export function emitAppDevtoolsChange(event: AppDevtoolsChange): void {
  const bus = getBus();
  bus.version += 1;
  bus.lastEvent = event;
  for (const listener of bus.listeners) {
    try {
      listener(event);
    } catch {
      /* never let app-side devtools listeners affect app execution */
    }
  }
}
