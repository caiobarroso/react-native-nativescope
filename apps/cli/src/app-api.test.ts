import { createRequire } from "node:module";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { emitAppDevtoolsChange } from "@rnsi/runtime";

const require = createRequire(import.meta.url);
const appApi = require("../app/index.cjs") as {
  defineNativeScopeConfig: <T>(config: T) => T;
  installNativeScopeDevtools: (options?: {
    modules?: {
      storage?: {
        reactQuery?:
          | { invalidateQueries: (...args: unknown[]) => unknown }
          | {
              queryClient: { invalidateQueries: (...args: unknown[]) => unknown };
              queryKey?: readonly unknown[];
            };
      };
    };
  }) => { dispose?: () => void };
  subscribeNativeScope: (
    listener: (event: unknown) => void,
    filter?: Record<string, unknown>,
  ) => () => void;
  getNativeScopeSnapshot: () => { version: number; lastEvent: unknown };
};

beforeEach(() => {
  const root = globalThis as unknown as Record<string, unknown>;
  delete root["__RNSI_APP_DEVTOOLS__"];
  delete root["__RNSI_REACT_QUERY_BRIDGES__"];
  delete root["__RNSI_REACT_QUERY_BRIDGE_STATE__"];
});

describe("react-native-nativescope/app", () => {
  it("expõe helper de configuração tipável sem alterar o objeto", () => {
    const config = { modules: { storage: { reactQuery: true } } };
    expect(appApi.defineNativeScopeConfig(config)).toBe(config);
  });

  it("recebe eventos locais emitidos pelo runtime e respeita filtros", () => {
    appApi.installNativeScopeDevtools();
    const listener = vi.fn();
    const unsubscribe = appApi.subscribeNativeScope(listener, {
      providerId: "async-storage",
      key: "auth.token",
    });

    emitAppDevtoolsChange({
      kind: "key-value",
      providerId: "async-storage",
      instanceId: "default",
      key: "auth.token",
      change: "updated",
      source: "studio",
      entry: null,
      timestamp: 1,
    });
    emitAppDevtoolsChange({
      kind: "key-value",
      providerId: "async-storage",
      instanceId: "default",
      key: "other",
      change: "updated",
      source: "studio",
      entry: null,
      timestamp: 2,
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(appApi.getNativeScopeSnapshot().version).toBe(2);
    unsubscribe();
  });

  it("integra com React Query invalidando apenas mudanças vindas do Studio", () => {
    const queryClient = { invalidateQueries: vi.fn() };
    appApi.installNativeScopeDevtools({
      modules: { storage: { reactQuery: { queryClient, queryKey: ["schedule"] } } },
    });

    emitAppDevtoolsChange({
      kind: "key-value",
      providerId: "mmkv",
      instanceId: "proline-app-storage",
      key: "schedule-today-123",
      change: "updated",
      source: "app",
      entry: null,
      timestamp: 1,
    });
    emitAppDevtoolsChange({
      kind: "key-value",
      providerId: "mmkv",
      instanceId: "proline-app-storage",
      key: "schedule-today-123",
      change: "updated",
      source: "studio",
      entry: null,
      timestamp: 2,
    });

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["schedule"] });
  });

  it("não duplica bridge para o mesmo QueryClient", () => {
    const queryClient = { invalidateQueries: vi.fn() };
    const first = appApi.installNativeScopeDevtools({
      modules: { storage: { reactQuery: queryClient } },
    });
    appApi.installNativeScopeDevtools({ modules: { storage: { reactQuery: queryClient } } });

    emitAppDevtoolsChange({
      kind: "key-value",
      providerId: "mmkv",
      instanceId: "proline-app-storage",
      key: "k",
      change: "updated",
      source: "studio",
      entry: null,
      timestamp: 1,
    });

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    first.dispose?.();
  });
});
