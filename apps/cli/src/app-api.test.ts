import { createRequire } from "node:module";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { emitAppDevtoolsChange } from "@rnsi/runtime";

const require = createRequire(import.meta.url);
const appApi = require("../app/index.cjs") as {
  installStorageInspectorDevtools: () => unknown;
  subscribeStorageInspector: (
    listener: (event: unknown) => void,
    filter?: Record<string, unknown>,
  ) => () => void;
  getStorageInspectorSnapshot: () => { version: number; lastEvent: unknown };
};

beforeEach(() => {
  delete (globalThis as unknown as Record<string, unknown>)["__RNSI_APP_DEVTOOLS__"];
});

describe("react-native-storage-inspector/app", () => {
  it("recebe eventos locais emitidos pelo runtime e respeita filtros", () => {
    appApi.installStorageInspectorDevtools();
    const listener = vi.fn();
    const unsubscribe = appApi.subscribeStorageInspector(listener, {
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
    expect(appApi.getStorageInspectorSnapshot().version).toBe(2);
    unsubscribe();
  });
});
