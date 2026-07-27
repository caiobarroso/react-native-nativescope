import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { computeEnabledModules, NO_CONFIG_SENTINEL } = require("../metro/modules.cjs") as {
  computeEnabledModules: (config: unknown) => {
    enabled: Record<string, boolean>;
    source: "legacy-default" | "config";
  };
  NO_CONFIG_SENTINEL: string;
};
const { findConfigFile, loadConfigObject, resolveEnabledModules } = require(
  "../metro/module-config.cjs",
) as {
  findConfigFile: (dir: string) => string | null;
  loadConfigObject: (dir: string) => { path: string | null; config: unknown; unreadable: boolean };
  resolveEnabledModules: (dir: string) => {
    enabled: Record<string, boolean>;
    source: string;
    configPath: string | null;
    unreadable: boolean;
  };
};

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), "rnsi-modcfg-"));
}

describe("computeEnabledModules — regra única de habilitação", () => {
  it("sem config (null) → default legado: storage ligado", () => {
    const { enabled, source } = computeEnabledModules(null);
    expect(source).toBe("legacy-default");
    expect(enabled.storage).toBe(true);
  });

  it("sentinela de config-ausente → default legado", () => {
    const { enabled, source } = computeEnabledModules({ [NO_CONFIG_SENTINEL]: true });
    expect(source).toBe("legacy-default");
    expect(enabled.storage).toBe(true);
  });

  it("config presente é a fonte da verdade: storage não-listado = desligado", () => {
    const { enabled, source } = computeEnabledModules({ modules: {} });
    expect(source).toBe("config");
    expect(enabled.storage).toBe(false);
  });

  it("storage: false desliga explicitamente", () => {
    expect(computeEnabledModules({ modules: { storage: false } }).enabled.storage).toBe(false);
  });

  it("storage: true liga", () => {
    expect(computeEnabledModules({ modules: { storage: true } }).enabled.storage).toBe(true);
  });

  it("objeto de config (ex.: { indicator: true }) liga o módulo", () => {
    expect(
      computeEnabledModules({ modules: { storage: { indicator: true } } }).enabled.storage,
    ).toBe(true);
  });

  it("config só com outro módulo mantém storage desligado (opt-in do 'quero só network')", () => {
    // network ainda não está no manifesto, mas o importante: storage fica off.
    expect(computeEnabledModules({ modules: { network: true } }).enabled.storage).toBe(false);
  });
});

describe("findConfigFile / loadConfigObject / resolveEnabledModules (contexto Node)", () => {
  it("sem arquivo de config → legado, configPath null", () => {
    const dir = tmpProject();
    try {
      expect(findConfigFile(dir)).toBeNull();
      const r = resolveEnabledModules(dir);
      expect(r.configPath).toBeNull();
      expect(r.source).toBe("legacy-default");
      expect(r.enabled.storage).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("config .js com storage:false → storage desligado, source config", () => {
    const dir = tmpProject();
    try {
      writeFileSync(
        join(dir, "nativescope.config.js"),
        "module.exports = { modules: { storage: false } };",
      );
      const r = resolveEnabledModules(dir);
      expect(r.configPath).toContain("nativescope.config.js");
      expect(r.source).toBe("config");
      expect(r.enabled.storage).toBe(false);
      expect(r.unreadable).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("config exportando uma função (factory) é avaliado", () => {
    const dir = tmpProject();
    try {
      writeFileSync(
        join(dir, "nativescope.config.js"),
        "module.exports = () => ({ modules: { storage: true } });",
      );
      const { config } = loadConfigObject(dir);
      expect(computeEnabledModules(config).enabled.storage).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("config .ts → unreadable no Node, mas configPath preenchido (CLI não imprime 'sem config')", () => {
    const dir = tmpProject();
    try {
      writeFileSync(
        join(dir, "nativescope.config.ts"),
        "export default { modules: { storage: false } };",
      );
      const r = resolveEnabledModules(dir);
      expect(r.unreadable).toBe(true);
      expect(r.configPath).toContain("nativescope.config.ts");
      // Fallback para o texto: não conseguimos ler o .ts no Node; o gating real
      // é em runtime. Assumimos legado só para a mensageria.
      expect(r.source).toBe("legacy-default");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("precedência: nativescope.config.js vence rnsi.config.js", () => {
    const dir = tmpProject();
    try {
      writeFileSync(join(dir, "rnsi.config.js"), "module.exports = { modules: {} };");
      writeFileSync(
        join(dir, "nativescope.config.js"),
        "module.exports = { modules: { storage: true } };",
      );
      expect(findConfigFile(dir)).toContain("nativescope.config.js");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
