import { describe, expect, it } from "vitest";
import { createSqliteAdapter, type DatabaseChange, type SQLiteDatabaseLike } from "@rnsi/runtime";
import { createNodeSqlite } from "./fakes/sqlite.ts";

/**
 * Exclusão em lote.
 *
 * O que estes testes protegem é uma característica de PERFORMANCE, então a
 * asserção principal não é "apagou", é "apagou em quantos round-trips". Antes,
 * o Studio apagava linha a linha: 20ms por linha medidos, ~5,6 horas para 1M.
 */

const SETUP = `
  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL
  );
  CREATE TABLE composite (
    a TEXT NOT NULL,
    b INTEGER NOT NULL,
    payload TEXT,
    PRIMARY KEY (a, b)
  ) WITHOUT ROWID;
`;

/** Conta as chamadas ao driver — é o que a mudança promete reduzir. */
function counting(base: SQLiteDatabaseLike): SQLiteDatabaseLike & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    getAllAsync: (sql, params) => base.getAllAsync(sql, params),
    runAsync: (sql, params) => {
      calls.push(sql.replace(/\s+/g, " ").trim());
      return base.runAsync(sql, params);
    },
  };
}

function setup(rows: number): {
  adapter: ReturnType<typeof createSqliteAdapter>;
  db: ReturnType<typeof counting>;
  raw: ReturnType<typeof createNodeSqlite>["raw"];
  changes: DatabaseChange[];
} {
  const node = createNodeSqlite(SETUP);
  const insert = node.raw.prepare("INSERT INTO events (kind) VALUES (?)");
  for (let i = 0; i < rows; i += 1) insert.run(`k${i}`);
  const db = counting(node);
  const adapter = createSqliteAdapter({ providerId: "t", label: "T" });
  adapter.registerDatabase("db", db);
  const changes: DatabaseChange[] = [];
  adapter.subscribe("db", (c) => changes.push(c));
  return { adapter, db, raw: node.raw, changes };
}

