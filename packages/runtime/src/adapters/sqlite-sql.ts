/**
 * Leitura de texto SQL — o único lugar do adapter que interpreta SQL como
 * texto em vez de mandar para o engine.
 *
 * Existe porque três informações que precisamos sobre uma VIEW só estão
 * disponíveis no `sql` que o SQLite guarda em `sqlite_master`:
 *
 *  1. de quais objetos a view lê (não há pragma que responda isso, e
 *     `EXPLAIN QUERY PLAN` devolve o ALIAS quando a view usa alias);
 *  2. qual operação um trigger `INSTEAD OF` cobre (uma view pode ter só o
 *     de INSERT, e aí UPDATE lança "cannot modify x because it is a view");
 *  3. quais colunas o trigger usa como `OLD.*` — que é a declaração do
 *     próprio autor sobre o que identifica uma linha daquela view.
 *
 * Módulo puro e sem dependência: parsing tem que ser testável sem banco, e
 * este arquivo é bundlado por esbuild para dentro dos shims.
 *
 * Nada aqui decide escrita sozinho. O que sai daqui só relaxa ou restringe
 * capacidade — a segurança de uma escrita vem do preflight no sqlite-core,
 * que prova no banco que a referência atinge exatamente uma linha.
 */

export interface SqlToken {
  kind: "word" | "ident" | "dot";
  /** Identificador já sem as aspas. `"."` quando kind é dot. */
  text: string;
}

/** Início de identificador sem aspas. Permissivo com não-ASCII de propósito. */
function isIdentStart(code: number): boolean {
  return (
    (code >= 0x41 && code <= 0x5a) || // A-Z
    (code >= 0x61 && code <= 0x7a) || // a-z
    code === 0x5f || // _
    code > 0x7f
  );
}

function isIdentPart(code: number): boolean {
  return isIdentStart(code) || isDigit(code) || code === 0x24; // 0-9 $
}

function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

/** Fechamento de cada forma de identificador quotado que o SQLite aceita. */
const QUOTE_CLOSERS: Record<string, string> = { '"': '"', "[": "]", "`": "`" };

/**
 * Quebra SQL em identificadores, palavras e pontos, descartando o resto.
 *
 * O que é descartado importa tanto quanto o que é mantido: literais `'...'`,
 * comentários `--` e `/* *\/`, números e operadores saem. Sem isso, um
 * comentário citando uma tabela viraria dependência e um literal
 * `'instead of delete'` viraria operação de trigger.
 *
 * Comentário de bloco NÃO aninha — é o comportamento do próprio SQLite, então
 * imitá-lo é o que mantém a leitura fiel ao que o engine enxergou.
 */
