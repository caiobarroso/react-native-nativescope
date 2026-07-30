"use strict";

const GLOBAL_KEY = "__RNSI_APP_DEVTOOLS__";
const REACT_QUERY_BRIDGE_KEY = "__RNSI_REACT_QUERY_BRIDGES__";

function getBus() {
  const root = globalThis;
  if (!root[GLOBAL_KEY]) {
    root[GLOBAL_KEY] = { version: 0, lastEvent: null, listeners: new Set() };
  }
  return root[GLOBAL_KEY];
}

function eventMatches(event, filter) {
  if (!filter) return true;
  if (filter.kind && event.kind !== filter.kind) return false;
  if (filter.providerId && event.providerId !== filter.providerId) return false;
  if (filter.instanceId && event.instanceId !== filter.instanceId) return false;
  if (filter.key && event.key !== filter.key) return false;
  if (filter.table && event.table !== filter.table) return false;
  if (filter.source && event.source !== filter.source) return false;
  return true;
}

function getReactQueryBridges() {
  const root = globalThis;
  if (!root[REACT_QUERY_BRIDGE_KEY]) {
    root[REACT_QUERY_BRIDGE_KEY] = new WeakMap();
  }
  return root[REACT_QUERY_BRIDGE_KEY];
}

function normalizeReactQueryOptions(input) {
  if (!input) return null;
  const queryClient =
    typeof input.invalidateQueries === "function" ? input : input.queryClient;
  if (!queryClient || typeof queryClient.invalidateQueries !== "function") {
    if (typeof console !== "undefined" && typeof console.warn === "function") {
      console.warn(
        "[nativescope] reactQuery must be a QueryClient or { queryClient }.",
      );
    }
    return null;
  }
  return {
    queryClient,
    queryKey: input.queryKey,
    eventFilter: input.eventFilter,
    shouldInvalidate: input.shouldInvalidate,
  };
}

function invalidateReactQuery(queryClient, queryKey) {
  try {
    const result =
      queryKey === undefined
        ? queryClient.invalidateQueries()
        : queryClient.invalidateQueries({ queryKey });
    if (result && typeof result.catch === "function") {
      result.catch(() => {});
    }
  } catch {
    /* devtool bridge nunca pode derrubar o app */
  }
}

function installReactQueryBridge(reactQuery) {
  const options = normalizeReactQueryOptions(reactQuery);
  if (!options) return () => {};

  const bridges = getReactQueryBridges();
  const previous = bridges.get(options.queryClient);
  if (previous) return previous.dispose;

  const filter = { source: "studio", ...(options.eventFilter || {}) };
  const unsubscribe = subscribeNativeScope((event) => {
    if (
      typeof options.shouldInvalidate === "function" &&
      !options.shouldInvalidate(event)
    ) {
      return;
    }
    invalidateReactQuery(options.queryClient, options.queryKey);
  }, filter);

  const dispose = () => {
    unsubscribe();
    bridges.delete(options.queryClient);
  };
  bridges.set(options.queryClient, { dispose });
  return dispose;
}

function installNativeScopeDevtools(options = {}) {
  getBus();
  const disposers = [];
  const reactQuery = options.modules?.storage?.reactQuery;
  if (reactQuery) {
    disposers.push(installReactQueryBridge(reactQuery));
  }
  return {
    subscribe: subscribeNativeScope,
    getSnapshot: getNativeScopeSnapshot,
    dispose() {
      for (const dispose of disposers) dispose();
    },
  };
}

function getNativeScopeSnapshot() {
  const bus = getBus();
  return { version: bus.version, lastEvent: bus.lastEvent };
}

function subscribeNativeScope(listener, filter) {
  const bus = getBus();
  const wrapped = (event) => {
    if (eventMatches(event, filter)) listener(event);
  };
  bus.listeners.add(wrapped);
  return () => bus.listeners.delete(wrapped);
}

