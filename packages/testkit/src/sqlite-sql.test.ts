import { describe, expect, it } from "vitest";
import { referencedNames, scanSqlTokens, triggerOldColumns, triggerOperation } from "@rnsi/runtime";

/**
 * O parser é a única parte do suporte a VIEW que lê SQL como texto, então é
 * onde a entrada hostil tem que bater. Nada aqui toca banco: o objetivo é que
 * uma view mal-comportada degrade para "menos capacidade", nunca para escrita
 * no lugar errado.
 */

const texts = (sql: string) => scanSqlTokens(sql).map((token) => token.text);

describe("scanSqlTokens", () => {
  it("descarta comentário de linha inteiro, inclusive o que ele cita", () => {
    expect(texts("SELECT a -- FROM users\nFROM t")).toEqual(["SELECT", "a", "FROM", "t"]);
  });

  it("descarta comentário de bloco", () => {
    expect(texts("SELECT /* FROM users */ a FROM t")).toEqual(["SELECT", "a", "FROM", "t"]);
  });

  it("não aninha comentário de bloco — é o comportamento do próprio SQLite", () => {
    // O primeiro */ fecha. O que vem depois é código de novo, e o SQLite lê
    // exatamente assim; imitar é o que mantém a leitura fiel ao engine.
    expect(texts("/* a /* b */ users */")).toEqual(["users"]);
  });

  it("comentário de bloco não fechado consome até o fim", () => {
    expect(texts("SELECT a /* FROM users")).toEqual(["SELECT", "a"]);
  });

  it("descarta literal de texto e entende '' como aspas escapada", () => {
    expect(texts("WHERE name = 'it''s users' AND id = 1")).toEqual([
      "WHERE",
      "name",
      "AND",
      "id",
    ]);
  });

  it.each([
    ['"ps_data__todos"', "ps_data__todos"],
    ["[ps_data__todos]", "ps_data__todos"],
    ["`ps_data__todos`", "ps_data__todos"],
  ])("desembrulha identificador quotado com %s", (quoted, expected) => {
    const tokens = scanSqlTokens(`FROM ${quoted}`);
    expect(tokens[1]).toEqual({ kind: "ident", text: expected });
  });

  it('trata "" dentro de identificador como uma aspas literal', () => {
    expect(scanSqlTokens('FROM "we""ird"')[1]).toEqual({ kind: "ident", text: 'we"ird' });
  });

  it("identificador quotado nunca vira palavra-chave", () => {
    const tokens = scanSqlTokens('CREATE TRIGGER "instead of delete"');
    expect(tokens.map((t) => t.kind)).toEqual(["word", "word", "ident"]);
  });

  it("emite o ponto como token próprio", () => {
    expect(scanSqlTokens("OLD.id").map((t) => t.kind)).toEqual(["word", "dot", "word"]);
  });

  it.each([
    ["a >= 42 AND b <> 3.14", ["a", "AND", "b"]],
    ["a = 1e-9 AND b = 0xFF", ["a", "AND", "b"]],
    ["a = .5", ["a"]],
  ])("descarta número e operador em %s", (sql, expected) => {
    // O ponto de 3.14 não pode virar token de ponto: é de `<algo> . <algo>`
    // que sai a chave derivada de OLD.*, e um tokenizer que mente ali
    // inventaria coluna de chave a partir de um literal numérico.
    expect(texts(sql)).toEqual(expected);
  });

  it("não quebra em SQL vazio ou lixo", () => {
    expect(scanSqlTokens("")).toEqual([]);
    expect(scanSqlTokens("((((")).toEqual([]);
  });
});

describe("triggerOperation", () => {
  it.each([
    ["INSERT", "insert"],
    ["UPDATE", "update"],
    ["DELETE", "delete"],
  ])("reconhece INSTEAD OF %s", (keyword, expected) => {
    const sql = `CREATE TRIGGER t INSTEAD OF ${keyword} ON v BEGIN SELECT 1; END`;
    expect(triggerOperation(sql)).toBe(expected);
  });

  it("aceita a forma INSTEAD OF UPDATE OF colunas", () => {
    expect(
      triggerOperation("CREATE TRIGGER t INSTEAD OF UPDATE OF a, b ON v BEGIN SELECT 1; END"),
    ).toBe("update");
  });

  it("é insensível a maiúsculas", () => {
    expect(triggerOperation("create trigger t instead of update on v begin select 1; end")).toBe(
      "update",
    );
  });

  it("NÃO se deixa enganar por nome de trigger que imita a sintaxe", () => {
    // A regex ingênua /instead\s+of\s+(insert|update|delete)/i devolve "delete"
    // aqui — e a UI ofereceria apagar numa view que só aceita inserir.
    const sql =
      'CREATE TRIGGER "instead of delete hack" INSTEAD OF INSERT ON v BEGIN SELECT 1; END';
    expect(triggerOperation(sql)).toBe("insert");
  });

  it("ignora a sintaxe citada em comentário", () => {
    expect(
      triggerOperation("-- INSTEAD OF DELETE\nCREATE TRIGGER t BEFORE INSERT ON t2 BEGIN SELECT 1; END"),
    ).toBeNull();
  });

  it("ignora a sintaxe dentro de literal de texto", () => {
    expect(
      triggerOperation(
        "CREATE TRIGGER t AFTER INSERT ON t2 BEGIN SELECT 'instead of delete'; END",
      ),
    ).toBeNull();
  });

  it("devolve null para trigger comum de tabela", () => {
    expect(triggerOperation("CREATE TRIGGER t AFTER UPDATE ON t2 BEGIN SELECT 1; END")).toBeNull();
  });

  it("devolve null quando INSTEAD OF é seguido de algo inesperado", () => {
    expect(triggerOperation("CREATE TRIGGER t INSTEAD OF 42 ON v BEGIN SELECT 1; END")).toBeNull();
  });
});

