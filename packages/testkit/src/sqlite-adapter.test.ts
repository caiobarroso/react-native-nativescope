import { describe, expect, it } from "vitest";
import { createExpoSqliteAdapter, type DatabaseChange } from "@rnsi/runtime";
import { createNodeSqlite } from "./fakes/sqlite.ts";

const SETUP = `
  CREATE TABLE visits (
    id INTEGER PRIMARY KEY,
    status TEXT NOT NULL,
    pdv TEXT,
    startedAt TEXT
  );
  INSERT INTO visits (status, pdv, startedAt) VALUES
    ('done', 'Carrefour', '08:00'),
    ('pending', 'Pague Menos', NULL),
    ('done', 'Atacadão', '09:05');

  CREATE TABLE composite_pk (
    a TEXT NOT NULL,
    b INTEGER NOT NULL,
    payload TEXT,
    PRIMARY KEY (a, b)
  ) WITHOUT ROWID;
  INSERT INTO composite_pk VALUES ('x', 1, 'primeiro'), ('y', 2, 'segundo');

  CREATE TABLE no_identity_view_base (v TEXT);
`;

function setup() {
  const db = createNodeSqlite(SETUP);
  const adapter = createExpoSqliteAdapter();
  adapter.registerDatabase("app.db", db);
  const changes: DatabaseChange[] = [];
  adapter.subscribe("app.db", (c) => changes.push(c));
  return { db, adapter, changes };
}

describe("expo-sqlite adapter", () => {
  it("lista tabelas com schema, contagem e identidade", async () => {
    const { adapter } = setup();
    const tables = await adapter.tables("app.db");
    const byName = Object.fromEntries(tables.map((t) => [t.name, t]));

    expect(byName["visits"]?.identity).toBe("rowid");
    expect(byName["visits"]?.rowCount).toBe(3);
    expect(byName["visits"]?.columns.map((c) => c.name)).toEqual([
      "id",
      "status",
      "pdv",
      "startedAt",
    ]);
    expect(byName["visits"]?.columns[1]?.notNull).toBe(true);

    // WITHOUT ROWID com PK composta → identidade pk
    expect(byName["composite_pk"]?.identity).toBe("pk");
  });

  it("pagina, ordena e devolve refs estáveis", async () => {
    const { adapter } = setup();
    const page = await adapter.rows("app.db", "visits", {
      limit: 2,
      offset: 0,
      orderBy: "pdv",
      direction: "asc",
    });
    expect(page.total).toBe(3);
    expect(page.rows).toHaveLength(2);
    expect(page.rows[0]?.cells["pdv"]).toBe("Atacadão");
    expect(page.rows[0]?.ref).toEqual({ rowid: 3 });

    const rest = await adapter.rows("app.db", "visits", { limit: 2, offset: 2, orderBy: "pdv" });
    expect(rest.rows).toHaveLength(1);
  });

  it("rejeita orderBy que não é coluna — sem injeção", async () => {
    const { adapter } = setup();
    await expect(
      adapter.rows("app.db", "visits", {
        limit: 10,
        offset: 0,
        orderBy: "pdv; DROP TABLE visits",
      }),
    ).rejects.toThrow("coluna desconhecida");
  });

  it("edita célula por rowid e emite evento studio", async () => {
    const { adapter, db, changes } = setup();
    await adapter.update("app.db", "visits", { rowid: 2 }, { status: "done" });

    const check = await db.getAllAsync("SELECT status FROM visits WHERE id = 2");
    expect(check[0]?.["status"]).toBe("done");
    expect(changes).toEqual([
      { table: "visits", rowId: 2, operation: "update", source: "studio" },
    ]);
  });

  it("edita por PK composta em tabela WITHOUT ROWID", async () => {
    const { adapter, db } = setup();
    await adapter.update(
      "app.db",
      "composite_pk",
      { pk: { a: "x", b: 1 } },
      { payload: "editado" },
    );
    const check = await db.getAllAsync("SELECT payload FROM composite_pk WHERE a = 'x' AND b = 1");
    expect(check[0]?.["payload"]).toBe("editado");
  });

  it("insere e exclui linhas", async () => {
    const { adapter, db } = setup();
    await adapter.insert("app.db", "visits", { status: "pending", pdv: "Assaí" });
    expect((await db.getAllAsync("SELECT COUNT(*) AS n FROM visits"))[0]?.["n"]).toBe(4);

    await adapter.delete("app.db", "visits", { rowid: 1 });
    expect((await db.getAllAsync("SELECT COUNT(*) AS n FROM visits"))[0]?.["n"]).toBe(3);
  });

  it("console SQL: SELECT ganha LIMIT implícito e devolve linhas", async () => {
    const { adapter } = setup();
    const result = await adapter.execute("app.db", "SELECT * FROM visits WHERE status = 'done'");
    expect(result.kind).toBe("rows");
    if (result.kind === "rows") {
      expect(result.rows).toHaveLength(2);
      expect(result.columns).toContain("pdv");
    }
  });

  it("console SQL: LIMIT explícito é respeitado", async () => {
    const { adapter } = setup();
    const result = await adapter.execute("app.db", "SELECT * FROM visits LIMIT 1");
    if (result.kind === "rows") expect(result.rows).toHaveLength(1);
  });

  it("console SQL: mutação devolve rowsAffected", async () => {
    const { adapter } = setup();
    const result = await adapter.execute(
      "app.db",
      "UPDATE visits SET status = 'done' WHERE status = 'pending'",
    );
    expect(result).toMatchObject({ kind: "mutation", rowsAffected: 1 });
  });

  it("erro de SQL vira rejeição com mensagem — não crash", async () => {
    const { adapter } = setup();
    await expect(adapter.execute("app.db", "SELEC * FROM visits")).rejects.toThrow();
  });

  it("eco: hook nativo depois de mutação do Studio sai como studio; escrita do app sai como app", () => {
    const db = createNodeSqlite(SETUP);
    const adapter = createExpoSqliteAdapter();
    adapter.registerDatabase("app.db", db, { hasChangeListener: true });
    const changes: DatabaseChange[] = [];
    adapter.subscribe("app.db", (c) => changes.push(c));

    // mutação do Studio: marca pendente; o hook chega depois
    void adapter.update("app.db", "visits", { rowid: 1 }, { status: "done" });
    adapter.notifyNativeChange("app.db", "visits", 1);
    // escrita do app: hook chega sem pendente
    adapter.notifyNativeChange("app.db", "visits", 2);

    expect(changes.map((c) => c.source)).toEqual(["studio", "app"]);
  });

  it("banco desconhecido é erro estruturado", async () => {
    const adapter = createExpoSqliteAdapter();
    await expect(adapter.tables("ghost.db")).rejects.toThrow("unknown instance");
  });

  it("registro de banco é idempotente", () => {
    const adapter = createExpoSqliteAdapter();
    adapter.registerDatabase("a.db", createNodeSqlite());
    adapter.registerDatabase("a.db", createNodeSqlite());
    expect(adapter.instances()).toHaveLength(1);
  });
});
