import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMetroConfig } from "./metro-config.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rnsi-metro-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("ensureMetroConfig", () => {
  it("cria config novo para projeto Expo sem metro.config.js", () => {
    const result = ensureMetroConfig(dir, "expo");
    expect(result.status).toBe("created");
    const source = readFileSync(join(dir, "metro.config.js"), "utf8");
    expect(source).toContain("expo/metro-config");
    expect(source).toContain("withNativeScope");
  });

  it("cria config novo para projeto bare RN", () => {
    ensureMetroConfig(dir, "react-native");
    const source = readFileSync(join(dir, "metro.config.js"), "utf8");
    expect(source).toContain("@react-native/metro-config");
  });

  it("embrulha config existente preservando o original", () => {
    const original = `const { getDefaultConfig } = require("expo/metro-config");
module.exports = getDefaultConfig(__dirname);
`;
    writeFileSync(join(dir, "metro.config.js"), original);

    const result = ensureMetroConfig(dir, "expo");
    expect(result.status).toBe("wrapped");

    // original intacto no backup
    expect(readFileSync(join(dir, "metro.config.original.js"), "utf8")).toBe(original);
    // delegate requer o original e embrulha
    const delegate = readFileSync(join(dir, "metro.config.js"), "utf8");
    expect(delegate).toContain('require("./metro.config.original.js")');
    expect(delegate).toContain("withNativeScope");
  });

  it("é idempotente: segunda chamada não toca em nada", () => {
    writeFileSync(join(dir, "metro.config.js"), "module.exports = {};\n");
    ensureMetroConfig(dir, "expo");
    const afterFirst = readFileSync(join(dir, "metro.config.js"), "utf8");

    const second = ensureMetroConfig(dir, "expo");
    expect(second.status).toBe("already-wrapped");
    expect(readFileSync(join(dir, "metro.config.js"), "utf8")).toBe(afterFirst);
  });

  it("config já embrulhado manualmente não é tocado", () => {
    const source = `const { withNativeScope } = require("react-native-nativescope/metro");
module.exports = withNativeScope({});
`;
    writeFileSync(join(dir, "metro.config.js"), source);
    const result = ensureMetroConfig(dir, "expo");
    expect(result.status).toBe("already-wrapped");
    expect(existsSync(join(dir, "metro.config.original.js"))).toBe(false);
  });

  it("variante .cjs vira instrução manual, sem tocar em arquivos", () => {
    writeFileSync(join(dir, "metro.config.cjs"), "module.exports = {};\n");
    const result = ensureMetroConfig(dir, "expo");
    expect(result.status).toBe("manual");
    if (result.status === "manual") {
      expect(result.reason).toContain("metro.config.cjs");
    }
  });

  it("backup pré-existente aborta com instrução em vez de sobrescrever", () => {
    writeFileSync(join(dir, "metro.config.js"), "module.exports = {};\n");
    writeFileSync(join(dir, "metro.config.original.js"), "// sobra de antes\n");
    const result = ensureMetroConfig(dir, "expo");
    expect(result.status).toBe("manual");
    // nada foi alterado
    expect(readFileSync(join(dir, "metro.config.js"), "utf8")).toBe("module.exports = {};\n");
  });
});
