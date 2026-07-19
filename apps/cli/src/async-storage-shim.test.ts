import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const currentDir = dirname(fileURLToPath(import.meta.url));

describe("AsyncStorage shim", () => {
  it("nao tenta sobrescrever export default somente-leitura", () => {
    const source = readFileSync(join(currentDir, "../metro/shims/async-storage.js"), "utf8");
    const asyncStorage = { getItem: async () => null };
    const real = {};
    Object.defineProperty(real, "default", {
      enumerable: true,
      get: () => asyncStorage,
    });

    const module = { exports: {} };
    const sandboxRequire = (id: string) => {
      if (id === "@react-native-async-storage/async-storage") return real;
      if (id === "./_bootstrap.js") return { getRuntime: () => null, rnsi: {} };
      return require(id);
    };

    expect(() => {
      vm.runInNewContext(source, {
        require: sandboxRequire,
        module,
        exports: module.exports,
        console,
      });
    }).not.toThrow();
    expect(module.exports).toBe(real);
  });
});
