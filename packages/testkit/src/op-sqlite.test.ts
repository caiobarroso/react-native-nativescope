import { describe, expect, it, vi } from "vitest";
import {
  createOpSqliteAdapter,
  createOpSqliteInstance,
  isDdl,
  isFullTableDelete,
  mutationTable,
  opSqliteInstanceId,
  toSqliteDatabase,
  type DatabaseChange,
  type OpSqliteDatabaseLike,
  type OpSqliteUpdateEvent,
} from "@rnsi/runtime";
import { createFakeOpSqlite, type FakeOpSqlite } from "./fakes/op-sqlite.ts";

const SETUP = `
  CREATE TABLE photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    likes INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO photos (title, likes) VALUES ('praia', 3), ('serra', 7);
`;

interface Harness {
  db: FakeOpSqlite;
  adapter: ReturnType<typeof createOpSqliteAdapter>;
  instance: ReturnType<typeof createOpSqliteInstance>;
  changes: DatabaseChange[];
}

function setup(options: Parameters<typeof createFakeOpSqlite>[0] = {}): Harness {
  const db = createFakeOpSqlite({ setupSql: SETUP, ...options });
  const adapter = createOpSqliteAdapter();
  const instance = createOpSqliteInstance({ instanceId: "photos.db", adapter });
  instance.attach(db);
  adapter.registerDatabase("photos.db", instance.database, {
    hasChangeListener: instance.hasChangeListener(),
  });
  const changes: DatabaseChange[] = [];
  adapter.subscribe("photos.db", (c) => changes.push(c));
  return { db, adapter, instance, changes };
}

describe("op-sqlite — identidade", () => {
  it("providerId e label distinguem do expo-sqlite", () => {
    const adapter = createOpSqliteAdapter();
    expect(adapter.providerId).toBe("op-sqlite");
    expect(adapter.label).toBe("OP-SQLite");
  });

  it.each([
    [{ name: "app.db" }, "app.db"],
    [{ name: "app.db", location: "custom" }, "custom/app.db"],
    [{ name: "app.db", location: "" }, "app.db"],
    ["app.db", "app.db"],
    [{ location: "custom" }, null],
    [{}, null],
    [undefined, null],
  ])("instanceId de %j é %s", (options, expected) => {
    expect(opSqliteInstanceId(options)).toBe(expected);
  });

  it("encryptionKey nunca vaza para o instanceId", () => {
    expect(opSqliteInstanceId({ name: "a.db", encryptionKey: "s3cr3t" })).toBe("a.db");
  });
});

describe("op-sqlite — bridge", () => {
  it("o adapter inteiro funciona sobre execute (paridade com o core)", async () => {
    const { adapter } = setup();

    const tables = await adapter.tables("photos.db");
    expect(tables.map((t) => t.name)).toEqual(["photos"]);
    expect(tables[0]?.identity).toBe("rowid");
    expect(tables[0]?.columns.map((c) => c.name)).toEqual(["id", "title", "likes"]);

    const page = await adapter.rows("photos.db", "photos", { limit: 10, offset: 0 });
    expect(page.total).toBe(2);
    expect(page.rows.map((r) => r.cells["title"])).toEqual(["praia", "serra"]);
    expect(page.rows[0]?.ref).toEqual({ rowid: 1 });
  });

  it("insert devolve a ref pelo insertId; update e delete funcionam", async () => {
    const { adapter } = setup();

    const inserted = await adapter.insert("photos.db", "photos", { title: "cidade", likes: 1 });
    expect(inserted.ref).toEqual({ rowid: 3 });

    await adapter.update("photos.db", "photos", { rowid: 3 }, { likes: 42 });
    const cell = await adapter.cell("photos.db", "photos", { rowid: 3 }, "likes");
    expect(cell).toEqual({ data: "42", kind: "number" });

    await adapter.delete("photos.db", "photos", { rowid: 3 });
    const page = await adapter.rows("photos.db", "photos", { limit: 10, offset: 0 });
    expect(page.total).toBe(2);
  });

  it("insertId ausente degrada para ref null em vez de NaN", async () => {
    const db: OpSqliteDatabaseLike = {
      // rowsAffected 0 → o nativo não preenche insertId.
      execute: async () => ({ rows: [], rowsAffected: 0 }),
    };
    const bridge = toSqliteDatabase(() => db);

    expect(await bridge.runAsync("INSERT INTO t VALUES (1)")).toEqual({
      changes: 0,
      lastInsertRowId: Number.NaN,
    });
  });

  it("rows em array simples, no _array legado (op-sqlite <= v6) e ausente", async () => {
    const shapes: Array<[unknown, unknown[]]> = [
      [[{ a: 1 }], [{ a: 1 }]],
      [{ _array: [{ a: 2 }] }, [{ a: 2 }]],
      [undefined, []],
      [null, []],
    ];
    for (const [rows, expected] of shapes) {
      const bridge = toSqliteDatabase(() => ({ execute: async () => ({ rows }) }));
      expect(await bridge.getAllAsync("SELECT 1")).toEqual(expected);
    }
  });

  it("busca e export atravessam a bridge", async () => {
    const { adapter } = setup();

    const found = await adapter.search("photos.db", "serra", 10);
    expect(found.matches).toHaveLength(1);
    expect(found.matches[0]?.table).toBe("photos");

    const exported = [];
    for await (const row of adapter.exportRows("photos.db", "photos")) exported.push(row);
    expect(exported.map((r) => r["title"])).toEqual(["praia", "serra"]);
  });

  it("console SQL: SELECT devolve linhas, mutação devolve rowsAffected", async () => {
    const { adapter } = setup();

    const query = await adapter.execute("photos.db", "SELECT title FROM photos");
    expect(query).toEqual({ kind: "rows", columns: ["title"], rows: [{ title: "praia" }, { title: "serra" }] });

    const mutation = await adapter.execute("photos.db", "UPDATE photos SET likes = 0");
    expect(mutation).toEqual({ kind: "mutation", rowsAffected: 2 });
  });
});

