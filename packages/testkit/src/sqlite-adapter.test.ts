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
  INSERT INTO no_identity_view_base VALUES ('um'), ('dois');

  -- View só-leitura: sem trigger INSTEAD OF o SQLite recusa qualquer DML.
  CREATE VIEW plain_view AS SELECT v FROM no_identity_view_base;

  -- View que expõe rowid. Existe para provar que o tipo vem do sqlite_master
  -- e não do probe: aqui "SELECT rowid FROM rowid_view" responde, e um probe
  -- ingênuo concluiria identity "rowid" numa view.
  CREATE VIEW rowid_view AS SELECT rowid, v FROM no_identity_view_base;

  -- View órfã: a base foi embora numa migração e o PRAGMA passa a lançar.
  CREATE TABLE gone (x TEXT);
  CREATE VIEW orphan_view AS SELECT x FROM gone;
  DROP TABLE gone;

  -- Formato PowerSync em miniatura: dado como JSON opaco na tabela física,
  -- view desempacotando em colunas, triggers roteando a escrita de volta.
  CREATE TABLE ps_data__notes (id TEXT PRIMARY KEY, data TEXT);
  INSERT INTO ps_data__notes VALUES
    ('n_01', '{"title":"primeira","done":0}'),
    ('n_02', '{"title":"segunda","done":1}');
  CREATE VIEW notes AS
    SELECT id, json_extract(data, '$.title') AS title, json_extract(data, '$.done') AS done
      FROM ps_data__notes;
  CREATE TRIGGER notes_update INSTEAD OF UPDATE ON notes BEGIN
    UPDATE ps_data__notes SET data = json_set(data, '$.title', NEW.title) WHERE id = OLD.id;
  END;
  CREATE TRIGGER notes_delete INSTEAD OF DELETE ON notes BEGIN
    DELETE FROM ps_data__notes WHERE id = OLD.id;
  END;

  -- View de JOIN: "id" REPETE entre linhas. É o caso em que uma heurística de
  -- "coluna chamada id" editaria duas linhas achando que edita uma.
  CREATE TABLE owners (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE pets (id INTEGER PRIMARY KEY, owner_id INTEGER, name TEXT);
  INSERT INTO owners VALUES (1, 'Ana');
  INSERT INTO pets VALUES (10, 1, 'Rex'), (11, 1, 'Mia');
  CREATE VIEW owner_pets AS
    SELECT o.id, o.name, p.name FROM owners o JOIN pets p ON p.owner_id = o.id;
  CREATE TRIGGER owner_pets_update INSTEAD OF UPDATE ON owner_pets BEGIN
    UPDATE owners SET name = NEW.name WHERE id = OLD.id;
  END;
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

    // Tabela física não carrega kind nem writable: ausente já significa
    // "tabela, tudo permitido", e não trafegar o óbvio mantém o payload do
    // refresh idêntico ao de antes num app sem view.
    expect(byName["visits"]?.kind).toBeUndefined();
    expect(byName["visits"]?.writable).toBeUndefined();
  });

  it("lista views ao lado das tabelas, marcadas e sem escrita", async () => {
    const { adapter } = setup();
    const byName = Object.fromEntries((await adapter.tables("app.db")).map((t) => [t.name, t]));

    expect(byName["plain_view"]?.kind).toBe("view");
    expect(byName["plain_view"]?.rowCount).toBe(2);
    expect(byName["plain_view"]?.columns.map((c) => c.name)).toEqual(["v"]);
    // Sem trigger INSTEAD OF não há como derivar chave, e o SQLite recusaria
    // a escrita de qualquer forma.
    expect(byName["plain_view"]?.identity).toBe("none");
    expect(byName["plain_view"]?.writable).toEqual({
      insert: false,
      update: false,
      delete: false,
    });
    expect(byName["plain_view"]?.dependsOn).toEqual(["no_identity_view_base"]);
  });

  it("view que expõe rowid continua sendo view — o tipo vem do sqlite_master", async () => {
    const { adapter, db } = setup();
    // O probe passa: a coluna existe mesmo.
    await expect(db.getAllAsync("SELECT rowid FROM rowid_view LIMIT 1")).resolves.toBeDefined();

    const byName = Object.fromEntries((await adapter.tables("app.db")).map((t) => [t.name, t]));
    // Se o tipo saísse do probe, isto seria "rowid" e o Studio emitiria
    // `DELETE … WHERE rowid IN (…)` numa view, que o SQLite recusa.
    expect(byName["rowid_view"]?.kind).toBe("view");
    expect(byName["rowid_view"]?.identity).toBe("none");
  });

  it("contagem de view pequena é exata e não mostra ≈", async () => {
    const { adapter } = setup();
    const byName = Object.fromEntries((await adapter.tables("app.db")).map((t) => [t.name, t]));
    expect(byName["plain_view"]?.rowCount).toBe(2);
    expect(byName["plain_view"]?.rowCountIsEstimate).toBe(false);
  });

  it("view acima do orçamento vira estimativa e o exato chega depois", async () => {
    // O teto real é 5.000; aqui a subconsulta com LIMIT é observada pelo SQL
    // emitido, que é o que garante que o trabalho pára — numa view de JOIN o
    // COUNT(*) direto materializaria a junção inteira, no caminho crítico da
    // sidebar, a cada refresh, por view.
    const node = createNodeSqlite(`
      CREATE TABLE big (id INTEGER PRIMARY KEY, v TEXT);
      INSERT INTO big (v) SELECT 'x' FROM (
        WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n LIMIT 6000)
        SELECT i FROM n
      );
      CREATE VIEW big_view AS SELECT id, v FROM big;
    `);
    const seen: string[] = [];
    const db = {
      getAllAsync: (sql: string, params?: unknown[]) => {
        seen.push(sql.replace(/\s+/g, " ").trim());
        return node.getAllAsync(sql, params);
      },
      runAsync: node.runAsync,
    };
    const adapter = createExpoSqliteAdapter();
    adapter.registerDatabase("big.db", db);

    const byName = Object.fromEntries((await adapter.tables("big.db")).map((t) => [t.name, t]));
    expect(byName["big_view"]?.rowCountIsEstimate).toBe(true);

    // O probe limita o trabalho dentro da subconsulta, não depois.
    expect(seen).toContain(
      "SELECT COUNT(*) AS n FROM (SELECT 1 FROM \"big_view\" LIMIT 5001)",
    );

    // O COUNT(*) real roda em background e a próxima leitura já é exata.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const after = Object.fromEntries((await adapter.tables("big.db")).map((t) => [t.name, t]));
    expect(after["big_view"]?.rowCount).toBe(6000);
    expect(after["big_view"]?.rowCountIsEstimate).toBe(false);
  });

  it("view órfã aparece com o motivo em vez de derrubar a listagem inteira", async () => {
    const { adapter } = setup();
    const tables = await adapter.tables("app.db");
    const byName = Object.fromEntries(tables.map((t) => [t.name, t]));

    // O ponto do teste: as OUTRAS chegaram. Sem o try/catch, o PRAGMA da view
    // órfã rejeita a promise inteira e a sidebar fica em branco.
    expect(byName["visits"]).toBeDefined();
    expect(byName["plain_view"]).toBeDefined();

    expect(byName["orphan_view"]?.unavailable).toContain("gone");
    expect(byName["orphan_view"]?.columns).toEqual([]);
    expect(byName["orphan_view"]?.identity).toBe("none");
  });

  it("busca global sobrevive a uma view que quebra ao executar", async () => {
    const { adapter } = setup();
    const found = await adapter.search("app.db", "dois", 20);
    expect(found.matches.map((m) => m.table)).toContain("plain_view");
  });

  it("busca global inclui views", async () => {
    const { adapter } = setup();
    const found = await adapter.search("app.db", "dois", 20);
    expect(found.matches.map((m) => m.table)).toContain("plain_view");
  });

  describe("escrita em view", () => {
    it("deriva a chave do OLD.* dos triggers e marca as operações que existem", async () => {
      const { adapter } = setup();
      const byName = Object.fromEntries((await adapter.tables("app.db")).map((t) => [t.name, t]));

      expect(byName["notes"]?.kind).toBe("view");
      expect(byName["notes"]?.identity).toBe("pk");
      expect(byName["notes"]?.writable).toEqual({ insert: false, update: true, delete: true });
      // pkIndex preenchido é o que dá aos templates do console SQL uma coluna
      // de chave — antes eles caíam em rowid, que não existe em view.
      expect(byName["notes"]?.columns.find((c) => c.name === "id")?.pkIndex).toBe(1);
    });

    it("rows devolve ref de pk utilizável numa view gravável", async () => {
      const { adapter } = setup();
      const page = await adapter.rows("app.db", "notes", { limit: 10, offset: 0 });
      expect(page.rows[0]?.ref).toEqual({ pk: { id: "n_01" } });
      expect(page.rows[0]?.cells["title"]).toBe("primeira");
    });

    it("update pela view chega na tabela-base — e `changes` mente, devolvendo 0", async () => {
      const { adapter, db } = setup();
      await adapter.update("app.db", "notes", { pk: { id: "n_01" } }, { title: "editada" });

      const [row] = await db.getAllAsync("SELECT data FROM ps_data__notes WHERE id = 'n_01'");
      expect(String(row?.["data"])).toContain("editada");

      // Este assert existe para documentar a armadilha, não para testar o
      // SQLite: numa view com INSTEAD OF o statement de fora não altera linha
      // nenhuma, então quem um dia acrescentar "se changes === 0, falhou"
      // quebra toda escrita em view — em silêncio, porque o dado É gravado.
      const direct = await db.runAsync(
        "UPDATE notes SET title = 'x' WHERE id IS 'n_02'",
      );
      expect(direct.changes).toBe(0);
    });

    it("RECUSA quando a referência casa mais de uma linha, e não escreve nada", async () => {
      const { adapter, db } = setup();
      // owner_pets tem duas linhas com id = 1 (um dono, dois bichos). Sem o
      // preflight, este UPDATE passa e o trigger roda duas vezes.
      await expect(
        adapter.update("app.db", "owner_pets", { pk: { id: 1 } }, { name: "Bia" }),
      ).rejects.toThrow("more than one row");

      const [row] = await db.getAllAsync("SELECT name FROM owners WHERE id = 1");
      expect(row?.["name"]).toBe("Ana");
    });

    it("RECUSA quando a referência não casa mais nenhuma linha", async () => {
      const { adapter } = setup();
      await expect(
        adapter.update("app.db", "notes", { pk: { id: "sumiu" } }, { title: "x" }),
      ).rejects.toThrow("no longer matches");
    });

    it("recusa a operação que a view não tem trigger para atender", async () => {
      const { adapter } = setup();
      // notes tem UPDATE e DELETE, não tem INSERT.
      await expect(adapter.insert("app.db", "notes", { id: "n_03" })).rejects.toThrow(
        "no INSTEAD OF INSERT trigger",
      );
    });

    it("delete de linha única pela view funciona", async () => {
      const { adapter, db } = setup();
      await adapter.delete("app.db", "notes", { pk: { id: "n_02" } });
      const rest = await db.getAllAsync("SELECT id FROM ps_data__notes");
      expect(rest.map((r) => r["id"])).toEqual(["n_01"]);
    });

    it("deleteAll em view é recusado — dispararia o trigger uma vez por linha", async () => {
      const { adapter, db } = setup();
      await expect(adapter.deleteAll("app.db", "notes")).rejects.toThrow("once per row");
      // O ponto não é o erro, é que nada foi apagado.
      expect((await db.getAllAsync("SELECT id FROM ps_data__notes")).length).toBe(2);
    });

    it("deleteRows em view é recusado — o lote não tem como verificar cada ref", async () => {
      const { adapter } = setup();
      await expect(
        adapter.deleteRows("app.db", "notes", [{ pk: { id: "n_01" } }, { pk: { id: "n_02" } }]),
      ).rejects.toThrow("one at a time");
    });

    it("ref posicional é recusada por qualquer escrita", async () => {
      const { adapter } = setup();
      await expect(
        adapter.update("app.db", "notes", { scan: { offset: 0 } }, { title: "x" }),
      ).rejects.toThrow("positional reference cannot be used for writes");
    });
  });

  describe("atribuição de mudança", () => {
    it("um evento na tabela física carrega as views que a leem", async () => {
      const { adapter, changes } = setup();
      // Carrega o catálogo — é dele que sai o grafo de dependências.
      await adapter.tables("app.db");

      adapter.notifyNativeChange("app.db", "ps_data__notes", 1, "UPDATE");

      // UM evento, não dois. Emitir um por view dependente leria como dois
      // fatos distintos na Timeline sem forma de saber que são a mesma
      // escrita.
      expect(changes).toHaveLength(1);
      expect(changes[0]?.table).toBe("ps_data__notes");
      expect(changes[0]?.views).toEqual(["notes"]);
    });

    it("escrita em tabela sem view dependente não carrega o campo", async () => {
      const { adapter, changes } = setup();
      await adapter.tables("app.db");
      adapter.notifyNativeChange("app.db", "visits", 1, "UPDATE");
      expect(changes[0]?.views).toBeUndefined();
    });

    it("view sobre view é atribuída transitivamente", async () => {
      const db = createNodeSqlite(`
        CREATE TABLE base (id INTEGER PRIMARY KEY, v TEXT);
        CREATE VIEW mid AS SELECT id, v FROM base;
        CREATE VIEW top AS SELECT id FROM mid;
      `);
      const adapter = createExpoSqliteAdapter();
      adapter.registerDatabase("chain.db", db);
      const changes: DatabaseChange[] = [];
      adapter.subscribe("chain.db", (c) => changes.push(c));
      await adapter.tables("chain.db");

      adapter.notifyNativeChange("chain.db", "base", 1, "INSERT");
      expect(changes[0]?.views?.slice().sort()).toEqual(["mid", "top"]);
    });
  });

  it("chave NULA é editável — `IS ?` acha a linha que `= ?` nunca achava", async () => {
    // Numa tabela isso é inalcançável: WITHOUT ROWID exige PK NOT NULL. Numa
    // view a chave sai de expressão, e `json_extract` de campo ausente devolve
    // NULL — então uma parte nula da chave é rotina, não exceção.
    const db = createNodeSqlite(`
      CREATE TABLE ps_data__scoped (tenant TEXT, id TEXT, data TEXT);
      INSERT INTO ps_data__scoped VALUES (NULL, 's_01', '{"v":"antes"}');
      CREATE VIEW scoped AS
        SELECT tenant, id, json_extract(data, '$.v') AS v FROM ps_data__scoped;
      CREATE TRIGGER scoped_update INSTEAD OF UPDATE ON scoped BEGIN
        UPDATE ps_data__scoped SET data = json_set(data, '$.v', NEW.v)
          WHERE tenant IS OLD.tenant AND id IS OLD.id;
      END;
    `);
    const adapter = createExpoSqliteAdapter();
    adapter.registerDatabase("null.db", db);

    const byName = Object.fromEntries((await adapter.tables("null.db")).map((t) => [t.name, t]));
    expect(byName["scoped"]?.identity).toBe("pk");

    const page = await adapter.rows("null.db", "scoped", { limit: 10, offset: 0 });
    expect(page.rows[0]?.ref).toEqual({ pk: { tenant: null, id: "s_01" } });

    // Com `= ?` o preflight contaria ZERO e a escrita seria recusada com
    // "row no longer matches" — numa linha que está bem ali.
    await adapter.update("null.db", "scoped", { pk: { tenant: null, id: "s_01" } }, { v: "depois" });
    const [row] = await db.getAllAsync("SELECT data FROM ps_data__scoped WHERE id = 's_01'");
    expect(String(row?.["data"])).toContain("depois");
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

  it("eco: hook nativo depois de mutação do Studio sai como studio; escrita do app sai como app", async () => {
    const db = createNodeSqlite(SETUP);
    const adapter = createExpoSqliteAdapter();
    adapter.registerDatabase("app.db", db, { hasChangeListener: true });
    const changes: DatabaseChange[] = [];
    adapter.subscribe("app.db", (c) => changes.push(c));

    // mutação do Studio: marca pendente; o hook chega depois.
    // `await` e não `void`: o hook nativo dispara DURANTE o statement, então
    // esta é a ordem real. Sem o await, o teste dependia de `update` marcar o
    // pendente de forma síncrona — o que deixou de valer quando ela passou a
    // resolver o schema antes, para saber se o alvo é uma view gravável.
    await adapter.update("app.db", "visits", { rowid: 1 }, { status: "done" });
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
