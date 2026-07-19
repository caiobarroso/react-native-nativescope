import type { CellValue, ChangeSource, RowRef, TableSchema, Row } from "@rnsi/protocol";
import type { DatabaseAdapter, DatabaseChange } from "../adapter.ts";

/**
 * Interface mínima de um banco expo-sqlite (SDK 51+). O shim passa o banco
 * real; os testes passam node:sqlite embrulhado nesta mesma interface.
 */
export interface SQLiteDatabaseLike {
  getAllAsync(sql: string, params?: unknown[]): Promise<Array<Record<string, unknown>>>;
  runAsync(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowId: number }>;
}

export interface ExpoSqliteAdapter extends DatabaseAdapter {
  /** Chamado pelo shim a cada openDatabase*. Idempotente por nome. */
  registerDatabase(
    instanceId: string,
    db: SQLiteDatabaseLike,
    options?: { hasChangeListener?: boolean },
  ): void;
  /** Chamado pelo shim quando o hook nativo dispara. */
  notifyNativeChange(instanceId: string, table: string, rowId: number | null): void;
}

const ECHO_TTL_MS = 800;
const DEFAULT_SELECT_LIMIT = 200;
const ROWID_ALIAS = "__rnsi_rowid__";

/** Identificadores SQL sempre entre aspas duplas, escapadas. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function toParam(value: CellValue): string | number | null {
  if (value !== null && typeof value === "object") {
    throw new Error("escrita de BLOB não suportada no MVP");
  }
  return value;
}

function toCell(value: unknown): CellValue {
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Uint8Array) {
    let binary = "";
    for (const byte of value) binary += String.fromCharCode(byte);
    // btoa indisponível em alguns runtimes RN — mas Uint8Array de SQLite em
    // RN chega como base64 na prática; aqui cobrimos o caminho node.
    return { blobBase64: globalThis.btoa ? globalThis.btoa(binary) : binary };
  }
  return String(value);
}

export function createExpoSqliteAdapter(): ExpoSqliteAdapter {
  interface Tracked {
    db: SQLiteDatabaseLike;
    hasChangeListener: boolean;
    listeners: Set<(change: DatabaseChange) => void>;
    /** `${table}` → expiração — mutações do Studio pendentes de eco. */
    pendingStudioWrites: Map<string, number>;
  }

  const tracked = new Map<string, Tracked>();

  function get(instanceId: string): Tracked {
    const t = tracked.get(instanceId);
    if (!t) throw new Error(`unknown instance: ${instanceId}`);
    return t;
  }

  function emit(t: Tracked, change: DatabaseChange): void {
    for (const listener of t.listeners) listener(change);
  }

  function consumeStudioEcho(t: Tracked, table: string): boolean {
    const expiresAt = t.pendingStudioWrites.get(table);
    if (expiresAt !== undefined) {
      t.pendingStudioWrites.delete(table);
      if (Date.now() < expiresAt) return true;
    }
    return false;
  }

  /** Mutação vinda do Studio: marca pendente; se não há hook nativo, emite direto. */
  function markStudioMutation(
    t: Tracked,
    table: string,
    operation: DatabaseChange["operation"],
    rowId: number | null,
  ): void {
    if (t.hasChangeListener) {
      t.pendingStudioWrites.set(table, Date.now() + ECHO_TTL_MS);
    } else {
      emit(t, { table, rowId, operation, source: "studio" });
    }
  }

  async function tableIdentity(db: SQLiteDatabaseLike, table: string): Promise<TableSchema["identity"]> {
    try {
      await db.getAllAsync(`SELECT rowid FROM ${quoteIdent(table)} LIMIT 1`);
      return "rowid";
    } catch {
      /* WITHOUT ROWID ou view */
    }
    const columns = await db.getAllAsync(`PRAGMA table_info(${quoteIdent(table)})`);
    return columns.some((c) => Number(c["pk"]) > 0) ? "pk" : "none";
  }

  function refToWhere(ref: RowRef): { clause: string; params: Array<string | number | null> } {
    if ("rowid" in ref) return { clause: "rowid = ?", params: [ref.rowid] };
    const columns = Object.keys(ref.pk);
    if (columns.length === 0) throw new Error("ref de PK vazia");
    return {
      clause: columns.map((c) => `${quoteIdent(c)} = ?`).join(" AND "),
      params: columns.map((c) => toParam(ref.pk[c] ?? null)),
    };
  }

  return {
    providerId: "expo-sqlite",
    label: "SQLite",
    capabilities: ["database.query", "database.mutate", "database.watch"],

    instances() {
      return [...tracked.keys()].sort().map((instanceId) => ({
        instanceId,
        label: instanceId,
      }));
    },

    registerDatabase(instanceId, db, options = {}) {
      if (tracked.has(instanceId)) return;
      tracked.set(instanceId, {
        db,
        hasChangeListener: options.hasChangeListener ?? false,
        listeners: new Set(),
        pendingStudioWrites: new Map(),
      });
    },

    notifyNativeChange(instanceId, table, rowId) {
      const t = tracked.get(instanceId);
      if (!t) return;
      const source: ChangeSource = consumeStudioEcho(t, table) ? "studio" : "app";
      // O hook do expo-sqlite entrega {table, rowId} mas NÃO a operação.
      emit(t, { table, rowId, operation: "unknown", source });
    },

    async tables(instanceId) {
      const { db } = get(instanceId);
      const names = await db.getAllAsync(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      );
      const result: TableSchema[] = [];
      for (const row of names) {
        const name = String(row["name"]);
        const columnsRaw = await db.getAllAsync(`PRAGMA table_info(${quoteIdent(name)})`);
        const countRow = await db.getAllAsync(
          `SELECT COUNT(*) AS n FROM ${quoteIdent(name)}`,
        );
        result.push({
          name,
          columns: columnsRaw.map((c) => ({
            name: String(c["name"]),
            declaredType: String(c["type"] ?? ""),
            notNull: Number(c["notnull"]) === 1,
            pkIndex: Number(c["pk"]),
          })),
          rowCount: Number(countRow[0]?.["n"] ?? 0),
          identity: await tableIdentity(db, name),
        });
      }
      return result;
    },

    async rows(instanceId, table, options) {
      const { db } = get(instanceId);
      const identity = await tableIdentity(db, table);

      // orderBy validado contra as colunas reais — nunca interpolado cru.
      let orderClause = "";
      if (options.orderBy) {
        const columns = await db.getAllAsync(`PRAGMA table_info(${quoteIdent(table)})`);
        const valid = columns.some((c) => String(c["name"]) === options.orderBy);
        if (!valid) throw new Error(`coluna desconhecida: ${options.orderBy}`);
        orderClause = ` ORDER BY ${quoteIdent(options.orderBy)} ${options.direction === "desc" ? "DESC" : "ASC"}`;
      }

      const select =
        identity === "rowid"
          ? `SELECT rowid AS ${ROWID_ALIAS}, * FROM ${quoteIdent(table)}`
          : `SELECT * FROM ${quoteIdent(table)}`;
      const raw = await db.getAllAsync(`${select}${orderClause} LIMIT ? OFFSET ?`, [
        options.limit,
        options.offset,
      ]);
      const countRow = await db.getAllAsync(`SELECT COUNT(*) AS n FROM ${quoteIdent(table)}`);

      let pkColumns: string[] = [];
      if (identity === "pk") {
        const columns = await db.getAllAsync(`PRAGMA table_info(${quoteIdent(table)})`);
        pkColumns = columns
          .filter((c) => Number(c["pk"]) > 0)
          .sort((a, b) => Number(a["pk"]) - Number(b["pk"]))
          .map((c) => String(c["name"]));
      }

      const rows: Row[] = raw.map((record) => {
        const cells: Record<string, CellValue> = {};
        let rowid: number | null = null;
        for (const [column, value] of Object.entries(record)) {
          if (column === ROWID_ALIAS) {
            rowid = Number(value);
          } else {
            cells[column] = toCell(value);
          }
        }
        let ref: Row["ref"] = null;
        if (identity === "rowid" && rowid !== null) {
          ref = { rowid };
        } else if (identity === "pk") {
          const pk: Record<string, CellValue> = {};
          for (const column of pkColumns) pk[column] = cells[column] ?? null;
          ref = { pk };
        }
        return { ref, cells };
      });

      return { rows, total: Number(countRow[0]?.["n"] ?? 0) };
    },

    async update(instanceId, table, ref, set) {
      const t = get(instanceId);
      const columns = Object.keys(set);
      if (columns.length === 0) return;
      const where = refToWhere(ref);
      markStudioMutation(t, table, "update", "rowid" in ref ? ref.rowid : null);
      await t.db.runAsync(
        `UPDATE ${quoteIdent(table)} SET ${columns.map((c) => `${quoteIdent(c)} = ?`).join(", ")} WHERE ${where.clause}`,
        [...columns.map((c) => toParam(set[c] ?? null)), ...where.params],
      );
    },

    async insert(instanceId, table, values) {
      const t = get(instanceId);
      const columns = Object.keys(values);
      markStudioMutation(t, table, "insert", null);
      if (columns.length === 0) {
        await t.db.runAsync(`INSERT INTO ${quoteIdent(table)} DEFAULT VALUES`);
        return;
      }
      await t.db.runAsync(
        `INSERT INTO ${quoteIdent(table)} (${columns.map(quoteIdent).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
        columns.map((c) => toParam(values[c] ?? null)),
      );
    },

    async delete(instanceId, table, ref) {
      const t = get(instanceId);
      const where = refToWhere(ref);
      markStudioMutation(t, table, "delete", "rowid" in ref ? ref.rowid : null);
      await t.db.runAsync(`DELETE FROM ${quoteIdent(table)} WHERE ${where.clause}`, where.params);
    },

    async execute(instanceId, sql) {
      const t = get(instanceId);
      const trimmed = sql.trim().replace(/;\s*$/, "");
      const isQuery = /^(select|pragma|with|explain)\b/i.test(trimmed);
      if (isQuery) {
        // LIMIT implícito: console SQL nunca derruba a UI com 200k linhas.
        const hasLimit = /\blimit\s+\d+/i.test(trimmed);
        const final = hasLimit ? trimmed : `${trimmed} LIMIT ${DEFAULT_SELECT_LIMIT}`;
        const raw = await t.db.getAllAsync(final);
        const columns = raw.length > 0 ? Object.keys(raw[0]!) : [];
        return {
          kind: "rows",
          columns,
          rows: raw.map((record) => {
            const cells: Record<string, CellValue> = {};
            for (const [column, value] of Object.entries(record)) cells[column] = toCell(value);
            return cells;
          }),
        };
      }
      // Mutação manual: o eco vem como "app"… a menos que marquemos. Sem
      // saber a tabela afetada, marcamos como studio via evento direto.
      const result = await t.db.runAsync(trimmed);
      if (!t.hasChangeListener) {
        emit(t, { table: "*", rowId: null, operation: "unknown", source: "studio" });
      }
      return { kind: "mutation", rowsAffected: result.changes };
    },

    subscribe(instanceId, listener) {
      const t = get(instanceId);
      t.listeners.add(listener);
      return () => t.listeners.delete(listener);
    },
  };
}
