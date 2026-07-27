import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(currentDir, "../metro/shims/_bootstrap.js"), "utf8");

type BootstrapExports = {
  isModuleEnabled: (key: string) => boolean;
  bootModules: () => void;
  getRuntime: () => unknown;
};

function loadBootstrap(opts: { session?: unknown; config: unknown }): BootstrapExports & {
  startRuntimeCalls: () => number;
} {
  let startRuntimeCalls = 0;
  const rnsi = {
    installAppDevtoolsConfig() {},
    subscribeAppDevtoolsChange() {
      return () => {};
    },
    startRuntime() {
      startRuntimeCalls += 1;
      return { registry: { register() {}, describe: () => [], onRegister() {} }, close() {} };
    },
  };
  const module = { exports: {} as BootstrapExports };
  const sandboxRequire = (id: string): unknown => {
    if (id === "__rnsi_session__") return opts.session ?? null;
    if (id === "__rnsi_config__") return opts.config;
    if (id === "./runtime-bundle.js") return rnsi;
    if (id === "../modules.cjs") return require("../metro/modules.cjs");
    return require(id);
  };
  vm.runInNewContext(source, {
    require: sandboxRequire,
    module,
    exports: module.exports,
    console,
    Date,
    Math,
    setTimeout,
    clearTimeout,
  });
  return Object.assign(module.exports, { startRuntimeCalls: () => startRuntimeCalls });
}

describe("_bootstrap — isModuleEnabled / bootModules (gating em runtime)", () => {
  it("sem config (sentinela) → storage ligado (default legado)", () => {
    const b = loadBootstrap({ config: { __rnsiConfigAbsent: true } });
    expect(b.isModuleEnabled("storage")).toBe(true);
  });

  it("config só com network → storage desligado (opt-in)", () => {
    const b = loadBootstrap({ config: { modules: { network: true } } });
    expect(b.isModuleEnabled("storage")).toBe(false);
  });

  it("config com storage: false → desligado", () => {
    const b = loadBootstrap({ config: { modules: { storage: false } } });
    expect(b.isModuleEnabled("storage")).toBe(false);
  });

  it("config exportando função (defineNativeScopeConfig) é avaliado", () => {
    const b = loadBootstrap({ config: () => ({ modules: { storage: true } }) });
    expect(b.isModuleEnabled("storage")).toBe(true);
  });

  it("bootModules não sobe o runtime para storage-only (nenhum earlyBoot), mesmo com sessão", () => {
    // Sessão presente: se bootModules chamasse getRuntime, o startRuntime rodaria.
    // Como storage tem earlyBoot: false, não deve rodar.
    const b = loadBootstrap({
      session: { port: 4782, token: "t" },
      config: { __rnsiConfigAbsent: true },
    });
    expect(() => b.bootModules()).not.toThrow();
    expect(b.startRuntimeCalls()).toBe(0);
  });
});
