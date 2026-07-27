import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(currentDir, "../metro/shims/async-storage.js"), "utf8");

type Bootstrap = {
  getRuntime: () => unknown;
  rnsi: Record<string, unknown>;
  isModuleEnabled: (key: string) => boolean;
};

function runShim(bootstrap: Bootstrap): { module: { exports: unknown }; real: object } {
  const asyncStorage: Record<string, unknown> = {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  };
  const real: Record<string, unknown> = {};
  Object.defineProperty(real, "default", { enumerable: true, get: () => asyncStorage });

  const module = { exports: {} as unknown };
  const sandboxRequire = (id: string): unknown => {
    if (id === "@react-native-async-storage/async-storage") return real;
    if (id === "./_bootstrap.js") return bootstrap;
    return require(id);
  };

  vm.runInNewContext(source, {
    require: sandboxRequire,
    module,
    exports: module.exports,
    console,
  });
  return { module, real };
}

describe("AsyncStorage shim", () => {
  it("nao tenta sobrescrever export default somente-leitura", () => {
    expect(() => {
      runShim({ getRuntime: () => null, rnsi: {}, isModuleEnabled: () => true });
    }).not.toThrow();
  });

  it("gating: storage desligado → passthrough, sem sequer chamar getRuntime", () => {
    let getRuntimeCalled = false;
    const { module, real } = runShim({
      getRuntime: () => {
        getRuntimeCalled = true;
        return null;
      },
      rnsi: {},
      isModuleEnabled: () => false,
    });
    expect(getRuntimeCalled).toBe(false);
    expect(module.exports).toBe(real);
  });

  it("gating: storage ligado → instrumenta (registra o adapter)", () => {
    const registered: unknown[] = [];
    runShim({
      getRuntime: () => ({ registry: { register: (a: unknown) => registered.push(a) } }),
      rnsi: { createAsyncStorageAdapter: () => ({ notifyAppWrite: () => {} }) },
      isModuleEnabled: () => true,
    });
    expect(registered).toHaveLength(1);
  });
});
