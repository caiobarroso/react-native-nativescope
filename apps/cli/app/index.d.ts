export type NativeScopeChangeSource = "app" | "studio";

export type NativeScopeChange =
  | {
      kind: "key-value";
      providerId: string;
      instanceId: string;
      key: string;
      change: "created" | "updated" | "removed";
      source: NativeScopeChangeSource;
      entry: unknown | null;
      timestamp: number;
    }
  | {
      kind: "database";
      providerId: string;
      instanceId: string;
      table: string;
      rowId: number | null;
      operation: "insert" | "update" | "delete" | "unknown";
      source: NativeScopeChangeSource;
      timestamp: number;
    };

export interface NativeScopeEventFilter {
  kind?: NativeScopeChange["kind"];
  providerId?: string;
  instanceId?: string;
  key?: string;
  table?: string;
  source?: NativeScopeChangeSource;
}

export interface ReactQueryClientLike {
  invalidateQueries: (...args: any[]) => unknown;
}

export interface AutoReactQueryBridgeConfig {
  queryKey?: readonly unknown[];
  eventFilter?: NativeScopeEventFilter;
  shouldInvalidate?: (event: NativeScopeChange) => boolean;
}

export interface ReactQueryBridgeConfig extends AutoReactQueryBridgeConfig {
  queryClient: ReactQueryClientLike;
}

export type ReactQueryBridgeOptions =
  | true
  | ReactQueryClientLike
  | AutoReactQueryBridgeConfig
  | ReactQueryBridgeConfig;

export interface NativeScopeIndicatorConfig {
  /**
   * Time before the visual indicator hides automatically.
   *
   * Default: 1600ms.
   */
  autoHideMs?: number;
  /**
   * Distance from the bottom of the screen. The default clears Android navigation.
   */
  bottomOffset?: number;
  /**
   * Advanced filter that restricts which changes show the indicator.
   *
   * Most apps only need `indicator: true`.
   */
  eventFilter?: NativeScopeEventFilter;
}

export interface NativeScopeStorageModuleConfig {
  /**
   * Optional in-app visual indicator in development.
   *
   * Briefly confirms that Studio changed storage and can be dismissed for the session.
   */
  indicator?: boolean | NativeScopeIndicatorConfig;
  /**
   * Plug-and-play bridge for apps that render storage through React Query.
   *
   * Shortcut:
   *   installNativeScopeDevtools({ modules: { storage: { reactQuery: queryClient } } })
   *
   * By default, only Studio-originated changes invalidate queries.
   */
  reactQuery?: ReactQueryBridgeOptions;
}

/**
 * Módulo de Network (fetch / XHR / WebSocket). Instalado separadamente — este é
 * o slot de config, inerte até o módulo existir. Ver apps/cli/metro/MODULES.md.
 * As opções reais são definidas pelo módulo; hoje `network: true` liga o slot.
 */
export interface NativeScopeNetworkModuleConfig {
  [option: string]: unknown;
}

export interface NativeScopeModulesConfig {
  /**
   * Módulo de Storage (AsyncStorage, MMKV, expo-sqlite). `true` liga com os
   * padrões; um objeto liga com opções (indicator, reactQuery).
   */
  storage?: boolean | NativeScopeStorageModuleConfig;
  /**
   * Módulo de Network (fetch/XHR/WebSocket) — opt-in, instalado separadamente.
   * `true` liga o slot; as opções vêm com o módulo.
   */
  network?: boolean | NativeScopeNetworkModuleConfig;
}

export interface NativeScopeConfig {
  modules?: NativeScopeModulesConfig;
}

export interface ManualNativeScopeStorageModuleConfig {
  /** Manual installation requires an explicit QueryClient instance. */
  reactQuery?: ReactQueryClientLike | ReactQueryBridgeConfig;
}

export interface InstallNativeScopeOptions {
  modules?: {
    storage?: ManualNativeScopeStorageModuleConfig;
  };
}

export function defineNativeScopeConfig<T extends NativeScopeConfig = NativeScopeConfig>(
  config?: T,
): T;

export interface InstalledNativeScopeDevtools {
  subscribe: typeof subscribeNativeScope;
  getSnapshot: typeof getNativeScopeSnapshot;
  dispose(): void;
}

export function installNativeScopeDevtools(
  options?: InstallNativeScopeOptions,
): InstalledNativeScopeDevtools;

export function getNativeScopeSnapshot(): {
  version: number;
  lastEvent: NativeScopeChange | null;
};

export function subscribeNativeScope(
  listener: (event: NativeScopeChange) => void,
  filter?: NativeScopeEventFilter,
): () => void;

export function useNativeScopeSignal(filter?: NativeScopeEventFilter): number;
export const useStorageChanged: typeof useNativeScopeSignal;

export function useInspectedAsyncStorage(
  key: string,
  options?: { source?: NativeScopeChangeSource },
): {
  value: string | null | undefined;
  setValue(next: string): Promise<void>;
  removeValue(): Promise<void>;
  loading: boolean;
  error: unknown;
  reload(): Promise<void>;
};

export function useInspectedMMKV<T = unknown>(
  instance: unknown,
  key: string,
  options?: { instanceId?: string; source?: NativeScopeChangeSource },
): {
  value: T | undefined;
  setValue(next: T): void;
  removeValue(): void;
  reload(): void;
};

export function useInspectedSqlite<T = unknown>(
  db: unknown,
  query: string,
  params?: unknown[],
  options?: {
    instanceId?: string;
    table?: string;
    source?: NativeScopeChangeSource;
  },
): {
  rows: T[];
  loading: boolean;
  error: unknown;
  reload(): Promise<void>;
};