const count = (raw: ReturnType<typeof createNodeSqlite>["raw"], table: string): number =>
  Number((raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);

describe("deleteAll", () => {
  it("esvazia a tabela com UM statement e reporta as linhas afetadas", async () => {
    const { adapter, db, raw } = setup(1_000);

    const result = await adapter.deleteAll("db", "events");

    expect(count(raw, "events")).toBe(0);
    expect(result.rowsAffected).toBe(1_000);
    // O ponto inteiro da mudança: um DELETE, não mil.
    expect(db.calls).toEqual(['DELETE FROM "events"']);
  });

  it("sem WHERE nenhum — é o caminho da truncate optimization", async () => {
    const { adapter, db } = setup(10);
    await adapter.deleteAll("db", "events");

    expect(db.calls[0]).not.toMatch(/where/i);
  });

  it("emite UM evento de studio, não um por linha", async () => {
    const { adapter, changes } = setup(500);

    await adapter.deleteAll("db", "events");

    expect(changes).toEqual([
      { table: "events", rowId: null, operation: "delete", source: "studio" },
    ]);
  });

  it("suprime a tempestade de eventos do hook nativo do mesmo lote", async () => {
    const { adapter, changes } = setup(5);
    await adapter.deleteAll("db", "events");
    // O hook nativo entregaria um evento por linha; com o lote já anunciado,
    // eles não devem virar cinco linhas na timeline.
    for (let rowId = 1; rowId <= 5; rowId += 1) {
      adapter.notifyNativeChange("db", "events", rowId, "DELETE");
    }

    expect(changes).toHaveLength(1);
  });

  it("nome de tabela é sempre quotado — sem injeção", async () => {
    const node = createNodeSqlite(`CREATE TABLE "we;ird" (v TEXT); INSERT INTO "we;ird" VALUES ('x');`);
    const adapter = createSqliteAdapter({ providerId: "t", label: "T" });
    adapter.registerDatabase("db", node);

    const result = await adapter.deleteAll("db", "we;ird");

    expect(result.rowsAffected).toBe(1);
  });

  it("tabela inexistente vira rejeição, não crash", async () => {
    const { adapter } = setup(1);
    await expect(adapter.deleteAll("db", "nope")).rejects.toThrow(/no such table/i);
  });

  it("falha não engole os eventos legítimos do app", async () => {
    const { adapter, changes } = setup(1);
    await expect(adapter.deleteAll("db", "nope")).rejects.toThrow();

    // A janela de supressão foi liberada, então o app volta a ser ouvido.
    adapter.notifyNativeChange("db", "events", 1, "INSERT");
    expect(changes).toEqual([
      { table: "events", rowId: 1, operation: "insert", source: "app" },
    ]);
  });

  it("invalida a contagem — o grid não mostra linhas que não existem mais", async () => {
    const { adapter } = setup(300);
    const before = await adapter.tables("db");
    expect(before.find((t) => t.name === "events")?.rowCount).toBe(300);

    await adapter.deleteAll("db", "events");

    const after = await adapter.tables("db");
    expect(after.find((t) => t.name === "events")?.rowCount).toBe(0);
  });
});

describe("deleteRows", () => {
  it("apaga por rowid em UM round-trip, não um por linha", async () => {
    const { adapter, db, raw } = setup(100);
    const refs = Array.from({ length: 100 }, (_, i) => ({ rowid: i + 1 }));

    const result = await adapter.deleteRows("db", "events", refs);

    expect(count(raw, "events")).toBe(0);
    expect(result.rowsAffected).toBe(100);
    // BEGIN + 1 DELETE + COMMIT = 3 chamadas para 100 linhas.
    expect(db.calls).toHaveLength(3);
    expect(db.calls[0]).toBe("BEGIN IMMEDIATE");
    expect(db.calls[1]).toMatch(/^DELETE FROM "events" WHERE rowid IN \(\?(, \?){99}\)$/);
    expect(db.calls[2]).toBe("COMMIT");
  });

  it("divide em blocos que respeitam o teto de variáveis do SQLite", async () => {
    const { adapter, db, raw } = setup(1_200);
    const refs = Array.from({ length: 1_200 }, (_, i) => ({ rowid: i + 1 }));

    const result = await adapter.deleteRows("db", "events", refs);

    expect(count(raw, "events")).toBe(0);
    expect(result.rowsAffected).toBe(1_200);
    const deletes = db.calls.filter((sql) => sql.startsWith("DELETE"));
    // 1.200 / 500 = 3 statements. Não 1.200.
    expect(deletes).toHaveLength(3);
    // Nenhum statement passa do teto conservador de 500 variáveis.
    for (const sql of deletes) {
      expect((sql.match(/\?/g) ?? []).length).toBeLessThanOrEqual(500);
    }
  });

  it("apaga por PK composta usando row values", async () => {
    const { adapter, raw } = setup(0);
    raw.exec(`INSERT INTO composite VALUES ('x',1,'a'), ('y',2,'b'), ('z',3,'c');`);

    const result = await adapter.deleteRows("db", "composite", [
      { pk: { a: "x", b: 1 } },
      { pk: { a: "z", b: 3 } },
    ]);

    expect(result.rowsAffected).toBe(2);
    expect(count(raw, "composite")).toBe(1);
    expect(raw.prepare("SELECT a FROM composite").all()).toEqual([{ a: "y" }]);
  });

  it("a ordem das colunas da PK vem do schema, não das chaves do objeto", async () => {
    const { adapter, raw } = setup(0);
    raw.exec(`INSERT INTO composite VALUES ('x',1,'a'), ('y',2,'b');`);

    // `b` antes de `a` de propósito: se usássemos Object.keys, a tupla sairia
    // com os valores trocados e apagaria a linha errada (ou nenhuma).
    const result = await adapter.deleteRows("db", "composite", [{ pk: { b: 1, a: "x" } }]);

    expect(result.rowsAffected).toBe(1);
    expect(raw.prepare("SELECT a FROM composite").all()).toEqual([{ a: "y" }]);
  });

  it("PK incompleta é erro claro em vez de apagar a linha errada", async () => {
    const { adapter } = setup(0);
    await expect(adapter.deleteRows("db", "composite", [{ pk: { a: "x" } }])).rejects.toThrow(
      /missing column "b"/,
    );
  });

  it("é atômico: erro no meio do lote não deixa exclusão parcial", async () => {
    const { adapter, raw } = setup(10);
    // Um trigger que aborta ao tentar apagar a linha 7.
    raw.exec(`
      CREATE TRIGGER guard BEFORE DELETE ON events WHEN old.id = 7
      BEGIN SELECT RAISE(ABORT, 'protegida'); END;
    `);
    const refs = Array.from({ length: 10 }, (_, i) => ({ rowid: i + 1 }));

    await expect(adapter.deleteRows("db", "events", refs)).rejects.toThrow(/protegida/);

    // Ou todas, ou nenhuma. Linha a linha isto teria deixado 6 apagadas.
    expect(count(raw, "events")).toBe(10);
  });

  it("emite UM evento de lote, não um por linha", async () => {
    const { adapter, changes } = setup(50);
    const refs = Array.from({ length: 50 }, (_, i) => ({ rowid: i + 1 }));

    await adapter.deleteRows("db", "events", refs);

    expect(changes).toEqual([
      { table: "events", rowId: null, operation: "delete", source: "studio" },
    ]);
  });

  it("lista vazia não toca o banco", async () => {
    const { adapter, db, changes } = setup(5);

    expect(await adapter.deleteRows("db", "events", [])).toEqual({ rowsAffected: 0 });
    expect(db.calls).toEqual([]);
    expect(changes).toEqual([]);
  });

  it("refs que não existem mais: apaga o que existe e reporta o real", async () => {
    const { adapter, raw } = setup(3);

    const result = await adapter.deleteRows("db", "events", [
      { rowid: 1 },
      { rowid: 999 },
      { rowid: 3 },
    ]);

    expect(result.rowsAffected).toBe(2);
    expect(count(raw, "events")).toBe(1);
  });
});
