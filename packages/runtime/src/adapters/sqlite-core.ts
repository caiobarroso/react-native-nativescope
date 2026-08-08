import {
  BLOB_PREVIEW_BYTES,
  CELL_PREVIEW_LIMIT,
  type CellValue,
  type ChangeSource,
  type RowRef,
  type TableSchema,
  type Row,
} from "@rnsi/protocol";
import type { DatabaseAdapter, DatabaseChange } from "../adapter.ts";

/**
 * Interface mínima de um banco SQLite. É o SEAM do módulo: qualquer engine que
 * saiba responder estes dois métodos ganha o inspetor inteiro (grid, console
 * SQL, export, busca, realtime) sem escrever uma linha de SQL.
 *
 * Hoje três implementações: expo-sqlite (nativa), op-sqlite (via bridge sobre
 * `execute`) e node:sqlite (nos testes). Deliberadamente estrutural — nenhum
 * driver é importado aqui.
 */
export interface SQLiteDatabaseLike {
  getAllAsync(sql: string, params?: unknown[]): Promise<Array<Record<string, unknown>>>;
  runAsync(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowId: number }>;
}

export interface SqliteAdapter extends DatabaseAdapter {
  /** Chamado pelo shim a cada abertura de banco. Idempotente por nome. */
  registerDatabase(
    instanceId: string,
    db: SQLiteDatabaseLike,
    options?: { hasChangeListener?: boolean },
  ): void;
  /**
   * Chamado pelo shim quando o hook nativo dispara. `operation` é opcional
   * porque nem todo driver a informa: o hook do expo-sqlite entrega só
   * {table, rowId}, enquanto o updateHook do op-sqlite entrega a operação.
   * Ausente ou desconhecida → "unknown".
   */
  notifyNativeChange(
    instanceId: string,
    table: string,
    rowId: number | null,
    operation?: string,
  ): void;
  /** Fallback do shim para mutações JS quando o hook nativo é tardio/incompleto. */
  notifyAppMutation(
    instanceId: string,
    table: string,
    rowId: number | null,
    operation?: string,
  ): void;
  /** Chamado pelo shim ao detectar DDL — invalida o cache de schema da tabela. */
  notifySchemaChanged(instanceId: string, table: string): void;
}

/**
 * A operação chega de fontes heterogêneas — ausente no expo-sqlite,
 * 'INSERT'/'UPDATE'/'DELETE' em maiúsculas no op-sqlite. Um valor fora do enum
 * do protocolo faria o `safeParse` do Studio rejeitar a mensagem INTEIRA e o
 * realtime morreria sem log e sem erro, então a coerção mora aqui, no ponto por
 * onde todo provider passa.
 */
function normalizeOperation(operation: string | undefined): DatabaseChange["operation"] {
  switch (typeof operation === "string" ? operation.toLowerCase() : "") {
    case "insert":
      return "insert";
    case "update":
      return "update";
    case "delete":
      return "delete";
    default:
      return "unknown";
  }
}

const ECHO_TTL_MS = 800;
const RECENT_EVENT_TTL_MS = 250;
const RECENT_EVENT_LIMIT = 2_000;
const DEFAULT_SELECT_LIMIT = 200;
const ROWID_ALIAS = "__rnsi_rowid__";
/** Contagem cacheada vale por este tempo além da invalidação por evento. */
const COUNT_TTL_MS = 3000;
/**
 * Até quantas linhas (medidas por MAX(rowid), o limite superior barato) vale
 * contar exato em linha. O COUNT(*) do SQLite varre o menor índice; nessa
 * ordem de grandeza é ~1 ms num device, muito mais barato que exibir um número
 * errado. Acima disso a contagem vira estimativa + COUNT(*) em background.
 */
const EXACT_COUNT_ROW_BUDGET = 50_000;

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

