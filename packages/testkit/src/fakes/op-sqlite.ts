import { DatabaseSync } from "node:sqlite";
import type { OpSqliteDatabaseLike, OpSqliteUpdateEvent } from "@rnsi/runtime";

/**
 * Banco op-sqlite falso com SQL REAL (node:sqlite) atrás da API do op-sqlite.
 *
 * Duas coisas o tornam útil como oráculo em vez de mock:
 *
 * 1. `execute` devolve o mesmo shape que o C++ do op-sqlite realmente monta —
 *    `insertId` só aparece quando `rowsAffected > 0 && insertId != 0`.
 * 2. O `updateHook` simulado respeita os BURACOS documentados do
 *    `sqlite3_update_hook`: não dispara em `DELETE FROM t` sem WHERE (truncate
 *    optimization) nem em DDL. É exatamente por isso que o farejamento de SQL
 *    continua existindo, então o fake precisa ser fiel nisso.
 */
export interface FakeOpSqlite extends OpSqliteDatabaseLike {
  raw: DatabaseSync;
  /** Statements que o app executou, na ordem. */
  executed: string[];
  /** Quantas vezes o updateHook nativo foi (re)instalado. */
  hookInstalls: number;
}

export interface FakeOpSqliteOptions {
  setupSql?: string;
  /** `false` simula build libsql/Turso, onde os hooks são compilados fora. */
  updateHook?: boolean;
  /** `false` simula um HostObject JSI cujo método não pode ser sobrescrito. */
  updateHookWritable?: boolean;
}

const QUERY_RE = /^\s*(select|pragma|with|explain)\b/i;
const DDL_RE = /^\s*(create|drop|alter)\b/i;
const OPERATION_RE = /^\s*(insert|replace|update|delete)\b/i;

function statementTable(sql: string): string {
  const match =
    /^(?:insert|replace)\s+into\s+"?([A-Za-z_]\w*)/i.exec(sql) ||
    /^update\s+"?([A-Za-z_]\w*)/i.exec(sql) ||
    /^delete\s+from\s+"?([A-Za-z_]\w*)/i.exec(sql);
  return match?.[1] ?? "unknown";
}

export function createFakeOpSqlite(options: FakeOpSqliteOptions = {}): FakeOpSqlite {
  const { setupSql, updateHook = true, updateHookWritable = true } = options;
  const raw = new DatabaseSync(":memory:");
  if (setupSql) raw.exec(setupSql);

  const executed: string[] = [];
  let hook: ((event: OpSqliteUpdateEvent) => void) | null = null;
  let hookInstalls = 0;

  /** Conteúdo da tabela indexado por rowid — base do diff que simula o hook. */
  function snapshot(table: string): Map<number, string> {
    try {
      const rows = raw.prepare(`SELECT rowid AS __rid, * FROM "${table}"`).all();
      return new Map(
        rows.map((row) => {
          const record = row as Record<string, unknown>;
          return [Number(record["__rid"]), JSON.stringify(record)];
        }),
      );
    } catch {
      return new Map();
    }
  }

  /**
   * O hook nativo dispara UMA VEZ POR LINHA, com o rowid real da linha afetada
   * — não com `lastInsertRowId`, que num UPDATE carrega o rowid do último
   * INSERT anterior. Reproduzimos isso por diff de snapshot em vez de adivinhar,
   * porque o rowid certo é o que separa dois eventos na janela de dedup do
   * adapter.
   *
   * E, crucialmente, o fake sabe o que o hook real NÃO cobre: DDL e
   * `DELETE FROM t` sem WHERE (truncate optimization).
   */
  function fireHook(sql: string, before: Map<number, string> | null): void {
    if (!hook || !before) return;
    if (DDL_RE.test(sql)) return;
    const operation = OPERATION_RE.exec(sql)?.[1]?.toUpperCase();
    if (!operation) return;
    if (operation === "DELETE" && !/\bwhere\b/i.test(sql)) return;

    const table = statementTable(sql);
    const after = snapshot(table);
    const emit = (op: string, rowId: number): void => hook?.({ table, operation: op, rowId });

    for (const [rowId, value] of after) {
      const previous = before.get(rowId);
      if (previous === undefined) emit("INSERT", rowId);
      else if (previous !== value) emit("UPDATE", rowId);
    }
    for (const rowId of before.keys()) {
      if (!after.has(rowId)) emit("DELETE", rowId);
    }
  }

  function run(
    sql: string,
    params: unknown[],
  ): { rows: unknown[]; rowsAffected: number; insertId?: number } {
    executed.push(sql);

    // Multi-statement: o op-sqlite itera todos; node:sqlite só aceita via exec.
    if (sql.trim().replace(/;\s*$/, "").includes(";")) {
      const parts = sql
        .split(";")
        .map((p) => p.trim())
        .filter(Boolean);
      const before = parts.map((part) =>
        hook && !DDL_RE.test(part) ? snapshot(statementTable(part)) : null,
      );
      raw.exec(sql);
      parts.forEach((part, index) => fireHook(part, before[index] ?? null));
      return { rows: [], rowsAffected: 0 };
    }

    const bound = params as Array<string | number | null>;
    if (QUERY_RE.test(sql)) {
      const rows = raw
        .prepare(sql)
        .all(...bound)
        .map((row) => ({ ...(row as Record<string, unknown>) }));
      return { rows, rowsAffected: 0 };
    }

    const before = hook && !DDL_RE.test(sql) ? snapshot(statementTable(sql)) : null;
    const info = raw.prepare(sql).run(...bound);
    const rowsAffected = Number(info.changes);
    const lastInsertRowId = Number(info.lastInsertRowid);
    fireHook(sql, before);
    // Espelha o C++: insertId só quando há linhas afetadas e não é 0.
    return rowsAffected > 0 && lastInsertRowId !== 0
      ? { rows: [], rowsAffected, insertId: lastInsertRowId }
      : { rows: [], rowsAffected };
  }

  const db: FakeOpSqlite = {
    raw,
    executed,
    get hookInstalls() {
      return hookInstalls;
    },
    execute: async (sql, params = []) => run(sql, params),
    executeSync: (sql, params = []) => run(sql, params),
    executeBatch: async (commands) => {
      for (const command of commands as unknown[]) {
        const [sql, params] = Array.isArray(command) ? command : [command, []];
        if (typeof sql === "string") run(sql, (params as unknown[]) ?? []);
      }
      return { rowsAffected: 0 };
    },
    transaction: async (fn) => {
      raw.exec("BEGIN");
      try {
        // O tx é OUTRO objeto, com execute próprio — é o ponto que uma
        // instrumentação ingênua deixa passar.
        await fn({
          execute: async (sql: string, params: unknown[] = []) => run(sql, params),
          executeSync: (sql: string, params: unknown[] = []) => run(sql, params),
          commit: async () => raw.exec("COMMIT"),
          rollback: () => raw.exec("ROLLBACK"),
        });
        raw.exec("COMMIT");
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
    prepareStatement: (sql: string) => ({
      execute: async (params: unknown[] = []) => run(sql, params),
    }),
    close: () => raw.close(),
  };

  if (updateHook) {
    const install = (callback: ((event: OpSqliteUpdateEvent) => void) | null): void => {
      hookInstalls += 1;
      hook = typeof callback === "function" ? callback : null;
    };
    if (updateHookWritable) {
      db.updateHook = install;
    } else {
      Object.defineProperty(db, "updateHook", {
        value: install,
        writable: false,
        configurable: false,
        enumerable: true,
      });
    }
  }

  return db;
}
