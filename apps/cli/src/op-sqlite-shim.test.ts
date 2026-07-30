import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  createOpSqliteAdapter,
  createOpSqliteInstance,
  createRegistry,
  opSqliteInstanceId,
  type OpSqliteDatabaseLike,
} from "@rnsi/runtime";

const require = createRequire(import.meta.url);
const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(currentDir, "../metro/shims/op-sqlite.js"), "utf8");

/** Banco op-sqlite mínimo — o comportamento do adapter é testado no testkit. */
function fakeDb(options: { updateHookWritable?: boolean } = {}): OpSqliteDatabaseLike & {
  hooked: boolean;
} {
  const db = {
    hooked: false,
    execute: async () => ({ rows: [], rowsAffected: 0 }),
  } as OpSqliteDatabaseLike & { hooked: boolean };
  const install = (callback: unknown): void => {
    db.hooked = typeof callback === "function";
  };
  if (options.updateHookWritable === false) {
    // Simula um HostObject JSI cujo método não pode ser sobrescrito.
    Object.defineProperty(db, "updateHook", {
      value: install,
      writable: false,
      configurable: false,
      enumerable: true,
    });
  } else {
    db.updateHook = install;
  }
  return db;
}

interface RealModule {
  open?: (options: unknown) => unknown;
  openAsync?: (options: unknown) => Promise<unknown>;
  openSync?: (options: unknown) => unknown;
  openRemote?: (options: unknown) => unknown;
  isLibsql?: () => boolean;
}

function runShim(options: {
  real: RealModule;
  storageEnabled?: boolean;
  withSession?: boolean;
}): {
  exported: RealModule;
  registry: ReturnType<typeof createRegistry>;
  getRuntimeCalls: number;
  logs: string[];
} {
  const { real, storageEnabled = true, withSession = true } = options;
  const registry = createRegistry();
  let getRuntimeCalls = 0;
  const logs: string[] = [];

  // O rnsi REAL: o shim é só cola, então o teste vale mais integrado.
  const bootstrap = {
    isModuleEnabled: (key: string) => storageEnabled && key === "storage",
    getRuntime: () => {
      getRuntimeCalls += 1;
      return withSession ? { registry } : null;
    },
    rnsi: { createOpSqliteAdapter, createOpSqliteInstance, opSqliteInstanceId },
  };

  const moduleObject = { exports: {} as unknown };
  const sandboxRequire = (id: string): unknown => {
    if (id === "@op-engineering/op-sqlite") return real;
    if (id === "./_bootstrap.js") return bootstrap;
    return require(id);
  };

  vm.runInNewContext(source, {
    require: sandboxRequire,
    module: moduleObject,
    exports: moduleObject.exports,
    console: {
      ...console,
      log: (message: string) => logs.push(String(message)),
      warn: (message: string) => logs.push(String(message)),
    },
  });

  return { exported: moduleObject.exports as RealModule, registry, getRuntimeCalls, logs };
}