describe("op-sqlite — updateHook (slot único)", () => {
  it("mudança do app chega com a operação REAL, não unknown", async () => {
    const { db, changes } = setup();
    await db.execute("INSERT INTO photos (title) VALUES ('nova')");

    expect(changes).toEqual([
      { table: "photos", rowId: 3, operation: "insert", source: "app" },
    ]);
  });

  it("UPDATE e DELETE com WHERE também vêm do hook com operação real", async () => {
    const { db, changes } = setup();
    await db.execute("UPDATE photos SET likes = 1 WHERE id = 1");
    await db.execute("DELETE FROM photos WHERE id = 2");

    expect(changes.map((c) => c.operation)).toEqual(["update", "delete"]);
  });

  it("o hook do app continua sendo chamado — não roubamos o slot", async () => {
    const { db, changes } = setup();
    const appHook = vi.fn();
    db.updateHook?.(appHook);

    await db.execute("INSERT INTO photos (title) VALUES ('x')");

    expect(appHook).toHaveBeenCalledTimes(1);
    expect(appHook.mock.calls[0]?.[0]).toMatchObject({ table: "photos", operation: "INSERT" });
    // E o nosso evento também saiu.
    expect(changes).toHaveLength(1);
  });

  it("o app registrando DEPOIS de nós não nos derruba (multiplex)", async () => {
    const { db, instance, changes } = setup();
    expect(instance.diagnostics()).toEqual({ updateHook: true, multiplex: true });
    // Só instalamos no nativo uma vez; o registro do app cai no multiplexador.
    db.updateHook?.(() => {});
    expect(db.hookInstalls).toBe(1);

    await db.execute("INSERT INTO photos (title) VALUES ('y')");
    expect(changes).toHaveLength(1);
  });

  it("updateHook(null) do app remove só o dele", async () => {
    const { db, changes } = setup();
    const appHook = vi.fn();
    db.updateHook?.(appHook);
    db.updateHook?.(null);

    await db.execute("INSERT INTO photos (title) VALUES ('z')");

    expect(appHook).not.toHaveBeenCalled();
    expect(changes).toHaveLength(1);
  });

  it("hook do app que lança não impede o nosso evento", async () => {
    const { db, changes } = setup();
    db.updateHook?.(() => {
      throw new Error("erro no app");
    });

    await expect(db.execute("INSERT INTO photos (title) VALUES ('w')")).rejects.toThrow("erro no app");
    // O finally garantiu o nosso evento mesmo com a exceção do app subindo.
    expect(changes).toHaveLength(1);
    expect(changes[0]?.operation).toBe("insert");
  });

  it("build sem updateHook (libsql/Turso): hasChangeListener false e sniff cobre tudo", async () => {
    const { db, instance, changes } = setup({ updateHook: false });

    expect(instance.hasChangeListener()).toBe(false);
    expect(instance.diagnostics()).toEqual({ updateHook: false, multiplex: false });

    await db.execute("INSERT INTO photos (title) VALUES ('sem hook')");
    // Sem hook nativo, o farejamento de SQL é a única fonte de evento.
    expect(changes).toEqual([
      { table: "photos", rowId: null, operation: "unknown", source: "app" },
    ]);
  });

  it("updateHook não sobrescrevível: instalamos mas não prometemos realtime", async () => {
    const { instance } = setup({ updateHookWritable: false });

    // O hook nativo entrou, mas ficamos passíveis de ser derrubados pelo app,
    // então não afirmamos hasChangeListener — o core passa a emitir direto.
    expect(instance.diagnostics()).toEqual({ updateHook: true, multiplex: false });
    expect(instance.hasChangeListener()).toBe(false);
  });
});

