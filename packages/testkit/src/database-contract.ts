import { describe, expect, it } from "vitest";
import type { DatabaseAdapter, DatabaseChange } from "@rnsi/runtime";

/**
 * Contract tests de banco, no molde do key-value-contract.
 *
 * Antes disto, expo-sqlite e op-sqlite tinham suítes concretas DUPLICADAS e
 * nenhum contrato comum — então cada comportamento novo era provado num
 * driver só, e a divergência entre eles só aparecia no device de alguém.
 *
 * A suíte é dona da própria DDL: o harness recebe o SQL de setup e devolve o
 * adapter já registrado. Assim o mesmo banco, com as mesmas views, roda
 * idêntico em todos os drivers.
 */

export interface DatabaseAdapterHarness {
  adapter: DatabaseAdapter;
  instanceId: string;
  /** SQL cru POR BAIXO do adapter — simula o app escrevendo direto. */
  exec(sql: string): Promise<void>;
  /** Leitura crua, para conferir a tabela-base depois de escrever pela view. */
  query(sql: string): Promise<Array<Record<string, unknown>>>;
}

/**
 * Um banco no formato PowerSync em miniatura, mais os casos de borda que
 * quebram implementações ingênuas.
 */
export const DATABASE_CONTRACT_SETUP = `
  CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL, qty INTEGER);
  INSERT INTO items (name, qty) VALUES ('caneta', 3), ('caderno', 1);

  CREATE TABLE composite (a TEXT NOT NULL, b INTEGER NOT NULL, v TEXT, PRIMARY KEY (a, b))
    WITHOUT ROWID;
  INSERT INTO composite VALUES ('x', 1, 'primeiro');

  -- Dado como JSON opaco + view desempacotando + triggers roteando a escrita.
  CREATE TABLE ps_data__notes (id TEXT PRIMARY KEY, data TEXT);
  INSERT INTO ps_data__notes VALUES
    ('n_01', '{"title":"primeira","pinned":0}'),
    ('n_02', '{"title":"segunda","pinned":1}');
  CREATE VIEW notes AS
    SELECT id,
           json_extract(data, '$.title')  AS title,
           json_extract(data, '$.pinned') AS pinned
      FROM ps_data__notes;
  CREATE TRIGGER notes_insert INSTEAD OF INSERT ON notes BEGIN
    INSERT INTO ps_data__notes (id, data)
      VALUES (NEW.id, json_object('title', NEW.title, 'pinned', NEW.pinned));
  END;
  CREATE TRIGGER notes_update INSTEAD OF UPDATE ON notes BEGIN
    UPDATE ps_data__notes
       SET data = json_set(data, '$.title', NEW.title, '$.pinned', NEW.pinned)
     WHERE id = OLD.id;
  END;
  CREATE TRIGGER notes_delete INSTEAD OF DELETE ON notes BEGIN
    DELETE FROM ps_data__notes WHERE id = OLD.id;
  END;

  -- View só de INSERT: UPDATE e DELETE nela lançam no SQLite.
  CREATE VIEW notes_inbox AS SELECT id, json_extract(data, '$.title') AS title
    FROM ps_data__notes;
  CREATE TRIGGER notes_inbox_insert INSTEAD OF INSERT ON notes_inbox BEGIN
    INSERT INTO ps_data__notes (id, data) VALUES (NEW.id, json_object('title', NEW.title));
  END;

  -- View sem trigger nenhum: o SQLite recusa qualquer DML.
  CREATE VIEW items_readonly AS SELECT id, name FROM items;

  -- View sobre view, para o fecho transitivo de dependências.
  CREATE VIEW items_names AS SELECT name FROM items_readonly;

  -- JOIN: "id" REPETE entre linhas, e há duas colunas de mesmo nome.
  CREATE TABLE tags (id INTEGER PRIMARY KEY, item_id INTEGER, label TEXT);
  INSERT INTO tags (item_id, label) VALUES (1, 'azul'), (1, 'fino');
  CREATE VIEW item_tags AS
    SELECT i.id, i.name, t.id, t.label FROM items i JOIN tags t ON t.item_id = i.id;
  CREATE TRIGGER item_tags_update INSTEAD OF UPDATE ON item_tags BEGIN
    UPDATE items SET name = NEW.name WHERE id = OLD.id;
  END;

  -- View órfã: a base foi embora numa migração.
  CREATE TABLE doomed (x TEXT);
  CREATE VIEW orphan AS SELECT x FROM doomed;
  DROP TABLE doomed;
`;