/**
 * `maxBytes` corta ANTES de codificar — é o que impede a listagem de percorrer
 * um BLOB de 5 MB inteiro para depois jogar fora tudo menos o preview.
 * `byteLength` é sempre o tamanho REAL, mesmo quando o base64 vem cortado: é o
 * único jeito de a UI dizer "(blob, 8.0 KB)" em vez de só "(blob)".
 */
function toBlobCell(bytes: Uint8Array, maxBytes?: number): CellValue {
  const byteLength = bytes.length;
  const slice =
    maxBytes !== undefined && byteLength > maxBytes ? bytes.subarray(0, maxBytes) : bytes;
  return { blobBase64: toBase64(slice), byteLength };
}

function toCell(value: unknown, maxBytes?: number): CellValue {
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  // BLOB chega em três formas conforme o driver: Uint8Array (expo-sqlite,
  // node:sqlite), ArrayBuffer cru (op-sqlite faz `new ArrayBuffer` + memcpy)
  // ou outra view. Sem os três ramos um ArrayBuffer cairia no String(value)
  // lá embaixo e a célula viajaria como a string "[object ArrayBuffer]".
  if (value instanceof Uint8Array) return toBlobCell(value, maxBytes);
  if (value instanceof ArrayBuffer) return toBlobCell(new Uint8Array(value), maxBytes);
  if (ArrayBuffer.isView(value)) {
    // byteOffset/byteLength importam: uma view parcial não deve arrastar o
    // buffer inteiro.
    return toBlobCell(
      new Uint8Array(value.buffer as ArrayBuffer, value.byteOffset, value.byteLength),
      maxBytes,
    );
  }
  return String(value);
}

/**
 * O adapter de SQLite, agnóstico de driver. `identity` é o que distingue um
 * provider do outro no protocolo e na UI — o resto do comportamento (paginação
 * keyset, contagem em duas fases, cache de schema, dedup de eventos, console
 * SQL) é idêntico para todos, porque é SQLite.
 */
