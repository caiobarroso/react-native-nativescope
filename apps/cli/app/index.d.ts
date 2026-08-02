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
 * Módulo de Network (fetch / XHR). Instrumenta o `XMLHttpRequest` global em
 * desenvolvimento e transmite cada request ao Studio. `network: true` liga com
 * os padrões; um objeto abaixo ajusta o comportamento.
 */
export interface NativeScopeNetworkModuleConfig {
  /**
   * Capturar corpos de request/response (preview no Studio; corpo íntegro sob
   * demanda). Default: true.
   */
  captureBody?: boolean;
  /**
   * Máximo de bytes do preview de corpo enviado por request. Corpos maiores são
   * cortados (o íntegro vem sob demanda). Default: 32768.
   */
  maxBodyPreview?: number;
  /**
   * Acima deste tamanho (bytes) o corpo íntegro não é retido no device — só o
   * preview. Limita memória. Default: 2 MB.
   */
  maxBodyStore?: number;
  /**
   * Quantas requests recentes manter em memória no device (buffer em anel).
   * Default: 1000.
   */
  maxRequests?: number;
  /**
   * URLs a ignorar (match por substring), além do ruído de devtools já filtrado.
   */
  ignoreUrls?: string[];
  /**
   * Nomes de header a mascarar antes de enviar ao Studio (ex.: ["authorization"]).
   */
  redactHeaders?: string[];
}

/**
 * Módulo de Logs. Instrumenta `console.*` (com passthrough — o Metro continua
 * recebendo tudo) e as falhas globais do JS em desenvolvimento. `logs: true`
 * liga com os padrões; um objeto abaixo ajusta o comportamento.
 */
export interface NativeScopeLogsModuleConfig {
  /**
   * Níveis capturados. Fora desta lista o console segue intacto e nada é
   * emitido. Default: ["debug", "log", "info", "warn", "error"].
   */
  levels?: Array<"debug" | "log" | "info" | "warn" | "error">;
  /**
   * Teto de chars do JSON de UM argumento enviado ao Studio. Acima disto o
   * objeto é reserializado com cortes (o JSON que chega é sempre válido).
   * Default: 8192.
   */
  maxArgLength?: number;
  /** Profundidade máxima ao serializar objetos. Default: 6. */
  maxDepth?: number;
  /** Máximo de entradas por lote enviado ao Studio. Default: 200. */
  maxBatchEntries?: number;
  /** Janela de acúmulo antes de enviar um lote, em ms. Default: 120. */
  flushMs?: number;
  /**
   * Teto duro de logs por segundo. O excedente é descartado e contabilizado —
   * o Studio mostra quantos caíram. Default: 500.
   */
  maxPerSecond?: number;
  /**
   * Quantas entradas reter enquanto o Studio ainda não conectou. É o que salva
   * os logs de startup. Default: 500.
   */
  preReadyBuffer?: number;
  /** Mensagens a ignorar (match por substring). */
  ignorePatterns?: string[];
  /**
   * Redação de segredos. LIGADA por padrão: o valor de chaves como `token`,
   * `password`, `secret`, `authorization`, `apiKey`, `creditCard` e afins vira
   * `«redacted»` ANTES de sair do device — o getter nem chega a ser chamado.
   *
   * A comparação é por substring sobre a chave normalizada (minúscula, sem
   * `_`, `-` ou `.`), então `accessToken`, `access_token` e `API-KEY` caem
   * todas. Passe `false` para desligar quando precisar depurar o valor.
   *
   * Cobre chaves de OBJETO e de Map. Não alcança um segredo passado solto como
   * string — `console.log("token", t)` não tem chave para casar.
   */
  redact?: boolean;
  /**
   * Chaves extras a redigir, SOMADAS aos defaults (ex.: ["cpf", "deviceId"]).
   * Mesma normalização e mesmo match por substring.
   */
  redactKeys?: string[];
  /** Teto de chars da mensagem renderizada na lista. Default: 4096. */
  maxMessageLength?: number;
  /** Argumentos além disto viram um marcador. Default: 12. */
  maxArgs?: number;
  /** Chaves por objeto ao serializar. Default: 100. */
  maxKeys?: number;
  /** Itens por array ao serializar. Default: 100. */
  maxArrayItems?: number;
  /** Corte de strings DENTRO de objetos (o argumento tem outro teto). Default: 2048. */
  maxStringLength?: number;
  /**
   * Teto de chars por lote, bem abaixo do orçamento de fio de 256 KB.
   * Default: 98304.
   */
  maxBatchChars?: number;
}

export interface NativeScopeModulesConfig {
  /**
   * Módulo de Storage (AsyncStorage, MMKV, expo-sqlite, op-sqlite). `true` liga com os
   * padrões; um objeto liga com opções (indicator, reactQuery).
   */
  storage?: boolean | NativeScopeStorageModuleConfig;
  /**
   * Módulo de Network (fetch/XHR/WebSocket) — opt-in, instalado separadamente.
   * `true` liga o slot; as opções vêm com o módulo.
   */
  network?: boolean | NativeScopeNetworkModuleConfig;
  /**
   * Módulo de Logs (console.*, exceptions, rejections) — opt-in. `true` liga o
   * slot com os padrões; um objeto ajusta captura e volume.
   */
  logs?: boolean | NativeScopeLogsModuleConfig;
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

/** Igual ao `useInspectedSqlite`, para `@op-engineering/op-sqlite`. */
export function useInspectedOpSqlite<T = unknown>(
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
