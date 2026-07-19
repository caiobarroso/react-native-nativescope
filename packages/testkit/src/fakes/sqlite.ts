import { DatabaseSync } from "node:sqlite";
import type { SQLiteDatabaseLike } from "@rnsi/runtime";

/**
 * SQLite REAL (node:sqlite) atrás da interface do expo-sqlite.
 * Semântica de SQL de verdade nos testes — sem mock de engine.
 */
export function createNodeSqlite(setupSql?: string): SQLiteDatabaseLike & {
  raw: DatabaseSync;
} {
  const db = new DatabaseSync(":memory:");
  if (setupSql) db.exec(setupSql);

  return {
    raw: db,
    async getAllAsync(sql, params = []) {
      const rows = db.prepare(sql).all(...(params as Array<string | number | null>));
      // node:sqlite devolve objetos com prototype null — normaliza
      return rows.map((row) => ({ ...(row as Record<string, unknown>) }));
    },
    async runAsync(sql, params = []) {
      const result = db.prepare(sql).run(...(params as Array<string | number | null>));
      return {
        changes: Number(result.changes),
        lastInsertRowId: Number(result.lastInsertRowid),
      };
    },
  };
}