describe("op-sqlite — os buracos do updateHook", () => {
  it("DELETE sem WHERE (truncate optimization) gera evento pelo sniff", async () => {
    const { db, changes } = setup();
    await db.execute("DELETE FROM photos");

    // O hook nativo fica calado aqui; sem o sniff o Studio mostraria linhas
    // que não existem mais.
    expect(changes).toEqual([
      { table: "photos", rowId: null, operation: "delete", source: "app" },
    ]);
  });

  it("DDL invalida o cache de schema — ALTER TABLE aparece nas colunas", async () => {
    const { db, adapter } = setup();
    const before = await adapter.tables("photos.db");
    expect(before[0]?.columns.map((c) => c.name)).toEqual(["id", "title", "likes"]);

    await db.execute("ALTER TABLE photos ADD COLUMN caption TEXT");

    const after = await adapter.tables("photos.db");
    expect(after[0]?.columns.map((c) => c.name)).toEqual(["id", "title", "likes", "caption"]);
  });

  it("CREATE TABLE aparece na lista de tabelas", async () => {
    const { db, adapter } = setup();
    await db.execute("CREATE TABLE albums (id INTEGER PRIMARY KEY, name TEXT)");

    const tables = await adapter.tables("photos.db");
    expect(tables.map((t) => t.name)).toEqual(["albums", "photos"]);
  });

  it("setup multi-statement é farejado statement por statement", async () => {
    const { db, adapter } = setup();
    await db.execute("CREATE TABLE a (v TEXT); CREATE TABLE b (v TEXT);");

    const tables = await adapter.tables("photos.db");
    expect(tables.map((t) => t.name)).toEqual(["a", "b", "photos"]);
  });

  it("tx.execute dentro de transaction() é instrumentado", async () => {
    const { db, changes } = setup();

    await db.transaction?.(async (tx) => {
      const scoped = tx as { execute(sql: string): Promise<unknown> };
      // O tx é outro objeto: embrulhar db.execute não cobriria isto.
      await scoped.execute("DELETE FROM photos");
    });

    expect(changes).toEqual([
      { table: "photos", rowId: null, operation: "delete", source: "app" },
    ]);
  });

  it("executeBatch fareja cada comando", async () => {
    const { db, adapter } = setup();
    await db.executeBatch?.([
      ["CREATE TABLE t1 (v TEXT)"],
      ["INSERT INTO photos (title) VALUES (?)", ["batch"]],
    ]);

    const tables = await adapter.tables("photos.db");
    expect(tables.map((t) => t.name)).toContain("t1");
  });

  it("prepareStatement reexecutado dispara evento a cada execução", async () => {
    const { db, changes } = setup();
    const statement = db.prepareStatement?.("INSERT INTO photos (title) VALUES ('p')") as {
      execute(params?: unknown[]): Promise<unknown>;
    };

    await statement.execute();
    await statement.execute();

    expect(changes).toHaveLength(2);
    expect(changes.every((c) => c.operation === "insert")).toBe(true);
  });

  it("SELECT não gera evento", async () => {
    const { db, changes } = setup();
    await db.execute("SELECT * FROM photos");
    expect(changes).toEqual([]);
  });
});

describe("op-sqlite — ciclo close/reopen", () => {
  it("banco fechado responde com erro legível em vez de estourar no driver", async () => {
    const { db, adapter } = setup();
    db.close?.();

    await expect(adapter.tables("photos.db")).rejects.toThrow(
      'database "photos.db" was closed by the app',
    );
  });

  it("reopen do mesmo nome revive a instância (a bridge repõe o ponteiro)", async () => {
    const { db, adapter, instance } = setup();
    db.close?.();

    // registerDatabase é idempotente por instanceId, então sem o ponteiro
    // mutável o Studio ficaria preso ao banco fechado pelo resto da sessão.
    instance.attach(createFakeOpSqlite({ setupSql: SETUP }));

    const page = await adapter.rows("photos.db", "photos", { limit: 10, offset: 0 });
    expect(page.total).toBe(2);
  });

  it("attach do mesmo objeto duas vezes não duplica a instrumentação", async () => {
    const { db, instance, changes } = setup();
    instance.attach(db);

    await db.execute("INSERT INTO photos (title) VALUES ('uma vez')");

    expect(changes).toHaveLength(1);
    expect(db.hookInstalls).toBe(1);
  });
});