describe("op-sqlite shim", () => {
  it("gating: storage desligado → passthrough, sem sequer chamar getRuntime", () => {
    const real: RealModule = { open: () => fakeDb() };
    const { exported, getRuntimeCalls } = runShim({ real, storageEnabled: false });

    expect(exported).toBe(real);
    expect(getRuntimeCalls).toBe(0);
  });

  it("sem sessão da CLI → passthrough", () => {
    const real: RealModule = { open: () => fakeDb() };
    const { exported } = runShim({ real, withSession: false });

    expect(exported).toBe(real);
  });

  it("open registra o banco e instala o hook", () => {
    const db = fakeDb();
    const { exported, registry } = runShim({ real: { open: () => db } });

    const returned = exported.open?.({ name: "photos.db" });

    // O app recebe o MESMO objeto — instrumentação é in-place.
    expect(returned).toBe(db);
    expect(db.hooked).toBe(true);
    const provider = registry.describe()[0];
    expect(provider?.providerId).toBe("op-sqlite");
    expect(provider?.label).toBe("OP-SQLite");
    expect(provider?.instances.map((i) => i.instanceId)).toEqual(["photos.db"]);
  });

  it("openAsync também é instrumentado (chama o open interno, não o nosso)", async () => {
    const db = fakeDb();
    const { exported, registry } = runShim({
      real: { openAsync: async () => db },
    });

    await exported.openAsync?.({ name: "async.db" });

    expect(db.hooked).toBe(true);
    expect(registry.describe()[0]?.instances).toHaveLength(1);
  });

  it("location entra no instanceId — mesmo nome em diretórios diferentes não colide", () => {
    const { exported, registry } = runShim({ real: { open: () => fakeDb() } });

    exported.open?.({ name: "app.db" });
    exported.open?.({ name: "app.db", location: "backup" });

    expect(registry.describe()[0]?.instances.map((i) => i.instanceId)).toEqual([
      "app.db",
      "backup/app.db",
    ]);
  });

  it("reopen do mesmo nome não cria uma segunda instância", () => {
    const { exported, registry } = runShim({ real: { open: () => fakeDb() } });

    exported.open?.({ name: "app.db" });
    exported.open?.({ name: "app.db" });

    expect(registry.describe()[0]?.instances).toHaveLength(1);
  });

  it("abertura sem nome não instrumenta, mas devolve o banco", () => {
    const db = fakeDb();
    const { exported, registry } = runShim({ real: { open: () => db } });

    expect(exported.open?.({})).toBe(db);
    expect(registry.describe()[0]?.instances).toEqual([]);
  });

  it("options são repassadas intactas — nada de flag injetada", () => {
    const seen: unknown[] = [];
    const options = { name: "app.db", encryptionKey: "s3cr3t" };
    const { exported } = runShim({
      real: {
        open: (received) => {
          seen.push(received);
          return fakeDb();
        },
      },
    });

    exported.open?.(options);

    // Por referência: o expo precisa injetar enableChangeListener, o op-sqlite não.
    expect(seen[0]).toBe(options);
  });

  it("encryptionKey não aparece no instanceId nem no log", () => {
    const { exported, registry, logs } = runShim({ real: { open: () => fakeDb() } });

    exported.open?.({ name: "app.db", encryptionKey: "s3cr3t" });

    expect(registry.describe()[0]?.instances[0]?.instanceId).toBe("app.db");
    expect(logs.join("\n")).not.toContain("s3cr3t");
  });

  it("throw do driver propaga idêntico (openRemote fora de build libsql)", () => {
    const { exported } = runShim({
      real: {
        open: () => fakeDb(),
        openRemote: () => {
          throw new Error("This function is only available for libsql or turso backends");
        },
      },
    });

    expect(() => exported.openRemote?.({ name: "x" })).toThrow("only available for libsql");
  });

  it("função ausente no driver não é inventada", () => {
    const { exported } = runShim({ real: { open: () => fakeDb() } });

    // openSync/openRemote não existem neste build — o shim não deve criá-las.
    expect(Object.prototype.hasOwnProperty.call(exported, "openSync")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(exported, "openRemote")).toBe(false);
  });

  it("herda por protótipo: o resto do módulo continua acessível", () => {
    const real: RealModule & { IOS_LIBRARY_PATH?: string } = {
      open: () => fakeDb(),
      IOS_LIBRARY_PATH: "/Library",
    };
    const { exported } = runShim({ real });

    expect((exported as { IOS_LIBRARY_PATH?: string }).IOS_LIBRARY_PATH).toBe("/Library");
  });

  it("caminho feliz: NENHUM log — um devtool não fala quando está tudo certo", () => {
    const { exported, logs } = runShim({ real: { open: () => fakeDb() } });

    exported.open?.({ name: "a.db" });
    exported.open?.({ name: "b.db" });

    expect(logs).toEqual([]);
  });

  it("build sem updateHook: registra, avisa o que degradou, e não quebra", () => {
    const { exported, registry, logs } = runShim({
      real: { open: () => ({ execute: async () => ({ rows: [], rowsAffected: 0 }) }) },
    });

    exported.open?.({ name: "libsql.db" });
    exported.open?.({ name: "outro.db" });

    expect(registry.describe()[0]?.instances).toHaveLength(2);
    // Uma vez por sessão, não por banco.
    const warnings = logs.filter((line) => line.includes("op-sqlite:"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("updateHook");
    expect(warnings[0]).toContain("reading and editing still work");
  });

  it("updateHook não embrulhável: avisa que um ORM pode nos derrubar", () => {
    const { exported, logs } = runShim({
      real: { open: () => fakeDb({ updateHookWritable: false }) },
    });

    exported.open?.({ name: "hostobject.db" });

    const warnings = logs.filter((line) => line.includes("op-sqlite:"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("db.updateHook");
  });

  it("falha na instrumentação não impede o app de abrir o banco", () => {
    const db = fakeDb();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const moduleObject = { exports: {} as unknown };
    const sandboxRequire = (id: string): unknown => {
      if (id === "@op-engineering/op-sqlite") return { open: () => db };
      if (id === "./_bootstrap.js") {
        return {
          isModuleEnabled: () => true,
          getRuntime: () => ({ registry: createRegistry() }),
          // rnsi quebrado: o adapter nem existe.
          rnsi: {},
        };
      }
      return require(id);
    };

    expect(() => {
      vm.runInNewContext(source, {
        require: sandboxRequire,
        module: moduleObject,
        exports: moduleObject.exports,
        console,
      });
    }).not.toThrow();

    // Passthrough: o app continua funcionando sem inspetor.
    const exported = moduleObject.exports as RealModule;
    expect(exported.open?.({ name: "a.db" })).toBe(db);
    warn.mockRestore();
  });
});
