import {
  CELL_PREVIEW_LIMIT,
  type CellValue,
  type ChangeSource,
  type RowRef,
  type TableSchema,
  type Row,
} from "@rnsi/protocol";
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
const RECENT_EVENT_LIMIT = 2_000;
const DEFAULT_SELECT_LIMIT = 200;
const ROWID_ALIAS = "__rnsi_rowid__";
/** Contagem cacheada vale por este tempo além da invalidação por evento. */
const COUNT_TTL_MS = 3000;

/** Identificadores SQL sempre entre aspas duplas, escapadas. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function toParam(value: CellValue): string | number | null {
  if (value !== null && typeof value === "object") {
    throw new Error("BLOB writes are not supported");
  }
  return value;
}

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Base64 sem depender de `btoa` — o React Native NÃO o polifila (nem o Hermes),
 * e o fallback anterior devolvia os bytes CRUS rotulados como base64, então o
 * Studio decodificava lixo. O caminho nunca doeu porque nenhuma tabela nossa
 * tinha BLOB.
 *
 * Em blocos múltiplos de 3 para que cada pedaço feche em 4 caracteres: só o
 * último pode precisar de padding, então juntar os pedaços é concatenação
 * simples. O loop anterior concatenava 1 char por byte, o que num BLOB de
 * alguns MB é stall de JS thread.
 */
function toBase64(bytes: Uint8Array): string {
  const size = bytes.length;
  if (size === 0) return "";
  const CHUNK_BYTES = 3072;
  const parts: string[] = [];
  for (let start = 0; start < size; start += CHUNK_BYTES) {
    const end = Math.min(start + CHUNK_BYTES, size);
    let chunk = "";
    let i = start;
    for (; i + 2 < end; i += 3) {
      const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
      chunk +=
        BASE64_CHARS[(n >> 18) & 63]! +
        BASE64_CHARS[(n >> 12) & 63]! +
        BASE64_CHARS[(n >> 6) & 63]! +
        BASE64_CHARS[n & 63]!;
    }
    // CHUNK_BYTES é múltiplo de 3, logo só o último bloco tem resto.
    const rest = end - i;
    if (rest === 1) {
      const n = bytes[i]! << 16;
      chunk += `${BASE64_CHARS[(n >> 18) & 63]!}${BASE64_CHARS[(n >> 12) & 63]!}==`;
    } else if (rest === 2) {
      const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
      chunk += `${BASE64_CHARS[(n >> 18) & 63]!}${BASE64_CHARS[(n >> 12) & 63]!}${BASE64_CHARS[(n >> 6) & 63]!}=`;
    }
    parts.push(chunk);
  }
  return parts.join("");
}