describe("triggerOldColumns", () => {
  it("extrai a chave que o autor do trigger usa para achar a linha", () => {
    const sql = `CREATE TRIGGER todos_upd INSTEAD OF UPDATE ON todos BEGIN
      UPDATE ps_data__todos SET data = json_set(data, '$.title', NEW.title) WHERE id = OLD.id;
    END`;
    expect(triggerOldColumns(sql)).toEqual(["id"]);
  });

  it("aceita OLD quotado, que é sintaxe válida e significa o mesmo", () => {
    const sql = `CREATE TRIGGER t INSTEAD OF DELETE ON v BEGIN
      DELETE FROM base WHERE a = "OLD"."tenant" AND b = OLD.id;
    END`;
    expect(triggerOldColumns(sql)).toEqual(["tenant", "id"]);
  });

  it("deduplica preservando a ordem de aparição", () => {
    const sql = "BEGIN UPDATE b SET x = OLD.id WHERE id = OLD.id AND t = OLD.tenant; END";
    expect(triggerOldColumns(sql)).toEqual(["id", "tenant"]);
  });

  it("não confunde uma COLUNA chamada old com a linha OLD", () => {
    expect(triggerOldColumns("BEGIN UPDATE b SET x = t.old WHERE y = 1; END")).toEqual([]);
  });

  it("devolve vazio quando o trigger não referencia OLD", () => {
    const sql = "CREATE TRIGGER t INSTEAD OF INSERT ON v BEGIN INSERT INTO b VALUES (NEW.id); END";
    expect(triggerOldColumns(sql)).toEqual([]);
  });
});

describe("referencedNames", () => {
  const known = ["ps_data__todos", "users", "orders", "ativos"];

  it("acha a tabela que a view lê", () => {
    const sql = "CREATE VIEW todos AS SELECT id FROM ps_data__todos";
    expect(referencedNames(sql, known)).toEqual(["ps_data__todos"]);
  });

  it("acha as duas pontas de um JOIN com alias", () => {
    // É por aqui que EXPLAIN QUERY PLAN falha: ele reporta o alias (SCAN o).
    const sql = "CREATE VIEW uo AS SELECT u.id FROM users u JOIN orders o ON o.user_id = u.id";
    expect(referencedNames(sql, known)).toEqual(["users", "orders"]);
  });

  it("acha nome quotado — a PowerSync escreve FROM \"ps_data__todos\"", () => {
    expect(referencedNames('SELECT * FROM "ps_data__todos"', known)).toEqual(["ps_data__todos"]);
  });

  it("ignora o nome citado em literal e em comentário", () => {
    const sql = `-- mentions users
      CREATE VIEW decoy AS SELECT id FROM ps_data__todos WHERE data LIKE '%users%'`;
    expect(referencedNames(sql, known)).toEqual(["ps_data__todos"]);
  });

  it("casa sem diferenciar maiúsculas e devolve o nome canônico", () => {
    expect(referencedNames("SELECT * FROM USERS", known)).toEqual(["users"]);
  });

  it("enxerga view sobre view, para a resolução transitiva ter de onde partir", () => {
    expect(referencedNames("CREATE VIEW ativos_2 AS SELECT * FROM ativos", known)).toEqual([
      "ativos",
    ]);
  });

  it("deduplica", () => {
    expect(referencedNames("SELECT * FROM users u1 JOIN users u2", known)).toEqual(["users"]);
  });

  it("devolve vazio quando não há nomes conhecidos", () => {
    expect(referencedNames("SELECT * FROM users", [])).toEqual([]);
  });

  it("super-aproxima de propósito: coluna homônima vira dependência falsa", () => {
    // Documentado e aceito. Custa um flash a mais; sub-aproximar custaria
    // realtime perdido em silêncio, que é a falha que importa.
    expect(referencedNames("SELECT users FROM ps_data__todos", known)).toEqual([
      "users",
      "ps_data__todos",
    ]);
  });
});
