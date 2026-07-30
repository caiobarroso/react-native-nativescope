import { createSqliteAdapter, type SQLiteDatabaseLike, type SqliteAdapter } from "./sqlite-core.ts";

/**
 * @op-engineering/op-sqlite.
 *
 * Toda a lógica SQL vem do core (sqlite-core.ts). Aqui mora o que é específico
 * do driver: a ponte de `execute` para `SQLiteDatabaseLike` e a instrumentação
 * de eventos, que é onde estão as diferenças de verdade em relação ao
 * expo-sqlite.
 *
 * Por que isto vive em packages/runtime e não no shim: os shims não são
 * typechecked (apps/cli/tsconfig.json inclui só src/) nem testados com
 * facilidade. A parte delicada — multiplexar um hook de slot único, saber o que
 * o hook nativo NÃO cobre — merece tipo e teste. O shim fica sendo cola.
 */

/* -------------------------------------------------------------------------- */
/* Tipos                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Forma mínima de um banco op-sqlite. ESTRUTURAL de propósito: nada é importado
 * de `@op-engineering/op-sqlite`, nem `import type`.
 *
 * O pacote não é dependência de packages/runtime (e não deve ser — é uma lib do
 * app do usuário), então um import quebraria o typecheck. Pior: este barrel é
 * bundlado por esbuild para dentro dos shims, e esse bundle só é gerado no
 * `prepack` — a quebra apareceria no publish, não no CI.
 */
export interface OpSqliteQueryResult {
  /** Array simples desde a v9/v10. Antes disso era `{ _array }`. */
  rows?: unknown;
  rowsAffected?: number;
  /** O nativo só preenche quando `rowsAffected > 0 && insertId != 0`. */
  insertId?: number;
}

export interface OpSqliteUpdateEvent {
  table: string;
  /** 'INSERT' | 'UPDATE' | 'DELETE' — maiúsculas; o core normaliza. */
  operation: string;
  rowId: number;
}

/** Só o que a gente toca. Tudo opcional exceto `execute`. */
export interface OpSqliteDatabaseLike {
  execute(sql: string, params?: unknown[]): Promise<OpSqliteQueryResult>;
  executeSync?(sql: string, params?: unknown[]): OpSqliteQueryResult;
  executeRaw?(sql: string, params?: unknown[]): Promise<unknown>;
  executeRawSync?(sql: string, params?: unknown[]): unknown;
  executeBatch?(commands: unknown[]): Promise<unknown>;
  transaction?(fn: (tx: unknown) => Promise<void>): Promise<void>;
  prepareStatement?(sql: string): unknown;
  updateHook?(callback: ((event: OpSqliteUpdateEvent) => void) | null): void;
  close?(): void;
  closeAsync?(): Promise<void>;
  delete?(): void;
}

/* -------------------------------------------------------------------------- */
/* Identidade                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * `label: "OP-SQLite"` distingue do expo-sqlite, que ocupa "SQLite" desde a
 * v1.0 e não pode ser renomeado (é UI em produção).
 */
export function createOpSqliteAdapter(): SqliteAdapter {
  return createSqliteAdapter({ providerId: "op-sqlite", label: "OP-SQLite" });
}

/**
 * Identidade da instância a partir das options do `open()`.
 *
 * Usa `name` (+ `location`, porque o mesmo nome em diretórios diferentes são
 * bancos diferentes e colidiriam num registro só). Deliberadamente NÃO usa
 * `getDbPath()`: aquela função CRIA os subdiretórios do caminho como efeito
 * colateral, o que um devtool não tem o direito de fazer. E `encryptionKey`
 * nunca entra aqui — é segredo, e isto viaja para a UI.
 */
export function opSqliteInstanceId(options: unknown): string | null {
  if (typeof options === "string") return options || null;
  if (!options || typeof options !== "object") return null;
  const { name, location } = options as { name?: unknown; location?: unknown };
  if (typeof name !== "string" || name.length === 0) return null;
  return typeof location === "string" && location.length > 0 ? `${location}/${name}` : name;
}

/* -------------------------------------------------------------------------- */
/* Bridge                                                                      */
/* -------------------------------------------------------------------------- */

function resultRows(result: OpSqliteQueryResult | undefined): Array<Record<string, unknown>> {
  const rows = result?.rows;
  if (Array.isArray(rows)) return rows as Array<Record<string, unknown>>;
  // Apólice para op-sqlite <= v6, que devolvia `{ _array }`.
  const legacy = (rows as { _array?: unknown } | undefined)?._array;
  return Array.isArray(legacy) ? (legacy as Array<Record<string, unknown>>) : [];
}

