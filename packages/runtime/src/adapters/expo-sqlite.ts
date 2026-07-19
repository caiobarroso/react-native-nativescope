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
  /** Fallback do shim para mutações JS quando o hook nativo é tardio/incompleto. */
  notifyAppMutation(instanceId: string, table: string, rowId: number | null): void;
  /** Chamado pelo shim ao detectar DDL — invalida o cache de schema da tabela. */
  notifySchemaChanged(instanceId: string, table: string): void;
}

const ECHO_TTL_MS = 800;
const RECENT_EVENT_TTL_MS = 250;
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
    /** Eventos recentes do hook/fallback, para não duplicar nativo + fallback. */
    recentEvents: Map<string, number>;
    /** Cache de identidade/colunas por tabela — ver tableInfo. */
    schemaCache: Map<string, { identity: TableSchema["identity"]; columnNames: string[]; pkColumns: string[] }>;
  }

  const tracked = new Map<string, Tracked>();
  const registrationListeners = new Set<() => void>();

  function get(instanceId: string): Tracked {
    const t = tracked.get(instanceId);
    if (!t) throw new Error(`unknown instance: ${instanceId}`);
    return t;
  }

  function emit(t: Tracked, change: DatabaseChange): void {
    for (const listener of t.listeners) listener(change);
  }

  function recentKeys(table: string, rowId: number | null): string[] {
    return [`${table}:*`, rowId === null ? `${table}:*` : `${table}:${rowId}`];
  }

  /**
   * Dedup fallback×nativo com janela de 250ms. Trade-off consciente: dois
   * UPDATEs no MESMO row em <250ms viram um evento só, e um execAsync em
   * lote (chave `table:*`) suprime os eventos nativos da tabela na janela.
   * Os DADOS ficam certos (a UI refaz a consulta a cada evento) — é o
   * timeline que pode subcontar mudanças muito rápidas.
   */
  function emitOnce(t: Tracked, change: DatabaseChange): void {
    const now = Date.now();
    for (const [key, expiresAt] of t.recentEvents) {
      if (expiresAt <= now) t.recentEvents.delete(key);
    }
    if (recentKeys(change.table, change.rowId).some((key) => t.recentEvents.has(key))) {
      return;
    }
    t.recentEvents.set(
      change.rowId === null ? `${change.table}:*` : `${change.table}:${change.rowId}`,
      now + RECENT_EVENT_TTL_MS,
    );
    emit(t, change);
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

  interface TableInfo {
    identity: TableSchema["identity"];
    columnNames: string[];
    pkColumns: string[];
  }

  /**
   * Schema não muda a cada evento — o probe de identidade e o PRAGMA rodam
   * UMA vez por tabela e ficam em cache. Sem isto, cada refetch do grid
   * custava até 4 queries auxiliares no device. Invalidação: DDL detectado
   * pelo shim (notifySchemaChanged) ou mutação manual no console SQL.
   */
  async function tableInfo(t: Tracked, table: string): Promise<TableInfo> {
    const cached = t.schemaCache.get(table);
    if (cached) return cached;
    const identity = await tableIdentity(t.db, table);
    const columns = await t.db.getAllAsync(`PRAGMA table_info(${quoteIdent(table)})`);
    const info: TableInfo = {
      identity,
      columnNames: columns.map((c) => String(c["name"])),
      pkColumns: columns
        .filter((c) => Number(c["pk"]) > 0)
        .sort((a, b) => Number(a["pk"]) - Number(b["pk"]))
        .map((c) => String(c["name"])),
    };
    t.schemaCache.set(table, info);
    return info;
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
        recentEvents: new Map(),
        schemaCache: new Map(),
      });
      for (const listener of registrationListeners) listener();
    },

    onInstancesChanged(listener) {
      registrationListeners.add(listener);
      return () => registrationListeners.delete(listener);
    },

    notifyNativeChange(instanceId, table, rowId) {
      const t = tracked.get(instanceId);
      if (!t) return;
      const source: ChangeSource = consumeStudioEcho(t, table) ? "studio" : "app";
      // O hook do expo-sqlite entrega {table, rowId} mas NÃO a operação.
      emitOnce(t, { table, rowId, operation: "unknown", source });
    },

    notifyAppMutation(instanceId, table, rowId) {
      const t = tracked.get(instanceId);
      if (!t) return;
      const source: ChangeSource = consumeStudioEcho(t, table) ? "studio" : "app";
      emitOnce(t, { table, rowId, operation: "unknown", source });
    },

    notifySchemaChanged(instanceId, table) {
      const t = tracked.get(instanceId);
      if (!t) return;
      // DDL do app (CREATE/DROP/ALTER): invalida só a tabela afetada.
      t.schemaCache.delete(table);
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
          identity: (await tableInfo(get(instanceId), name)).identity,
        });
      }
      return result;
    },

    async rows(instanceId, table, options) {
      const t = get(instanceId);
      const { db } = t;
      const { identity, columnNames, pkColumns } = await tableInfo(t, table);

      // orderBy validado contra as colunas reais — nunca interpolado cru.
      let orderClause = "";
      if (options.orderBy) {
        if (!columnNames.includes(options.orderBy)) {
          throw new Error(`coluna desconhecida: ${options.orderBy}`);
        }
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
      // Mutação manual pode ser DDL — invalida o cache de schema inteiro.
      t.schemaCache.clear();
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