function useNativeScopeSignal(filter) {
  const React = require("react");
  const getSnapshot = React.useCallback(() => getBus().version, []);
  const filterKey = JSON.stringify(filter || {});
  const subscribe = React.useCallback(
    (notify) => subscribeNativeScope(() => notify(), filter),
    [filterKey],
  );
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function asyncStorageModule() {
  // Quando o projeto não tem AsyncStorage instalado, o resolver do
  // NativeScope entrega um stub null (ver withNativeScope) para o
  // bundle não quebrar. O erro amigável só acontece se o hook for USADO.
  const mod = require("@react-native-async-storage/async-storage");
  const storage = mod && (mod.default || mod);
  if (!storage) {
    throw new Error(
      "[nativescope] useInspectedAsyncStorage requires @react-native-async-storage/async-storage in this app.",
    );
  }
  return storage;
}

function readMmkvValue(instance, key) {
  const asString = instance.getString?.(key);
  if (asString !== undefined) return asString;
  const asNumber = instance.getNumber?.(key);
  if (asNumber !== undefined) return asNumber;
  const asBoolean = instance.getBoolean?.(key);
  if (asBoolean !== undefined) return asBoolean;
  const asBuffer = instance.getBuffer?.(key);
  if (asBuffer !== undefined) return asBuffer;
  return undefined;
}

function useInspectedAsyncStorage(key, options = {}) {
  const React = require("react");
  const [value, setValueState] = React.useState(undefined);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const signal = useNativeScopeSignal({
    kind: "key-value",
    providerId: "async-storage",
    instanceId: "default",
    key,
    source: options.source,
  });

  const reload = React.useCallback(async () => {
    setLoading(true);
    try {
      setValueState(await asyncStorageModule().getItem(key));
      setError(null);
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }, [key]);

  React.useEffect(() => {
    void reload();
  }, [reload, signal]);

  const setValue = React.useCallback(
    async (next) => {
      await asyncStorageModule().setItem(key, next);
      await reload();
    },
    [key, reload],
  );
  const removeValue = React.useCallback(async () => {
    await asyncStorageModule().removeItem(key);
    await reload();
  }, [key, reload]);

  // Objeto nomeado, não tupla: ninguém lembra a ordem do 3º item.
  return { value, setValue, removeValue, loading, error, reload };
}

function useInspectedMMKV(instance, key, options = {}) {
  const React = require("react");
  const [value, setValueState] = React.useState(() => readMmkvValue(instance, key));
  const signal = useNativeScopeSignal({
    kind: "key-value",
    providerId: "mmkv",
    instanceId: options.instanceId,
    key,
    source: options.source,
  });

  const reload = React.useCallback(() => {
    setValueState(readMmkvValue(instance, key));
  }, [instance, key]);

  React.useEffect(() => {
    reload();
  }, [reload, signal]);

  React.useEffect(() => {
    const subscription = instance.addOnValueChangedListener?.((changedKey) => {
      if (changedKey === key) reload();
    });
    return () => subscription?.remove?.();
  }, [instance, key, reload]);

  const setValue = React.useCallback(
    (next) => {
      instance.set(key, next);
      reload();
    },
    [instance, key, reload],
  );
  const removeValue = React.useCallback(() => {
    instance.delete(key);
    reload();
  }, [instance, key, reload]);

  return { value, setValue, removeValue, reload };
}

/**
 * Reexecuta `query` quando o storage muda.
 *
 * IMPORTANTE: sem `options.table`, o hook reexecuta em QUALQUER mudança de
 * banco — passe a tabela sempre que a query for de uma tabela só.
 */
function useInspectedSqlite(db, query, params = [], options = {}) {
  const React = require("react");
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(Boolean(db));
  const [error, setError] = React.useState(null);
  const signal = useNativeScopeSignal({
    kind: "database",
    providerId: "expo-sqlite",
    instanceId: options.instanceId,
    table: options.table,
    source: options.source,
  });
  const paramsKey = JSON.stringify(params);

  const reload = React.useCallback(async () => {
    if (!db) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setRows(await db.getAllAsync(query, params));
      setError(null);
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }, [db, query, paramsKey]);

  React.useEffect(() => {
    void reload();
  }, [reload, signal]);

  return { rows, loading, error, reload };
}

/**
 * Igual ao useInspectedSqlite, para @op-engineering/op-sqlite.
 *
 * Hook separado porque as duas coisas que ele faz diferem por provider: filtra
 * eventos por `providerId` e lê as linhas do banco. O op-sqlite devolve
 * `{ rows }` de `execute()`, não `getAllAsync()`.
 */
function useInspectedOpSqlite(db, query, params = [], options = {}) {
  const React = require("react");
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(Boolean(db));
  const [error, setError] = React.useState(null);
  const signal = useNativeScopeSignal({
    kind: "database",
    providerId: "op-sqlite",
    instanceId: options.instanceId,
    table: options.table,
    source: options.source,
  });
  const paramsKey = JSON.stringify(params);

  const reload = React.useCallback(async () => {
    if (!db) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await db.execute(query, params);
      // Array simples desde a v9/v10; `_array` é apólice para as antigas.
      const next = Array.isArray(result?.rows)
        ? result.rows
        : Array.isArray(result?.rows?._array)
          ? result.rows._array
          : [];
      setRows(next);
      setError(null);
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, query, paramsKey]);

  React.useEffect(() => {
    void reload();
  }, [reload, signal]);

  return { rows, loading, error, reload };
}

function defineNativeScopeConfig(config = {}) {
  return config;
}

module.exports = {
  defineNativeScopeConfig,
  installNativeScopeDevtools,
  subscribeNativeScope,
  getNativeScopeSnapshot,
  useNativeScopeSignal,
  // nome preferido — sem jargão de implementação ("signal"):
  useStorageChanged: useNativeScopeSignal,
  useInspectedAsyncStorage,
  useInspectedMMKV,
  useInspectedSqlite,
  useInspectedOpSqlite,
};