/**
 * Adapta um banco op-sqlite ao contrato do core.
 *
 * `source` é uma função e não o banco direto para sobreviver ao ciclo
 * close/reopen: o adapter guarda ESTA bridge para sempre (registerDatabase é
 * idempotente por instanceId), então a bridge precisa poder apontar para um
 * banco novo depois. Sem isso, um `close()` seguido de `open()` do mesmo nome
 * deixaria o Studio preso a um banco fechado pelo resto da sessão.
 *
 * Sempre `execute` (async), nunca `executeSync`: o core faz COUNT(*), LIKE
 * full-scan na busca e itera o banco inteiro no export. Em `executeSync` isso
 * roda no thread JS e um export vira ANR — inclusive o COUNT(*) que existe
 * justamente para NÃO estar no caminho crítico.
 */
export function toSqliteDatabase(source: () => OpSqliteDatabaseLike): SQLiteDatabaseLike {
  return {
    async getAllAsync(sql, params) {
      return resultRows(await source().execute(sql, params ?? []));
    },
    async runAsync(sql, params) {
      const result = await source().execute(sql, params ?? []);
      return {
        changes: Number(result?.rowsAffected ?? 0),
        // insertId ausente → NaN, e o core já testa Number.isFinite antes de
        // montar a ref. Um SELECT last_insert_rowid() de apólice custaria uma
        // query por insert para cobrir só quem insere rowid = 0 na mão.
        lastInsertRowId: Number(result?.insertId ?? Number.NaN),
      };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* O que o updateHook NÃO cobre                                                */
/* -------------------------------------------------------------------------- */

const MUTATION_RE = /^\s*(insert|replace|update|delete|create|drop|alter)\b/i;
const DDL_RE = /^\s*(create|drop|alter)\b/i;

/**
 * `sqlite3_update_hook` é a nível de VDBE, então cobre `prepareStatement`,
 * `executeBatch` e `transaction` de graça — mas tem dois buracos documentados
 * que importam para nós:
 *
 * 1. `DELETE FROM t` sem WHERE usa a *truncate optimization* e apaga a tabela
 *    sem passar linha por linha, logo NÃO dispara o hook. É o "clear" mais
 *    comum que um app faz.
 * 2. DDL não é mudança de linha — nunca dispara. E é justamente o que invalida
 *    o cache de schema; sem isso um `ALTER TABLE ADD COLUMN` deixa as colunas
 *    erradas pelo resto da sessão.
 *
 * (Um terceiro buraco, `ON CONFLICT REPLACE` deletando a linha conflitante,
 * é ruído de timeline e não dado errado — a UI reconsulta a cada evento.)
 */
export function isFullTableDelete(sql: string): boolean {
  // A ausência da palavra WHERE é o teste certo: COM um WHERE o SQLite não usa
  // a truncate optimization e o hook dispara normalmente.
  return /^\s*delete\s+from\b/i.test(sql) && !/\bwhere\b/i.test(sql);
}

export function isDdl(sql: string): boolean {
  return DDL_RE.test(sql);
}

/** Tabela alvo de uma mutação, para escopar a invalidação. `null` → "*". */
export function mutationTable(sql: string): string | null {
  const trimmed = String(sql ?? "").trim();
  const match =
    /^(?:insert|replace)\s+into\s+["'`[]?([A-Za-z_][\w$]*)/i.exec(trimmed) ||
    /^update\s+["'`[]?([A-Za-z_][\w$]*)/i.exec(trimmed) ||
    /^delete\s+from\s+["'`[]?([A-Za-z_][\w$]*)/i.exec(trimmed) ||
    /^(?:create|drop|alter)\s+table(?:\s+if\s+(?:not\s+)?exists)?\s+["'`[]?([A-Za-z_][\w$]*)/i.exec(
      trimmed,
    );
  return match?.[1] ?? null;
}

function splitStatements(sql: string): string[] {
  return String(sql ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

/* -------------------------------------------------------------------------- */
/* Instrumentação                                                              */
/* -------------------------------------------------------------------------- */

export interface OpSqliteInstance {
  /** O que vai para `adapter.registerDatabase`. Estável entre reopens. */
  readonly database: SQLiteDatabaseLike;
  /** Instrumenta um banco e o torna o alvo da bridge. Idempotente por banco. */
  attach(db: OpSqliteDatabaseLike): void;
  /** O app chamou close/delete: a bridge passa a rejeitar com mensagem clara. */
  markClosed(): void;
  /** Verdadeiro quando conseguimos instalar o updateHook nativo. */
  hasChangeListener(): boolean;
  /** Para o log de diagnóstico do shim. */
  diagnostics(): { updateHook: boolean; multiplex: boolean };
}

const MARKER = "__rnsiOpSqlite__";

/**
 * Rastreia UM instanceId ao longo da vida do app, atravessando reopens.
 */
export function createOpSqliteInstance(options: {
  instanceId: string;
  adapter: SqliteAdapter;
}): OpSqliteInstance {
  const { instanceId, adapter } = options;
  let current: OpSqliteDatabaseLike | null = null;
  let closed = false;
  let hookInstalled = false;
  let multiplexed = false;

  const database = toSqliteDatabase(() => {
    if (closed || !current) {
      throw new Error(`database "${instanceId}" was closed by the app`);
    }
    return current;
  });

  /** Nunca propaga erro para o app: instrumentação não pode quebrar o banco. */
  function safely(run: () => void): void {
    try {
      run();
    } catch {
      /* silêncio proposital */
    }
  }

  /**
   * Chamado DEPOIS que o SQL rodou com sucesso. Divide porque o op-sqlite
   * executa todos os statements de uma string só (é como um app faz o setup:
   * `PRAGMA ...; CREATE TABLE ...`), e o CREATE precisa ser visto.
   */
  function onSql(sql: string): void {
    for (const statement of splitStatements(sql)) onStatement(statement);
  }

  function onStatement(sql: string): void {
    safely(() => {
      if (!MUTATION_RE.test(sql)) return;
      const table = mutationTable(sql) ?? "*";
      if (isDdl(sql)) {
        adapter.notifySchemaChanged(instanceId, table);
        adapter.notifyAppMutation(instanceId, table, null);
        return;
      }
      if (isFullTableDelete(sql)) {
        adapter.notifyAppMutation(instanceId, table, null, "delete");
        return;
      }
      // Com o hook nativo ativo, o resto já vem dele — farejar de novo só
      // geraria trabalho que o emitOnce descartaria. Sem o hook (build
      // libsql/Turso, ou não conseguimos multiplexar), isto é a única fonte.
      if (!hookInstalled) adapter.notifyAppMutation(instanceId, table, null);
    });
  }

  function onBatch(commands: unknown): void {
    if (!Array.isArray(commands)) return;
    for (const command of commands) {
      const sql = Array.isArray(command) ? command[0] : command;
      if (typeof sql === "string") onSql(sql);
    }
  }

  /** Embrulha in-place os métodos de execução de um objeto (db ou tx). */
  function wrapExecutors(target: Record<string, unknown>): void {
    for (const method of ["execute", "executeRaw"] as const) {
      const original = target[method];
      if (typeof original !== "function") continue;
      const bound = (original as (...a: unknown[]) => Promise<unknown>).bind(target);
      target[method] = async (sql: unknown, ...rest: unknown[]) => {
        const result = await bound(sql, ...rest);
        if (typeof sql === "string") onSql(sql);
        return result;
      };
    }
    for (const method of ["executeSync", "executeRawSync"] as const) {
      const original = target[method];
      if (typeof original !== "function") continue;
      const bound = (original as (...a: unknown[]) => unknown).bind(target);
      target[method] = (sql: unknown, ...rest: unknown[]) => {
        const result = bound(sql, ...rest);
        if (typeof sql === "string") onSql(sql);
        return result;
      };
    }
    const batch = target["executeBatch"];
    if (typeof batch === "function") {
      const bound = (batch as (...a: unknown[]) => Promise<unknown>).bind(target);
      target["executeBatch"] = async (commands: unknown, ...rest: unknown[]) => {
        const result = await bound(commands, ...rest);
        onBatch(commands);
        return result;
      };
    }
  }

  function attach(db: OpSqliteDatabaseLike): void {
    if (!db || typeof db.execute !== "function") return;
    current = db;
    closed = false;

    const target = db as unknown as Record<string, unknown>;
    // Reattach do MESMO objeto (cache nativo por nome) não deve embrulhar duas
    // vezes — cada camada dispararia o evento de novo.
    if (target[MARKER] === true) return;
    safely(() => {
      Object.defineProperty(db, MARKER, { value: true, enumerable: false });
    });

    installUpdateHook(db);
    safely(() => wrapExecutors(target));

    // `transaction(fn)` entrega um tx que é OUTRO objeto, com execute próprio —
    // embrulhar db.execute não cobre `tx.execute("DELETE FROM t")`.
    safely(() => {
      const original = target["transaction"];
      if (typeof original !== "function") return;
      const bound = (original as (fn: (tx: unknown) => Promise<void>) => Promise<void>).bind(db);
      target["transaction"] = (fn: (tx: unknown) => Promise<void>) =>
        bound((tx) => {
          if (tx && typeof tx === "object") {
            safely(() => wrapExecutors(tx as Record<string, unknown>));
          }
          return fn(tx);
        });
    });

    // Statement preparado e reexecutado N vezes: o hook cobre as linhas, mas
    // DDL/delete-total precisam do sniff a cada execução — daí embrulhar o
    // statement e não só o prepare.
    safely(() => {
      const original = target["prepareStatement"];
      if (typeof original !== "function") return;
      const bound = (original as (sql: string) => unknown).bind(db);
      target["prepareStatement"] = (sql: string) => {
        const statement = bound(sql);
        if (statement && typeof statement === "object") {
          safely(() => {
            const record = statement as Record<string, unknown>;
            for (const method of ["execute", "executeSync"] as const) {
              const run = record[method];
              if (typeof run !== "function") continue;
              const runBound = (run as (...a: unknown[]) => unknown).bind(statement);
              record[method] = (...args: unknown[]) => {
                const result = runBound(...args);
                if (result instanceof Promise) {
                  return result.then((value) => {
                    onSql(sql);
                    return value;
                  });
                }
                onSql(sql);
                return result;
              };
            }
          });
        }
        return statement;
      };
    });

    // close/delete: a bridge precisa falhar com mensagem legível em vez de
    // deixar o driver lançar algo opaco. Não desregistramos a instância — o
    // banco desapareceria do sidebar com a seleção do Studio apontando para
    // o nada.
    for (const method of ["close", "closeAsync", "delete"] as const) {
      safely(() => {
        const original = target[method];
        if (typeof original !== "function") return;
        const bound = (original as (...a: unknown[]) => unknown).bind(db);
        target[method] = (...args: unknown[]) => {
          const result = bound(...args);
          markClosed();
          return result;
        };
      });
    }
  }

  /**
   * `updateHook` é slot ÚNICO: chamar de novo substitui o callback anterior.
   * Instalamos o nosso no nativo e trocamos o MÉTODO no objeto, guardando o
   * callback do app — assim quem chegar depois (o app, o Drizzle) registra no
   * nosso multiplexador em vez de nos derrubar.
   *
   * Instalamos dentro do `open`, portanto antes de qualquer código do app tocar
   * o banco; o caso inverso (app instalando primeiro) não existe porque `open`
   * é a única porta e nós a controlamos.
   */
  function installUpdateHook(db: OpSqliteDatabaseLike): void {
    hookInstalled = false;
    multiplexed = false;
    let appHook: ((event: OpSqliteUpdateEvent) => void) | null = null;

    const dispatch = (event: OpSqliteUpdateEvent): void => {
      // finally e não sequência: se o hook do app lançar, o nosso ainda roda e
      // a exceção propaga como propagaria sem nós no meio.
      try {
        if (appHook) appHook(event);
      } finally {
        safely(() => {
          adapter.notifyNativeChange(
            instanceId,
            event?.table ?? "*",
            typeof event?.rowId === "number" ? event.rowId : null,
            event?.operation,
          );
        });
      }
    };

    try {
      // Em build libsql/Turso os hooks são compilados fora: o método não
      // existe, ou existe no JS e lança no nativo.
      if (typeof db.updateHook !== "function") return;
      db.updateHook(dispatch);
      hookInstalled = true;
    } catch {
      hookInstalled = false;
      return;
    }

    safely(() => {
      Object.defineProperty(db, "updateHook", {
        configurable: true,
        writable: true,
        enumerable: false,
        // Só guardamos o callback do app; nunca repassamos ao nativo, senão
        // perderíamos o nosso. `updateHook(null)` do app remove só o dele.
        value: (callback: ((event: OpSqliteUpdateEvent) => void) | null) => {
          appHook = typeof callback === "function" ? callback : null;
        },
      });
      multiplexed = true;
    });
  }

  function markClosed(): void {
    closed = true;
  }

  return {
    database,
    attach,
    markClosed,
    // Sem multiplexação estamos sujeitos a ser derrubados por um updateHook do
    // app, então não podemos prometer realtime por hook: o core passa a emitir
    // direto no caminho do Studio em vez de esperar o eco.
    hasChangeListener: () => hookInstalled && multiplexed,
    diagnostics: () => ({ updateHook: hookInstalled, multiplex: multiplexed }),
  };
}