describe("op-sqlite — detecção de SQL", () => {
  it.each([
    ["DELETE FROM t", true],
    ["delete from \"t\"", true],
    ["DELETE FROM t;", true],
    ["DELETE FROM t WHERE id = 1", false],
    ["UPDATE t SET a = 1", false],
    ["SELECT * FROM t", false],
  ])("isFullTableDelete(%s) = %s", (sql, expected) => {
    expect(isFullTableDelete(sql)).toBe(expected);
  });

  it.each([
    ["CREATE TABLE t (v)", true],
    ["DROP TABLE t", true],
    ["ALTER TABLE t ADD COLUMN c TEXT", true],
    ["INSERT INTO t VALUES (1)", false],
  ])("isDdl(%s) = %s", (sql, expected) => {
    expect(isDdl(sql)).toBe(expected);
  });

  it.each([
    ["INSERT INTO photos (a) VALUES (1)", "photos"],
    ['UPDATE "photos" SET a = 1', "photos"],
    ["DELETE FROM photos WHERE id = 1", "photos"],
    ["CREATE TABLE IF NOT EXISTS photos (v)", "photos"],
    ["DROP TABLE photos", "photos"],
    ["VACUUM", null],
  ])("mutationTable(%s) = %s", (sql, expected) => {
    expect(mutationTable(sql)).toBe(expected);
  });
});

describe("op-sqlite — a instrumentação nunca quebra o app", () => {
  it("adapter que lança em notify não propaga para o execute do app", async () => {
    const db = createFakeOpSqlite({ setupSql: SETUP });
    const adapter = createOpSqliteAdapter();
    const instance = createOpSqliteInstance({
      instanceId: "photos.db",
      // Um adapter hostil: todo notify explode.
      adapter: new Proxy(adapter, {
        get(target, prop) {
          if (typeof prop === "string" && prop.startsWith("notify")) {
            return () => {
              throw new Error("boom");
            };
          }
          return Reflect.get(target, prop);
        },
      }),
    });
    instance.attach(db);

    await expect(db.execute("DELETE FROM photos")).resolves.toBeDefined();
  });

  it("objeto que não é banco op-sqlite é ignorado sem lançar", () => {
    const adapter = createOpSqliteAdapter();
    const instance = createOpSqliteInstance({ instanceId: "x", adapter });

    expect(() => instance.attach({} as OpSqliteDatabaseLike)).not.toThrow();
    expect(instance.hasChangeListener()).toBe(false);
  });

  /**
   * Captura o callback que instalamos no updateHook nativo, para poder disparar
   * payloads que um driver real nunca deveria mandar.
   */
  function captureDispatch(): {
    fire: (event: unknown) => void;
    changes: DatabaseChange[];
  } {
    const adapter = createOpSqliteAdapter();
    const instance = createOpSqliteInstance({ instanceId: "db", adapter });
    const captured: { dispatch?: (event: unknown) => void } = {};
    const db: OpSqliteDatabaseLike = {
      execute: async () => ({ rows: [], rowsAffected: 0 }),
      updateHook: (callback) => {
        captured.dispatch = callback as ((event: unknown) => void) | undefined;
      },
    };
    instance.attach(db);
    adapter.registerDatabase("db", instance.database, { hasChangeListener: true });
    const changes: DatabaseChange[] = [];
    adapter.subscribe("db", (c) => changes.push(c));

    const fire = captured.dispatch;
    if (!fire) throw new Error("o dispatch não foi instalado no updateHook");
    return { fire, changes };
  }

  it("operação desconhecida do hook é coagida para unknown", () => {
    const { fire, changes } = captureDispatch();

    fire({ table: "t", operation: "TRUNCATE", rowId: 1 });

    // Sem a coerção, "TRUNCATE" viajaria no database.changed e o safeParse do
    // Studio descartaria a mensagem INTEIRA — realtime morto sem log.
    expect(changes[0]?.operation).toBe("unknown");
  });

  it.each([
    [undefined, "*", null],
    [{}, "*", null],
    [{ table: "t" }, "t", null],
    [{ table: "t", rowId: "nao-numero" }, "t", null],
    [{ table: "t", rowId: 7, operation: null }, "t", 7],
  ])("payload estranho (%j) não derruba nada", (event, table, rowId) => {
    const { fire, changes } = captureDispatch();

    expect(() => fire(event as OpSqliteUpdateEvent)).not.toThrow();
    expect(changes[0]).toEqual({
      table,
      rowId,
      operation: "unknown",
      source: "app",
    });
  });
});
