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

  it("keyset: afterRowid pagina sem OFFSET e mantém ordem por rowid", async () => {
    const { adapter } = setup();
    const first = await adapter.rows("app.db", "visits", { limit: 2, offset: 0 });
    expect(first.rows.map((r) => r.ref)).toEqual([{ rowid: 1 }, { rowid: 2 }]);

    const lastRef = first.rows[first.rows.length - 1]?.ref;
    if (!lastRef || !("rowid" in lastRef)) throw new Error("ref esperada");
    const second = await adapter.rows("app.db", "visits", {
      limit: 2,
      offset: 0,
      afterRowid: lastRef.rowid,
    });
    expect(second.rows.map((r) => r.ref)).toEqual([{ rowid: 3 }]);
  });

  it("tabela dentro do orçamento: contagem exata na hora, mesmo com buraco de rowid", async () => {
    const { adapter, db } = setup();
    // Buraco de rowid: MAX(rowid) = 3, COUNT(*) = 2. Era exatamente aqui que a
    // estimativa mentia — uma tabela com 14 linhas e rowid 20026 aparecia como
    // "≈ 20026". Abaixo do orçamento não há estimativa nenhuma.
    await db.runAsync("DELETE FROM visits WHERE id = 2");

    const page = await adapter.rows("app.db", "visits", { limit: 10, offset: 0 });
    expect(page.total).toBe(2);
    expect(page.totalIsEstimate).toBe(false);

    const tables = await adapter.tables("app.db");
    const visits = tables.find((t) => t.name === "visits");
    expect(visits?.rowCount).toBe(2);
    expect(visits?.rowCountIsEstimate).toBeFalsy();
  });

  it("acima do orçamento: estimativa imediata, exata após o background", async () => {
    const { adapter, db } = setup();
    // rowid acima do orçamento (50k) → COUNT(*) sai do caminho crítico.
    await db.runAsync("INSERT INTO visits (id, status) VALUES (60000, 'done')");

    const first = await adapter.rows("app.db", "visits", { limit: 10, offset: 0 });
    expect(first.total).toBe(60_000); // MAX(rowid), sem contagem exata anterior
    expect(first.totalIsEstimate).toBe(true);

    // O COUNT(*) exato roda em background e popula o cache.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await adapter.rows("app.db", "visits", { limit: 10, offset: 0 });
    expect(second.total).toBe(4);
    expect(second.totalIsEstimate).toBe(false);
  });

  it("estimativa de tabela grande parte da última contagem exata, não de MAX(rowid)", async () => {
    const { adapter, db } = setup();
    await db.runAsync("INSERT INTO visits (id, status) VALUES (60000, 'done')");

    // Primeira passada: estimativa + COUNT(*) em background = 4 exato.
    await adapter.rows("app.db", "visits", { limit: 10, offset: 0 });
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Uma escrita do app invalida a contagem. A estimativa seguinte tem de
    // partir de "tinha 4 linhas", não de MAX(rowid) = 60000.
    await db.runAsync("INSERT INTO visits (status) VALUES ('pending')");
    adapter.notifyNativeChange("app.db", "visits", 60_001, "insert");

    const page = await adapter.rows("app.db", "visits", { limit: 10, offset: 0 });
    expect(page.totalIsEstimate).toBe(true);
    expect(page.total).toBe(4); // erra por 1 linha, não por 59.996
  });

  it("célula grande chega truncada e marcada; database.cell devolve 100%", async () => {
    const { adapter, db } = setup();
    const big = "x".repeat(10_000);
    await db.runAsync("UPDATE visits SET pdv = ? WHERE id = 1", [big]);

    const page = await adapter.rows("app.db", "visits", { limit: 10, offset: 0 });
    const row = page.rows.find((r) => r.ref && "rowid" in r.ref && r.ref.rowid === 1);
    expect(row?.truncatedColumns).toEqual(["pdv"]);
    expect((row?.cells["pdv"] as string).length).toBe(4096);

    const cell = await adapter.cell("app.db", "visits", { rowid: 1 }, "pdv");
    expect(cell?.kind).toBe("text");
    expect(cell?.data).toBe(big);
  });

  it("cell devolve null para NULL e rejeita coluna desconhecida", async () => {
    const { adapter } = setup();
    expect(await adapter.cell("app.db", "visits", { rowid: 2 }, "startedAt")).toBeNull();
    await expect(
      adapter.cell("app.db", "visits", { rowid: 1 }, "nope; DROP TABLE visits"),
    ).rejects.toThrow("unknown column");
  });

  it("busca no device: LIKE nas tabelas devolve só matches com ref e snippet", async () => {
    const { adapter } = setup();
    const result = await adapter.search("app.db", "Carrefour", 10);
    expect(result.complete).toBe(true);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      table: "visits",
      ref: { rowid: 1 },
    });
    expect(result.matches[0]?.snippet).toContain("Carrefour");
  });

  it("busca escapa curingas do LIKE — '%' literal não vira match-tudo", async () => {
    const { adapter } = setup();
    const result = await adapter.search("app.db", "%", 10);
    expect(result.matches).toHaveLength(0);
  });

  it("exportRows itera 100% das linhas com células íntegras (sem truncar)", async () => {
    const { adapter, db } = setup();
    const big = "z".repeat(10_000);
    await db.runAsync("UPDATE visits SET pdv = ? WHERE id = 2", [big]);

    const rows: Array<Record<string, unknown>> = [];
    for await (const row of adapter.exportRows("app.db", "visits")) rows.push(row);
    expect(rows).toHaveLength(3);
    expect(rows[1]?.["pdv"]).toBe(big); // íntegro — export nunca trunca
  });

  it("rejeita orderBy que não é coluna — sem injeção", async () => {
    const { adapter } = setup();
    await expect(
      adapter.rows("app.db", "visits", {
        limit: 10,
        offset: 0,
        orderBy: "pdv; DROP TABLE visits",
      }),
    ).rejects.toThrow("unknown column");
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
    const inserted = await adapter.insert("app.db", "visits", { status: "pending", pdv: "Assaí" });
    expect(inserted.ref).toEqual({ rowid: 4 });
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

  it("fallback JS emite mudança do app quando o hook nativo não chega", () => {
    const db = createNodeSqlite(SETUP);
    const adapter = createExpoSqliteAdapter();
    adapter.registerDatabase("app.db", db, { hasChangeListener: true });
    const changes: DatabaseChange[] = [];
    adapter.subscribe("app.db", (c) => changes.push(c));

    adapter.notifyAppMutation("app.db", "visits", 3);

    expect(changes).toEqual([
      { table: "visits", rowId: 3, operation: "unknown", source: "app" },
    ]);
  });

  it("deduplica hook nativo e fallback JS da mesma mutação", () => {
    const db = createNodeSqlite(SETUP);
    const adapter = createExpoSqliteAdapter();
    adapter.registerDatabase("app.db", db, { hasChangeListener: true });
    const changes: DatabaseChange[] = [];
    adapter.subscribe("app.db", (c) => changes.push(c));

    adapter.notifyAppMutation("app.db", "visits", null);
    adapter.notifyNativeChange("app.db", "visits", 1);

    expect(changes).toHaveLength(1);
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

  it("avisa quando um novo banco aparece", () => {
    const adapter = createExpoSqliteAdapter();
    const seen: string[][] = [];
    adapter.onInstancesChanged?.(() => {
      seen.push(adapter.instances().map((i) => i.instanceId));
    });

    adapter.registerDatabase("a.db", createNodeSqlite());
    adapter.registerDatabase("a.db", createNodeSqlite());
    adapter.registerDatabase("b.db", createNodeSqlite());

    expect(seen).toEqual([["a.db"], ["a.db", "b.db"]]);
  });
});