export function scanSqlTokens(sql: string): SqlToken[] {
  const text = String(sql ?? "");
  const tokens: SqlToken[] = [];
  let i = 0;

  while (i < text.length) {
    const char = text[i] as string;

    // Comentário de linha
    if (char === "-" && text[i + 1] === "-") {
      const newline = text.indexOf("\n", i + 2);
      i = newline === -1 ? text.length : newline + 1;
      continue;
    }

    // Comentário de bloco. Não fechado consome até o fim, como no SQLite.
    if (char === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      i = close === -1 ? text.length : close + 2;
      continue;
    }

    // Literal de texto. `''` é aspas escapada, não fim do literal.
    if (char === "'") {
      i += 1;
      while (i < text.length) {
        if (text[i] === "'") {
          if (text[i + 1] === "'") i += 2;
          else {
            i += 1;
            break;
          }
        } else i += 1;
      }
      continue;
    }

    // Identificador quotado. O conteúdo vira `ident` — nunca é palavra-chave,
    // e é por isso que um trigger chamado "instead of delete hack" não engana
    // o triggerOperation.
    const closer = QUOTE_CLOSERS[char];
    if (closer !== undefined) {
      i += 1;
      let value = "";
      while (i < text.length) {
        if (text[i] === closer) {
          // "" dentro de "..." é uma aspas literal (idem para ``).
          if (closer !== "]" && text[i + 1] === closer) {
            value += closer;
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        value += text[i];
        i += 1;
      }
      tokens.push({ kind: "ident", text: value });
      continue;
    }

    // Número, incluindo o ponto decimal e o expoente. Consumido inteiro para
    // que o `.` de `3.14` não vire token de ponto — senão o tokenizer mente
    // sobre a estrutura, e é justamente de `<algo> . <algo>` que sai a chave
    // derivada de `OLD.*`.
    if (isDigit(text.charCodeAt(i)) || (char === "." && isDigit(text.charCodeAt(i + 1)))) {
      if (char === "0" && (text[i + 1] === "x" || text[i + 1] === "X")) {
        i += 2;
        while (i < text.length && /[0-9a-fA-F]/.test(text[i] as string)) i += 1;
        continue;
      }
      i += 1;
      while (i < text.length) {
        const code = text.charCodeAt(i);
        if (isDigit(code) || text[i] === ".") i += 1;
        else if ((text[i] === "e" || text[i] === "E") && isDigit(text.charCodeAt(i + 1))) i += 2;
        else if (
          (text[i] === "e" || text[i] === "E") &&
          (text[i + 1] === "+" || text[i + 1] === "-") &&
          isDigit(text.charCodeAt(i + 2))
        ) {
          i += 3;
        } else break;
      }
      continue;
    }

    if (char === ".") {
      tokens.push({ kind: "dot", text: "." });
      i += 1;
      continue;
    }

    if (isIdentStart(text.charCodeAt(i))) {
      const start = i;
      i += 1;
      while (i < text.length && isIdentPart(text.charCodeAt(i))) i += 1;
      tokens.push({ kind: "word", text: text.slice(start, i) });
      continue;
    }

    i += 1;
  }

  return tokens;
}

/**
 * Operação coberta por um trigger `INSTEAD OF`, ou null quando não é um.
 *
 * Só `word` conta: `INSTEAD OF` dentro de um nome quotado é nome, não
 * sintaxe. Uma regex sobre o texto cru reportaria "delete" para
 * `CREATE TRIGGER "instead of delete hack" INSTEAD OF INSERT ON v` — e a UI
 * ofereceria apagar numa view que só aceita inserir.
 */
export function triggerOperation(sql: string): "insert" | "update" | "delete" | null {
  const tokens = scanSqlTokens(sql);
  for (let i = 0; i + 2 < tokens.length; i += 1) {
    const first = tokens[i] as SqlToken;
    const second = tokens[i + 1] as SqlToken;
    if (first.kind !== "word" || second.kind !== "word") continue;
    if (first.text.toLowerCase() !== "instead" || second.text.toLowerCase() !== "of") continue;
    const operation = tokens[i + 2] as SqlToken;
    if (operation.kind !== "word") return null;
    const name = operation.text.toLowerCase();
    if (name === "insert" || name === "update" || name === "delete") return name;
    return null;
  }
  return null;
}

/**
 * Colunas referenciadas como `OLD.<coluna>` no corpo de um trigger.
 *
 * É a chave da linha segundo quem escreveu a view: dentro de um `INSTEAD OF`,
 * `OLD` é a linha que estava lá, e o que o autor usa dela para achar o
 * registro na tabela-base é, por definição, o que identifica a linha.
 *
 * Aceita `OLD` quotado (`"OLD"."id"`), que é sintaxe válida e significa o
 * mesmo. Super-aproximar aqui é seguro: coluna a mais só deixa o WHERE mais
 * seletivo, e o preflight recusa se ainda assim ficar ambíguo.
 */
export function triggerOldColumns(sql: string): string[] {
  const tokens = scanSqlTokens(sql);
  const columns: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i + 2 < tokens.length; i += 1) {
    const row = tokens[i] as SqlToken;
    if (row.kind === "dot" || row.text.toLowerCase() !== "old") continue;
    if ((tokens[i + 1] as SqlToken).kind !== "dot") continue;
    const column = tokens[i + 2] as SqlToken;
    if (column.kind === "dot") continue;
    if (seen.has(column.text)) continue;
    seen.add(column.text);
    columns.push(column.text);
  }

  return columns;
}

/**
 * Nomes conhecidos citados por este SQL.
 *
 * Deliberadamente uma SUPER-aproximação: uma view com uma *coluna* chamada
 * `users` gera dependência falsa da tabela `users`. Isso custa uma
 * invalidação e um flash a mais. Sub-aproximar custaria realtime perdido em
 * silêncio, que é a falha que importa — daí a assimetria ser intencional.
 *
 * Comparação sem diferenciar maiúsculas porque identificador do SQLite é
 * case-insensitive em ASCII; devolve o nome canônico de `known`, não o que
 * estava escrito.
 */
export function referencedNames(sql: string, known: Iterable<string>): string[] {
  const canonical = new Map<string, string>();
  for (const name of known) canonical.set(name.toLowerCase(), name);
  if (canonical.size === 0) return [];

  const found: string[] = [];
  const seen = new Set<string>();
  for (const token of scanSqlTokens(sql)) {
    if (token.kind === "dot") continue;
    const match = canonical.get(token.text.toLowerCase());
    if (match === undefined || seen.has(match)) continue;
    seen.add(match);
    found.push(match);
  }
  return found;
}