function toCell(value: unknown): CellValue {
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  // BLOB chega em três formas conforme o driver: Uint8Array (expo-sqlite,
  // node:sqlite), ArrayBuffer cru (op-sqlite faz `new ArrayBuffer` + memcpy)
  // ou outra view. Sem os três ramos um ArrayBuffer cairia no String(value)
  // lá embaixo e a célula viajaria como a string "[object ArrayBuffer]".
  if (value instanceof Uint8Array) return { blobBase64: toBase64(value) };
  if (value instanceof ArrayBuffer) return { blobBase64: toBase64(new Uint8Array(value)) };
  if (ArrayBuffer.isView(value)) {
    // byteOffset/byteLength importam: uma view parcial não deve arrastar o
    // buffer inteiro.
    return {
      blobBase64: toBase64(
        new Uint8Array(value.buffer as ArrayBuffer, value.byteOffset, value.byteLength),
      ),
    };
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
    schemaCache: Map<string, TableInfo>;
    /**
     * Contagem em duas fases (plano de grandes volumes §A3): estimativa
     * imediata via MAX(rowid), COUNT(*) exato em background populando o
     * cache. Um COUNT(*) numa tabela de milhões de linhas nunca fica no
     * caminho crítico de uma resposta.
     */
    countCache: Map<string, { value: number; exact: boolean; expiresAt: number }>;
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
    while (t.recentEvents.size > RECENT_EVENT_LIMIT) {
      const oldest = t.recentEvents.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      t.recentEvents.delete(oldest);
    }
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
    invalidateCount(t, table);
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
    columns: TableSchema["columns"];
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
      columns: columns.map((c) => ({
        name: String(c["name"]),
        declaredType: String(c["type"] ?? ""),
        notNull: Number(c["notnull"]) === 1,
        pkIndex: Number(c["pk"]),
      })),
    };
    t.schemaCache.set(table, info);
    return info;
  }

  /**
   * Contagem em duas fases. Tabela rowid sem cache: devolve MAX(rowid)
   * (custo ~O(log n)) como estimativa AGORA e dispara o COUNT(*) exato em
   * background — o refresh seguinte pega o valor exato do cache.
   */
  async function tableCount(
    t: Tracked,
    table: string,
    identity: TableSchema["identity"],
  ): Promise<{ total: number; exact: boolean }> {
    const cached = t.countCache.get(table);
    if (cached && cached.expiresAt > Date.now()) {
      return { total: cached.value, exact: cached.exact };
    }
    if (identity === "rowid") {
      const maxRow = await t.db.getAllAsync(
        `SELECT MAX(rowid) AS m FROM ${quoteIdent(table)}`,
      );
      const estimate = Number(maxRow[0]?.["m"] ?? 0);
      t.countCache.set(table, {
        value: estimate,
        exact: false,
        expiresAt: Date.now() + COUNT_TTL_MS,
      });
      void t.db
        .getAllAsync(`SELECT COUNT(*) AS n FROM ${quoteIdent(table)}`)
        .then((row) => {
          t.countCache.set(table, {
            value: Number(row[0]?.["n"] ?? 0),
            exact: true,
            expiresAt: Date.now() + COUNT_TTL_MS,
          });
        })
        .catch(() => {});
      return { total: estimate, exact: false };
    }
    const row = await t.db.getAllAsync(`SELECT COUNT(*) AS n FROM ${quoteIdent(table)}`);
    const total = Number(row[0]?.["n"] ?? 0);
    t.countCache.set(table, { value: total, exact: true, expiresAt: Date.now() + COUNT_TTL_MS });
    return { total, exact: true };
  }

  /** Mudança na tabela: a contagem cacheada deixou de valer. */
  function invalidateCount(t: Tracked, table: string): void {
    if (table === "*") t.countCache.clear();
    else t.countCache.delete(table);
  }

  function refToWhere(ref: RowRef): { clause: string; params: Array<string | number | null> } {
    if ("rowid" in ref) return { clause: "rowid = ?", params: [ref.rowid] };
    const columns = Object.keys(ref.pk);
    if (columns.length === 0) throw new Error("primary-key reference is empty");
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
        countCache: new Map(),
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
      invalidateCount(t, table);
      const source: ChangeSource = consumeStudioEcho(t, table) ? "studio" : "app";
      // O hook do expo-sqlite entrega {table, rowId} mas NÃO a operação.
      emitOnce(t, { table, rowId, operation: "unknown", source });
    },

    notifyAppMutation(instanceId, table, rowId) {
      const t = tracked.get(instanceId);
      if (!t) return;
      invalidateCount(t, table);
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
      const t = get(instanceId);
      const names = await t.db.getAllAsync(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      );
      const result: TableSchema[] = [];
      for (const row of names) {
        const name = String(row["name"]);
        // Colunas e identidade vêm do cache; contagem em duas fases — o
        // refresh de schema não custa um COUNT(*) full-scan por tabela.
        const info = await tableInfo(t, name);
        const count = await tableCount(t, name, info.identity);
        result.push({
          name,
          columns: info.columns,
          rowCount: count.total,
          rowCountIsEstimate: !count.exact,
          identity: info.identity,
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
          throw new Error(`unknown column: ${options.orderBy}`);
        }
        orderClause = ` ORDER BY ${quoteIdent(options.orderBy)} ${options.direction === "desc" ? "DESC" : "ASC"}`;
      }

      const select =
        identity === "rowid"
          ? `SELECT rowid AS ${ROWID_ALIAS}, * FROM ${quoteIdent(table)}`
          : `SELECT * FROM ${quoteIdent(table)}`;

      // Keyset (rowid, sem orderBy): página 100.000 custa o mesmo que a
      // página 1 — OFFSET percorre e descarta linhas, rowid > ? não.
      const useKeyset = identity === "rowid" && !options.orderBy;
      let raw: Array<Record<string, unknown>>;
      if (useKeyset && options.afterRowid !== undefined) {
        raw = await db.getAllAsync(
          `${select} WHERE rowid > ? ORDER BY rowid LIMIT ?`,
          [options.afterRowid, options.limit],
        );
      } else if (useKeyset) {
        raw = await db.getAllAsync(`${select} ORDER BY rowid LIMIT ? OFFSET ?`, [
          options.limit,
          options.offset,
        ]);
      } else {
        raw = await db.getAllAsync(`${select}${orderClause} LIMIT ? OFFSET ?`, [
          options.limit,
          options.offset,
        ]);
      }
      const count = await tableCount(t, table, identity);

      const rows: Row[] = raw.map((record) => {
        const cells: Record<string, CellValue> = {};
        const truncatedColumns: string[] = [];
        let rowid: number | null = null;
        for (const [column, value] of Object.entries(record)) {
          if (column === ROWID_ALIAS) {
            rowid = Number(value);
            continue;
          }
          // Células grandes viajam truncadas — o conteúdo completo vem por
          // database.cell via stream. A listagem nunca carrega um BLOB de
          // 200 MB ou um JSON gigante inteiro.
          const cell = toCell(value);
          if (typeof cell === "string" && cell.length > CELL_PREVIEW_LIMIT) {
            cells[column] = cell.slice(0, CELL_PREVIEW_LIMIT);
            truncatedColumns.push(column);
          } else if (
            cell !== null &&
            typeof cell === "object" &&
            cell.blobBase64.length > CELL_PREVIEW_LIMIT
          ) {
            cells[column] = { blobBase64: cell.blobBase64.slice(0, CELL_PREVIEW_LIMIT) };
            truncatedColumns.push(column);
          } else {
            cells[column] = cell;
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
        return truncatedColumns.length > 0 ? { ref, cells, truncatedColumns } : { ref, cells };
      });

      return { rows, total: count.total, totalIsEstimate: !count.exact };
    },

    async cell(instanceId, table, ref, column) {
      const t = get(instanceId);
      const { columnNames } = await tableInfo(t, table);
      if (!columnNames.includes(column)) {
        throw new Error(`unknown column: ${column}`);
      }
      const where = refToWhere(ref);
      const raw = await t.db.getAllAsync(
        `SELECT ${quoteIdent(column)} AS v FROM ${quoteIdent(table)} WHERE ${where.clause} LIMIT 1`,
        where.params,
      );
      const value = raw[0]?.["v"];
      if (value === undefined || value === null) return null;
      const cell = toCell(value);
      if (cell === null) return null;
      if (typeof cell === "number") return { data: String(cell), kind: "number" };
      if (typeof cell === "string") return { data: cell, kind: "text" };
      return { data: cell.blobBase64, kind: "blob" };
    },

    async search(instanceId, query, limit) {
      const t = get(instanceId);
      const names = await t.db.getAllAsync(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      );
      const matches: Array<{ table: string; ref: RowRef | null; snippet: string }> = [];
      const pattern = `%${query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      let complete = true;
      for (const row of names) {
        if (matches.length >= limit) {
          complete = false;
          break;
        }
        const table = String(row["name"]);
        const info = await tableInfo(t, table);
        if (info.columnNames.length === 0) continue;
        // LIKE roda NO device (thread nativa do SQLite): buscar em milhões
        // de linhas não transfere milhões de linhas — só os matches.
        const where = info.columnNames
          .map((c) => `${quoteIdent(c)} LIKE ? ESCAPE '\\'`)
          .join(" OR ");
        const params = info.columnNames.map(() => pattern);
        const select =
          info.identity === "rowid"
            ? `SELECT rowid AS ${ROWID_ALIAS}, * FROM ${quoteIdent(table)}`
            : `SELECT * FROM ${quoteIdent(table)}`;
        const remaining = limit - matches.length;
        const raw = await t.db.getAllAsync(`${select} WHERE ${where} LIMIT ?`, [
          ...params,
          remaining + 1,
        ]);
        if (raw.length > remaining) complete = false;
        for (const record of raw.slice(0, remaining)) {
          let ref: RowRef | null = null;
          if (info.identity === "rowid" && record[ROWID_ALIAS] !== undefined) {
            ref = { rowid: Number(record[ROWID_ALIAS]) };
          } else if (info.identity === "pk") {
            const pk: Record<string, CellValue> = {};
            for (const column of info.pkColumns) pk[column] = toCell(record[column]);
            ref = { pk };
          }
          const q = query.toLowerCase();
          const hit = Object.entries(record).find(
            ([column, value]) =>
              column !== ROWID_ALIAS &&
              typeof value !== "object" &&
              String(value ?? "").toLowerCase().includes(q),
          );
          const snippet = hit ? `${hit[0]}: ${String(hit[1])}` : table;
          matches.push({
            table,
            ref,
            snippet: snippet.length > 120 ? `${snippet.slice(0, 120)}…` : snippet,
          });
        }
      }
      return { matches, complete };
    },

    async *exportRows(instanceId, table) {
      const t = get(instanceId);
      const info = await tableInfo(t, table);
      // Keyset quando há rowid; OFFSET como fallback — sempre O(página).
      if (info.identity === "rowid") {
        let after: number | null = null;
        for (;;) {
          const raw: Array<Record<string, unknown>> = await t.db.getAllAsync(
            after === null
              ? `SELECT rowid AS ${ROWID_ALIAS}, * FROM ${quoteIdent(table)} ORDER BY rowid LIMIT 200`
              : `SELECT rowid AS ${ROWID_ALIAS}, * FROM ${quoteIdent(table)} WHERE rowid > ? ORDER BY rowid LIMIT 200`,
            after === null ? [] : [after],
          );
          for (const record of raw) {
            const cells: Record<string, CellValue> = {};
            for (const [column, value] of Object.entries(record)) {
              if (column !== ROWID_ALIAS) cells[column] = toCell(value);
            }
            yield cells;
          }
          const last = raw[raw.length - 1];
          if (raw.length < 200 || last === undefined) return;
          after = Number(last[ROWID_ALIAS]);
        }
      }
      let offset = 0;
      for (;;) {
        const raw: Array<Record<string, unknown>> = await t.db.getAllAsync(
          `SELECT * FROM ${quoteIdent(table)} LIMIT 200 OFFSET ?`,
          [offset],
        );
        for (const record of raw) {
          const cells: Record<string, CellValue> = {};
          for (const [column, value] of Object.entries(record)) cells[column] = toCell(value);
          yield cells;
        }
        if (raw.length < 200) return;
        offset += raw.length;
      }
    },

    async update(instanceId, table, ref, set) {
      const t = get(instanceId);
      const columns = Object.keys(set);
      if (columns.length === 0) return;
      const where = refToWhere(ref);
      markStudioMutation(t, table, "update", "rowid" in ref ? ref.rowid : null);
      try {
        await t.db.runAsync(
          `UPDATE ${quoteIdent(table)} SET ${columns.map((c) => `${quoteIdent(c)} = ?`).join(", ")} WHERE ${where.clause}`,
          [...columns.map((c) => toParam(set[c] ?? null)), ...where.params],
        );
      } catch (error) {
        t.pendingStudioWrites.delete(table);
        throw error;
      }
    },

    async insert(instanceId, table, values) {
      const t = get(instanceId);
      const columns = Object.keys(values);
      const info = await tableInfo(t, table);
      markStudioMutation(t, table, "insert", null);
      let lastInsertRowId: number | null = null;
      try {
        if (columns.length === 0) {
          const result = await t.db.runAsync(`INSERT INTO ${quoteIdent(table)} DEFAULT VALUES`);
          lastInsertRowId = Number(result.lastInsertRowId);
        } else {
          const result = await t.db.runAsync(
            `INSERT INTO ${quoteIdent(table)} (${columns.map(quoteIdent).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
            columns.map((c) => toParam(values[c] ?? null)),
          );
          lastInsertRowId = Number(result.lastInsertRowId);
        }
      } catch (error) {
        t.pendingStudioWrites.delete(table);
        throw error;
      }
      if (info.identity === "rowid" && Number.isFinite(lastInsertRowId)) {
        return { ref: { rowid: lastInsertRowId } };
      }
      if (info.identity === "pk" && info.pkColumns.every((column) => column in values)) {
        return {
          ref: {
            pk: Object.fromEntries(info.pkColumns.map((column) => [column, values[column] ?? null])),
          },
        };
      }
      return { ref: null };
    },

    async delete(instanceId, table, ref) {
      const t = get(instanceId);
      const where = refToWhere(ref);
      markStudioMutation(t, table, "delete", "rowid" in ref ? ref.rowid : null);
      try {
        await t.db.runAsync(`DELETE FROM ${quoteIdent(table)} WHERE ${where.clause}`, where.params);
      } catch (error) {
        t.pendingStudioWrites.delete(table);
        throw error;
      }
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
      // Mutação manual pode ser DDL — invalida schema e contagens inteiros.
      t.schemaCache.clear();
      t.countCache.clear();
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