export function createSqliteAdapter(identity: {
  providerId: string;
  label: string;
}): SqliteAdapter {
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
     * imediata, COUNT(*) exato em background populando o cache. Um COUNT(*)
     * numa tabela de milhões de linhas nunca fica no caminho crítico de uma
     * resposta.
     */
    countCache: Map<string, { value: number; exact: boolean; expiresAt: number }>;
    /**
     * Último COUNT(*) exato conhecido por tabela. Sobrevive ao invalidateCount
     * de propósito: depois de uma mutação, "quantas linhas tinha há pouco" é
     * uma estimativa muito melhor que MAX(rowid) — ver tableCount.
     */
    lastExactCount: Map<string, number>;
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

  function rememberExactCount(t: Tracked, table: string, value: number): void {
    t.countCache.set(table, { value, exact: true, expiresAt: Date.now() + COUNT_TTL_MS });
    t.lastExactCount.set(table, value);
  }

  async function exactCount(
    t: Tracked,
    table: string,
  ): Promise<{ total: number; exact: boolean }> {
    const row = await t.db.getAllAsync(`SELECT COUNT(*) AS n FROM ${quoteIdent(table)}`);
    const total = Number(row[0]?.["n"] ?? 0);
    rememberExactCount(t, table, total);
    return { total, exact: true };
  }

  /**
   * Contagem em duas fases, mas só quando a tabela é grande de verdade.
   *
   * MAX(rowid) é PÉSSIMO como estimativa de contagem: qualquer tabela que já
   * apagou linhas tem rowid alto e poucas linhas — 14 linhas com rowid 20026
   * estimavam "≈ 20026", errado por três ordens de magnitude, e era o caso
   * comum (o botão de esvaziar tabela produz exatamente isso). No que MAX(rowid)
   * é bom é em ser um limite superior BARATO do trabalho que o COUNT(*) daria:
   * abaixo do orçamento contamos exato na hora e ninguém vê "≈"; acima, a
   * estimativa se paga e o COUNT(*) vai para background.
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
    if (identity !== "rowid") return exactCount(t, table);

    const maxRow = await t.db.getAllAsync(`SELECT MAX(rowid) AS m FROM ${quoteIdent(table)}`);
    const maxRowid = Number(maxRow[0]?.["m"] ?? 0);
    if (maxRowid <= EXACT_COUNT_ROW_BUDGET) return exactCount(t, table);

    // Tabela realmente grande. A última contagem exata, se houver, erra por
    // quantas linhas mudaram desde então — MAX(rowid) erra por quantas linhas
    // já foram apagadas na vida da tabela.
    const estimate = t.lastExactCount.get(table) ?? maxRowid;
    t.countCache.set(table, {
      value: estimate,
      exact: false,
      expiresAt: Date.now() + COUNT_TTL_MS,
    });
    void t.db
      .getAllAsync(`SELECT COUNT(*) AS n FROM ${quoteIdent(table)}`)
      .then((row) => rememberExactCount(t, table, Number(row[0]?.["n"] ?? 0)))
      .catch(() => {});
    return { total: estimate, exact: false };
  }

  /** Mudança na tabela: a contagem cacheada deixou de valer. */
  function invalidateCount(t: Tracked, table: string): void {
    if (table === "*") t.countCache.clear();
    else t.countCache.delete(table);
  }

  /**
   * Cala os eventos do hook nativo desta tabela por um tempo.
   *
   * Necessário para lote: apagar N linhas dispara N eventos no hook, e o eco de
   * uso único (`pendingStudioWrites`) atribuiria só o PRIMEIRO ao studio — os
   * outros N-1 chegariam como se o app tivesse mexido. A chave `table:*` é a
   * mesma que o emitOnce já consulta, então registrar aqui suprime a tabela
   * inteira na janela e nós emitimos UM evento autoritativo no lugar.
   */
  function suppressTableEvents(t: Tracked, table: string, ms: number): void {
    t.recentEvents.set(`${table}:*`, Date.now() + ms);
  }

  function releaseTableEvents(t: Tracked, table: string): void {
    t.recentEvents.delete(`${table}:*`);
  }

  /**
   * Teto conservador de variáveis por statement. O SQLITE_MAX_VARIABLE_NUMBER
   * é 999 nas builds antigas e 32766 desde a 3.32 — 500 passa em qualquer uma
   * sem precisar detectar versão.
   */
  const MAX_BULK_PARAMS = 500;

  interface BulkStatement {
    sql: string;
    params: Array<string | number | null>;
  }

  /**
   * Roda os statements do lote numa transação NOSSA quando possível: ou apaga
   * todas as linhas, ou nenhuma. Sem isso, um erro no meio (ou um timeout)
   * deixaria a exclusão pela metade — que é exatamente o que acontecia quando o
   * Studio apagava linha a linha.
   */
  async function runInTransaction(t: Tracked, statements: BulkStatement[]): Promise<number> {
    let owned = false;
    try {
      await t.db.runAsync("BEGIN IMMEDIATE");
      owned = true;
    } catch {
      // Já estamos dentro de uma transação (do app, ou de um ORM): seguimos sem
      // abrir a nossa, e a atomicidade fica sendo a de quem abriu.
    }
    let affected = 0;
    try {
      for (const statement of statements) {
        const result = await t.db.runAsync(statement.sql, statement.params);
        affected += Number(result.changes ?? 0);
      }
      if (owned) await t.db.runAsync("COMMIT");
    } catch (error) {
      if (owned) {
        try {
          await t.db.runAsync("ROLLBACK");
        } catch {
          /* o driver pode já ter revertido sozinho */
        }
      }
      throw error;
    }
    return affected;
  }

  /** `DELETE ... WHERE rowid IN (…)`, em blocos que respeitam o teto de variáveis. */
  function rowidStatements(table: string, rowids: number[]): BulkStatement[] {
    const statements: BulkStatement[] = [];
    for (let i = 0; i < rowids.length; i += MAX_BULK_PARAMS) {
      const chunk = rowids.slice(i, i + MAX_BULK_PARAMS);
      statements.push({
        sql: `DELETE FROM ${quoteIdent(table)} WHERE rowid IN (${chunk.map(() => "?").join(", ")})`,
        params: chunk,
      });
    }
    return statements;
  }

  /**
   * `DELETE ... WHERE (a, b) IN ((?,?), (?,?))` — row values, suportados pelo
   * SQLite desde a 3.15. A ordem das colunas vem do schema, não das chaves do
   * objeto, senão dois refs poderiam gerar tuplas em ordens diferentes.
   */
  function pkStatements(
    table: string,
    pkColumns: string[],
    refs: Array<Record<string, CellValue>>,
  ): BulkStatement[] {
    if (pkColumns.length === 0) {
      throw new Error(`table ${table} has no primary key to delete by`);
    }
    const perRef = pkColumns.length;
    const maxRefs = Math.max(1, Math.floor(MAX_BULK_PARAMS / perRef));
    const columnList = pkColumns.map(quoteIdent).join(", ");
    const tuple = `(${pkColumns.map(() => "?").join(", ")})`;
    const statements: BulkStatement[] = [];
    for (let i = 0; i < refs.length; i += maxRefs) {
      const chunk = refs.slice(i, i + maxRefs);
      const params: Array<string | number | null> = [];
      for (const pk of chunk) {
        for (const column of pkColumns) {
          if (!(column in pk)) {
            throw new Error(`primary-key reference is missing column "${column}"`);
          }
          params.push(toParam(pk[column] ?? null));
        }
      }
      statements.push({
        sql:
          `DELETE FROM ${quoteIdent(table)} WHERE (${columnList}) IN ` +
          `(${chunk.map(() => tuple).join(", ")})`,
        params,
      });
    }
    return statements;
  }

  /**
   * Uma ref posicional aponta para "a n-ésima linha desta ordenação", e isso
   * deixa de valer no instante em que o dado ao redor muda. Serve para LER uma
   * célula grande agora; usar para escrever significaria mirar numa linha e
   * acertar outra.
   */
  function rejectScanRef(ref: RowRef): asserts ref is Exclude<RowRef, { scan: unknown }> {
    if ("scan" in ref) {
      throw new Error("positional reference cannot be used for writes");
    }
  }

  function refToWhere(ref: RowRef): { clause: string; params: Array<string | number | null> } {
    rejectScanRef(ref);
    if ("rowid" in ref) return { clause: "rowid = ?", params: [ref.rowid] };
    const columns = Object.keys(ref.pk);
    if (columns.length === 0) throw new Error("primary-key reference is empty");
    return {
      clause: columns.map((c) => `${quoteIdent(c)} = ?`).join(" AND "),
      params: columns.map((c) => toParam(ref.pk[c] ?? null)),
    };
  }

  return {
    providerId: identity.providerId,
    label: identity.label,
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
        lastExactCount: new Map(),
      });
      for (const listener of registrationListeners) listener();
    },

    onInstancesChanged(listener) {
      registrationListeners.add(listener);
      return () => registrationListeners.delete(listener);
    },

    notifyNativeChange(instanceId, table, rowId, operation) {
      const t = tracked.get(instanceId);
      if (!t) return;
      invalidateCount(t, table);
      const source: ChangeSource = consumeStudioEcho(t, table) ? "studio" : "app";
      emitOnce(t, { table, rowId, operation: normalizeOperation(operation), source });
    },

    notifyAppMutation(instanceId, table, rowId, operation) {
      const t = tracked.get(instanceId);
      if (!t) return;
      invalidateCount(t, table);
      const source: ChangeSource = consumeStudioEcho(t, table) ? "studio" : "app";
      emitOnce(t, { table, rowId, operation: normalizeOperation(operation), source });
    },

    notifySchemaChanged(instanceId, table) {
      const t = tracked.get(instanceId);
      if (!t) return;
      // DDL do app (CREATE/DROP/ALTER): invalida só a tabela afetada. A
      // contagem cai junto — depois de um DROP/CREATE do mesmo nome, o que
      // sabíamos sobre o tamanho da tabela não vale mais nada.
      t.schemaCache.delete(table);
      invalidateCount(t, table);
      t.lastExactCount.delete(table);
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
          const cell = toCell(value, BLOB_PREVIEW_BYTES);
          if (typeof cell === "string" && cell.length > CELL_PREVIEW_LIMIT) {
            cells[column] = cell.slice(0, CELL_PREVIEW_LIMIT);
            truncatedColumns.push(column);
          } else if (cell !== null && typeof cell === "object") {
            // O base64 já veio cortado por toCell; `byteLength` diz se sobrou
            // conteúdo — comparar o tamanho do base64 mediria a fatia, não o BLOB.
            cells[column] = cell;
            if ((cell.byteLength ?? 0) > BLOB_PREVIEW_BYTES) truncatedColumns.push(column);
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

    async deleteRows(instanceId, table, refs) {
      const t = get(instanceId);
      if (refs.length === 0) return { rowsAffected: 0 };

      const rowids: number[] = [];
      const pks: Array<Record<string, CellValue>> = [];
      for (const ref of refs) {
        rejectScanRef(ref);
        if ("rowid" in ref) rowids.push(ref.rowid);
        else pks.push(ref.pk);
      }

      const statements: BulkStatement[] = rowidStatements(table, rowids);
      if (pks.length > 0) {
        const { pkColumns } = await tableInfo(t, table);
        statements.push(...pkStatements(table, pkColumns, pks));
      }

      invalidateCount(t, table);
      // Antes de rodar: o hook nativo vai disparar uma vez por linha.
      suppressTableEvents(t, table, ECHO_TTL_MS);
      let rowsAffected: number;
      try {
        rowsAffected = await runInTransaction(t, statements);
      } catch (error) {
        // Falhou e reverteu: não engolir os eventos legítimos do app.
        releaseTableEvents(t, table);
        throw error;
      }
      // Sabemos exatamente quantas linhas saíram: descontar da última contagem
      // conhecida é melhor que deixar a estimativa cair em MAX(rowid), que
      // ignora deleções por definição.
      const knownBefore = t.lastExactCount.get(table);
      if (knownBefore !== undefined) {
        t.lastExactCount.set(table, Math.max(0, knownBefore - rowsAffected));
      }
      // Renova a janela para os eventos que o hook ainda entregar em atraso.
      suppressTableEvents(t, table, RECENT_EVENT_TTL_MS);
      // `emit` direto, não `emitOnce`: este é o evento autoritativo do lote e
      // não deve ser suprimido pela chave que nós mesmos acabamos de registrar.
      emit(t, { table, rowId: null, operation: "delete", source: "studio" });
      return { rowsAffected };
    },

    async deleteAll(instanceId, table) {
      const t = get(instanceId);
      // Um único DELETE sem WHERE: é o caminho da truncate optimization, em que
      // o SQLite descarta as páginas da tabela em vez de percorrer linha a
      // linha. Também é o caminho em que o hook nativo NÃO dispara — por isso o
      // evento abaixo é obrigatório, não decorativo.
      invalidateCount(t, table);
      suppressTableEvents(t, table, ECHO_TTL_MS);
      let rowsAffected: number;
      try {
        const result = await t.db.runAsync(`DELETE FROM ${quoteIdent(table)}`);
        rowsAffected = Number(result.changes ?? 0);
      } catch (error) {
        releaseTableEvents(t, table);
        throw error;
      }
      // A tabela está vazia — isto é conhecimento exato, não estimativa.
      rememberExactCount(t, table, 0);
      suppressTableEvents(t, table, RECENT_EVENT_TTL_MS);
      emit(t, { table, rowId: null, operation: "delete", source: "studio" });
      return { rowsAffected };
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
      // lastExactCount também: depois de um DROP/CREATE, "quantas linhas tinha"
      // não é palpite conservador, é lixo.
      t.schemaCache.clear();
      t.countCache.clear();
      t.lastExactCount.clear();
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