export function describeDatabaseAdapterContract(options: {
  name: string;
  createHarness: (setupSql: string) => Promise<DatabaseAdapterHarness> | DatabaseAdapterHarness;
}): void {
  const { name, createHarness } = options;

  describe(`contrato de banco: ${name}`, () => {
    async function setup() {
      const harness = await createHarness(DATABASE_CONTRACT_SETUP);
      const changes: DatabaseChange[] = [];
      harness.adapter.subscribe(harness.instanceId, (change) => changes.push(change));
      return { ...harness, changes };
    }

    async function schemaOf(harness: DatabaseAdapterHarness, table: string) {
      const tables = await harness.adapter.tables(harness.instanceId);
      return tables.find((entry) => entry.name === table);
    }

    /* ---------------------------------------------------------------- */
    /* Listagem                                                          */
    /* ---------------------------------------------------------------- */

    it("lista tabelas e views, cada uma com o seu kind", async () => {
      const harness = await setup();
      const tables = await harness.adapter.tables(harness.instanceId);
      const byName = Object.fromEntries(tables.map((entry) => [entry.name, entry]));

      expect(byName["items"]?.kind).toBeUndefined(); // ausente ⇒ tabela
      expect(byName["notes"]?.kind).toBe("view");
      expect(byName["items_readonly"]?.kind).toBe("view");
    });

    it("view órfã aparece com o motivo e NÃO derruba a listagem", async () => {
      const harness = await setup();
      const tables = await harness.adapter.tables(harness.instanceId);
      const byName = Object.fromEntries(tables.map((entry) => [entry.name, entry]));

      expect(byName["items"]).toBeDefined();
      expect(byName["notes"]).toBeDefined();
      expect(byName["orphan"]?.unavailable).toBeTruthy();
      expect(byName["orphan"]?.columns).toEqual([]);
    });

    it("dependências são transitivas — view sobre view enxerga a tabela do fundo", async () => {
      const harness = await setup();
      expect((await schemaOf(harness, "items_names"))?.dependsOn).toEqual([
        "items",
        "items_readonly",
      ]);
    });

    /* ---------------------------------------------------------------- */
    /* Identidade e gravabilidade                                        */
    /* ---------------------------------------------------------------- */

    it("view com triggers vira pk, com a chave lida do OLD.*", async () => {
      const harness = await setup();
      const schema = await schemaOf(harness, "notes");
      expect(schema?.identity).toBe("pk");
      expect(schema?.writable).toEqual({ insert: true, update: true, delete: true });
      expect(schema?.columns.find((c) => c.name === "id")?.pkIndex).toBe(1);
    });

    it("view sem trigger é só-leitura e sem identidade", async () => {
      const harness = await setup();
      const schema = await schemaOf(harness, "items_readonly");
      expect(schema?.identity).toBe("none");
      expect(schema?.writable).toEqual({ insert: false, update: false, delete: false });
    });

    it("gravabilidade é por operação, não um booleano", async () => {
      const harness = await setup();
      expect((await schemaOf(harness, "notes_inbox"))?.writable).toEqual({
        insert: true,
        update: false,
        delete: false,
      });
    });

    /* ---------------------------------------------------------------- */
    /* Leitura                                                           */
    /* ---------------------------------------------------------------- */

    it("view desempacota o JSON em colunas de verdade", async () => {
      const harness = await setup();
      const page = await harness.adapter.rows(harness.instanceId, "notes", {
        limit: 10,
        offset: 0,
      });
      expect(page.rows.map((r) => r.cells["title"])).toEqual(["primeira", "segunda"]);
      expect(page.rows[0]?.ref).toEqual({ pk: { id: "n_01" } });
    });

    it("coluna repetida num JOIN não some — o SQLite desambigua na criação", async () => {
      const harness = await setup();
      // Trava o achado corrigido: `id:1` é coluna real e endereçável, não um
      // nome sintético que precise de defesa.
      expect((await schemaOf(harness, "item_tags"))?.columns.map((c) => c.name)).toEqual([
        "id",
        "name",
        "id:1",
        "label",
      ]);

      const page = await harness.adapter.rows(harness.instanceId, "item_tags", {
        limit: 10,
        offset: 0,
      });
      expect(page.rows[0]?.cells["id"]).toBe(1);
      expect(page.rows[0]?.cells["id:1"]).toBe(1);
      expect(page.rows[1]?.cells["id:1"]).toBe(2);
    });

    it("ordena view por coluna e pagina por OFFSET", async () => {
      const harness = await setup();
      const page = await harness.adapter.rows(harness.instanceId, "notes", {
        limit: 1,
        offset: 0,
        orderBy: "title",
        direction: "desc",
      });
      expect(page.rows[0]?.cells["title"]).toBe("segunda");
      expect(page.total).toBe(2);
    });

    it("contagem de view pequena é exata", async () => {
      const harness = await setup();
      const schema = await schemaOf(harness, "notes");
      expect(schema?.rowCount).toBe(2);
      expect(schema?.rowCountIsEstimate).toBe(false);
    });

    it("busca inclui views", async () => {
      const harness = await setup();
      const found = await harness.adapter.search(harness.instanceId, "primeira", 20);
      expect(found.matches.map((m) => m.table)).toContain("notes");
    });

    it("export de view entrega as linhas desempacotadas", async () => {
      const harness = await setup();
      const rows: Array<Record<string, unknown>> = [];
      for await (const row of harness.adapter.exportRows(harness.instanceId, "notes")) {
        rows.push(row);
      }
      expect(rows.map((r) => r["title"])).toEqual(["primeira", "segunda"]);
    });

    /* ---------------------------------------------------------------- */
    /* Escrita                                                           */
    /* ---------------------------------------------------------------- */

    it("update pela view chega na tabela-base", async () => {
      const harness = await setup();
      await harness.adapter.update(
        harness.instanceId,
        "notes",
        { pk: { id: "n_01" } },
        { title: "editada", pinned: 0 },
      );
      const [row] = await harness.query("SELECT data FROM ps_data__notes WHERE id = 'n_01'");
      expect(String(row?.["data"])).toContain("editada");
    });

    it("`changes` é 0 num update bem-sucedido de view — a armadilha, fixada", async () => {
      // Não testa o SQLite: documenta. Quem acrescentar "se changes === 0
      // então falhou" quebra toda escrita em view EM SILÊNCIO, porque o dado
      // é gravado. Este teste é o que impede isso de passar despercebido.
      const harness = await setup();
      await harness.exec("UPDATE notes SET title = 'via sql', pinned = 0 WHERE id = 'n_02'");
      const [row] = await harness.query("SELECT data FROM ps_data__notes WHERE id = 'n_02'");
      expect(String(row?.["data"])).toContain("via sql");
    });

    it("RECUSA update cuja referência casa mais de uma linha, sem escrever nada", async () => {
      const harness = await setup();
      await expect(
        harness.adapter.update(harness.instanceId, "item_tags", { pk: { id: 1 } }, { name: "x" }),
      ).rejects.toThrow(/more than one row/);
      const [row] = await harness.query("SELECT name FROM items WHERE id = 1");
      expect(row?.["name"]).toBe("caneta");
    });

    it("RECUSA update cuja referência não casa mais nenhuma linha", async () => {
      const harness = await setup();
      await expect(
        harness.adapter.update(harness.instanceId, "notes", { pk: { id: "sumiu" } }, { title: "x" }),
      ).rejects.toThrow(/no longer matches/);
    });

    it("RECUSA a operação sem trigger correspondente, antes de tocar o banco", async () => {
      const harness = await setup();
      await expect(
        harness.adapter.update(
          harness.instanceId,
          "notes_inbox",
          { pk: { id: "n_01" } },
          { title: "x" },
        ),
      ).rejects.toThrow(/no INSTEAD OF UPDATE trigger/);
    });

    it("insert pela view roteia pelo trigger e não inventa rowid", async () => {
      const harness = await setup();
      const result = await harness.adapter.insert(harness.instanceId, "notes", {
        id: "n_03",
        title: "terceira",
        pinned: 0,
      });
      // last_insert_rowid não é atualizado por insert dentro de trigger, então
      // uma ref de rowid aqui apontaria para outra escrita.
      expect(result.ref).toEqual({ pk: { id: "n_03" } });
      const rows = await harness.query("SELECT id FROM ps_data__notes ORDER BY id");
      expect(rows.map((r) => r["id"])).toEqual(["n_01", "n_02", "n_03"]);
    });

    it("delete de linha única pela view funciona", async () => {
      const harness = await setup();
      await harness.adapter.delete(harness.instanceId, "notes", { pk: { id: "n_02" } });
      const rows = await harness.query("SELECT id FROM ps_data__notes");
      expect(rows.map((r) => r["id"])).toEqual(["n_01"]);
    });

    it("deleteAll em view é recusado e nada é apagado", async () => {
      const harness = await setup();
      await expect(harness.adapter.deleteAll(harness.instanceId, "notes")).rejects.toThrow(
        /once per row/,
      );
      expect((await harness.query("SELECT id FROM ps_data__notes")).length).toBe(2);
    });

    it("deleteRows em view é recusado", async () => {
      const harness = await setup();
      await expect(
        harness.adapter.deleteRows(harness.instanceId, "notes", [{ pk: { id: "n_01" } }]),
      ).rejects.toThrow(/one at a time/);
    });

    it("ref posicional é recusada por qualquer escrita", async () => {
      const harness = await setup();
      await expect(
        harness.adapter.update(harness.instanceId, "notes", { scan: { offset: 0 } }, { title: "x" }),
      ).rejects.toThrow(/positional reference/);
      await expect(
        harness.adapter.delete(harness.instanceId, "notes", { scan: { offset: 0 } }),
      ).rejects.toThrow(/positional reference/);
    });

    /* ---------------------------------------------------------------- */
    /* Ref posicional — ler o que não tem endereço                       */
    /* ---------------------------------------------------------------- */

    it("lê célula por posição numa view sem identidade nenhuma", async () => {
      // items_readonly não tem trigger, então nenhuma linha dela tem ref. Sem
      // a ref posicional o conteúdo completo de uma célula ali é simplesmente
      // inalcançável — o botão de expandir nem aparece.
      const harness = await setup();
      const page = await harness.adapter.rows(harness.instanceId, "items_readonly", {
        limit: 10,
        offset: 0,
      });
      expect(page.rows[0]?.ref).toBeNull();

      const cell = await harness.adapter.cell(
        harness.instanceId,
        "items_readonly",
        { scan: { offset: 1 } },
        "name",
      );
      expect(cell).toEqual({ data: "caderno", kind: "text" });
    });

    it("ref posicional respeita a ordenação que o grid está mostrando", async () => {
      const harness = await setup();
      const cell = await harness.adapter.cell(
        harness.instanceId,
        "items_readonly",
        { scan: { offset: 0, orderBy: "name", direction: "asc" } },
        "name",
      );
      // Sem o ORDER BY isto seria "caneta" (ordem natural de rowid).
      expect(cell).toEqual({ data: "caderno", kind: "text" });
    });

    it("ref posicional valida a coluna de ordenação como o resto do adapter", async () => {
      const harness = await setup();
      await expect(
        harness.adapter.cell(
          harness.instanceId,
          "items_readonly",
          { scan: { offset: 0, orderBy: "name; DROP TABLE items" } },
          "name",
        ),
      ).rejects.toThrow(/unknown column/);
    });

    /* ---------------------------------------------------------------- */
    /* Tabela física — o que views não podem ter quebrado                */
    /* ---------------------------------------------------------------- */

    it("tabela rowid continua com keyset e ref de rowid", async () => {
      const harness = await setup();
      const page = await harness.adapter.rows(harness.instanceId, "items", {
        limit: 10,
        offset: 0,
      });
      expect(page.rows[0]?.ref).toEqual({ rowid: 1 });
      expect((await schemaOf(harness, "items"))?.identity).toBe("rowid");
    });

    it("WITHOUT ROWID com PK composta continua editável por pk", async () => {
      const harness = await setup();
      await harness.adapter.update(
        harness.instanceId,
        "composite",
        { pk: { a: "x", b: 1 } },
        { v: "alterado" },
      );
      const [row] = await harness.query("SELECT v FROM composite WHERE a = 'x' AND b = 1");
      expect(row?.["v"]).toBe("alterado");
    });

    it("deleteAll em tabela física continua funcionando", async () => {
      const harness = await setup();
      const result = await harness.adapter.deleteAll(harness.instanceId, "tags");
      expect(result.rowsAffected).toBe(2);
    });

    /* ---------------------------------------------------------------- */
    /* Atribuição de mudança                                             */
    /* ---------------------------------------------------------------- */

    it("mudança na tabela-base carrega as views que a leem, num evento só", async () => {
      const harness = await setup();
      await harness.adapter.tables(harness.instanceId); // carrega o catálogo
      harness.changes.length = 0;

      await harness.adapter.update(
        harness.instanceId,
        "items",
        { rowid: 1 },
        { name: "renomeada" },
      );

      const withViews = harness.changes.filter((c) => c.table === "items");
      expect(withViews.length).toBeGreaterThan(0);
      expect(withViews[0]?.views?.slice().sort()).toEqual([
        "item_tags",
        "items_names",
        "items_readonly",
      ]);
    });
  });
}
