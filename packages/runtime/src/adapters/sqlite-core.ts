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
import { referencedNames, triggerOldColumns, triggerOperation } from "./sqlite-sql.ts";

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
/**
 * O mesmo para VIEW, e menor de propósito.
 *
 * Numa tabela o orçamento é medido por MAX(rowid), que é leitura de metadado.
 * Numa view não existe limite superior barato: descobrir o tamanho custa
 * materializar linha, e a view pode ser um JOIN de três tabelas. Então o
 * probe é `SELECT COUNT(*) FROM (SELECT 1 FROM v LIMIT n+1)` — o LIMIT dentro
 * da subconsulta é o que garante que o trabalho pára.
 *
 * Medido numa view de 200k linhas: 0,42 ms com teto 50k contra 0,016 ms com
 * teto 1k. Num Android médio, com 20 views, a cada tables() depois de cada
 * escrita, 50k é travada visível na sidebar — daí 5k.
 */
const VIEW_COUNT_ROW_BUDGET = 5_000;

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
    /** Ver loadCatalog. null = ainda não lido ou invalidado por DDL. */
    catalog: Catalog | null;
  }

  const tracked = new Map<string, Tracked>();
  const registrationListeners = new Set<() => void>();

  function get(instanceId: string): Tracked {
    const t = tracked.get(instanceId);
    if (!t) throw new Error(`unknown instance: ${instanceId}`);
    return t;
  }

  /**
   * Teto de nomes por evento. Um schema patológico (uma tabela lida por
   * dezenas de views) não pode inflar o fio; acima disso a UI já não teria o
   * que fazer com a lista de qualquer forma.
   */
  const MAX_DEPENDENT_VIEWS = 32;

  /**
   * Anexa as views que leem a tabela alterada.
   *
   * Aplicado DENTRO do emit de propósito: hook nativo, fallback JS, eco do
   * Studio, exclusão em lote e esvaziamento passam todos por aqui, então
   * nenhum caminho — nem um futuro — consegue esquecer a atribuição.
   *
   * Só usa catálogo já carregado: o emit é síncrono e está no caminho quente
   * de um evento do banco. Sem catálogo, o evento sai sem views e o Studio se
   * comporta como antes — nada quebra, só fica menos preciso até a próxima
   * listagem, que é quando o catálogo chega.
   */
  function emit(t: Tracked, change: DatabaseChange): void {
    const dependents = t.catalog?.dependents.get(change.table);
    const enriched: DatabaseChange =
      dependents && dependents.length > 0
        ? { ...change, views: dependents.slice(0, MAX_DEPENDENT_VIEWS) }
        : change;
    for (const listener of t.listeners) listener(enriched);
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

  interface Catalog {
    /** Tabelas e views, na ordem em que o sqlite_master devolveu (por nome). */
    objects: Map<string, { kind: "table" | "view"; sql: string }>;
    /** tbl_name → SQL de cada trigger que aponta para ele. */
    triggersByTable: Map<string, string[]>;
    /** Objeto → views que leem dele, transitivamente. Alimenta a atribuição. */
    dependents: Map<string, string[]>;
  }

  const NO_WRITES = { insert: false, update: false, delete: false } as const;
  const ALL_WRITES = { insert: true, update: true, delete: true } as const;

  /**
   * Uma leitura do sqlite_master responde três perguntas de uma vez: quais
   * objetos existem e de que tipo, o SQL de cada view (de onde saem as
   * dependências) e o SQL de cada trigger (de onde saem gravabilidade e
   * chave). Antes disso a listagem e a busca faziam a mesma query separada,
   * cada uma cravando `type = 'table'`.
   */
  async function loadCatalog(t: Tracked): Promise<Catalog> {
    if (t.catalog) return t.catalog;
    const rows = await t.db.getAllAsync(
      `SELECT type, name, tbl_name, sql FROM sqlite_master
        WHERE type IN ('table', 'view', 'trigger') AND name NOT LIKE 'sqlite_%'
        ORDER BY name`,
    );

    const objects = new Map<string, { kind: "table" | "view"; sql: string }>();
    const triggersByTable = new Map<string, string[]>();
    for (const row of rows) {
      const type = String(row["type"]);
      const sql = String(row["sql"] ?? "");
      if (type === "trigger") {
        const target = String(row["tbl_name"] ?? "");
        if (target.length === 0) continue;
        const existing = triggersByTable.get(target);
        if (existing) existing.push(sql);
        else triggersByTable.set(target, [sql]);
        continue;
      }
      objects.set(String(row["name"]), { kind: type === "view" ? "view" : "table", sql });
    }

    const catalog: Catalog = { objects, triggersByTable, dependents: new Map() };
    for (const [name, object] of objects) {
      if (object.kind !== "view") continue;
      for (const base of viewDependencies(catalog, name)) {
        const existing = catalog.dependents.get(base);
        if (existing) {
          if (!existing.includes(name)) existing.push(name);
        } else catalog.dependents.set(base, [name]);
      }
    }

    t.catalog = catalog;
    return catalog;
  }

  /** Objetos que a view lê diretamente. A própria view sai — ela aparece no CREATE. */
  function directDependencies(catalog: Catalog, name: string): string[] {
    const object = catalog.objects.get(name);
    if (!object || object.kind !== "view") return [];
    return referencedNames(object.sql, catalog.objects.keys()).filter((other) => other !== name);
  }

  /**
   * Fecho transitivo: uma view sobre view depende também das tabelas da de
   * baixo, senão uma escrita na base não marcaria a de cima. `seen` também
   * protege de view auto-referente, que é criável e faria loop.
   *
   * Ordenado por nome — a saída vai para a UI e para teste, então precisa ser
   * determinística, e a ordem não carrega significado.
   */
  function viewDependencies(catalog: Catalog, view: string): string[] {
    const found: string[] = [];
    const seen = new Set<string>([view]);
    const queue = directDependencies(catalog, view);
    while (queue.length > 0) {
      const name = queue.shift() as string;
      if (seen.has(name)) continue;
      seen.add(name);
      found.push(name);
      for (const next of directDependencies(catalog, name)) {
        if (!seen.has(next)) queue.push(next);
      }
    }
    return found.sort();
  }

  /**
   * O SQLite recusa DML numa view que não tenha o trigger INSTEAD OF
   * correspondente — e uma view pode ter só o de INSERT. Por isso a
   * gravabilidade é por operação: um booleano faria a UI oferecer edição que
   * sempre termina em "cannot modify x because it is a view".
   */
  function viewWritability(catalog: Catalog, view: string): TableInfo["writable"] {
    const writable = { insert: false, update: false, delete: false };
    for (const sql of catalog.triggersByTable.get(view) ?? []) {
      const operation = triggerOperation(sql);
      if (operation !== null) writable[operation] = true;
    }
    return writable;
  }

  /**
   * A chave de uma linha de view, lida do `OLD.*` dos triggers.
   *
   * É a declaração do próprio autor sobre o que identifica um registro, no
   * único lugar em que o SQLite permite declará-la: dentro do INSTEAD OF,
   * `OLD` é a linha que estava lá, e o que o trigger usa dela para achar o
   * registro na tabela-base é, por definição, a identidade.
   *
   * Descartados (e o motivo, porque cada um parece razoável de longe):
   *  - "primeira coluna chamada id" — mágico, e erra calado num
   *    `SELECT u.id, o.id FROM users u JOIN orders o`;
   *  - a linha inteira como chave — `toParam` lança em BLOB, e uma célula que
   *    veio truncada no preview nunca casaria no WHERE;
   *  - `PRAGMA index_list` da tabela-base — só serve para view trivialmente
   *    derivada, e não diz nada sobre uma view de `json_extract`.
   *
   * Super-aproximar aqui é seguro: coluna a mais só deixa o WHERE mais
   * seletivo, e o preflight recusa se ainda assim ficar ambíguo.
   */
  function viewKeyColumns(catalog: Catalog, view: string, columnNames: string[]): string[] {
    const byOperation = new Map<string, string>();
    for (const sql of catalog.triggersByTable.get(view) ?? []) {
      const operation = triggerOperation(sql);
      if (operation !== null && !byOperation.has(operation)) byOperation.set(operation, sql);
    }
    // UPDATE primeiro: é o trigger que precisa achar a linha E reescrevê-la,
    // então é o que declara a chave de forma mais completa.
    const source = byOperation.get("update") ?? byOperation.get("delete");
    if (source === undefined) return [];

    const canonical = new Map(columnNames.map((name) => [name.toLowerCase(), name]));
    const keys: string[] = [];
    for (const column of triggerOldColumns(source)) {
      const match = canonical.get(column.toLowerCase());
      if (match !== undefined && !keys.includes(match)) keys.push(match);
    }
    return keys;
  }

  async function tableIdentity(
    db: SQLiteDatabaseLike,
    table: string,
    columns: Array<Record<string, unknown>>,
  ): Promise<TableSchema["identity"]> {
    try {
      await db.getAllAsync(`SELECT rowid FROM ${quoteIdent(table)} LIMIT 1`);
      return "rowid";
    } catch {
      /* WITHOUT ROWID */
    }
    return columns.some((c) => Number(c["pk"]) > 0) ? "pk" : "none";
  }

  interface TableInfo {
    kind: "table" | "view";
    identity: TableSchema["identity"];
    columnNames: string[];
    pkColumns: string[];
    columns: TableSchema["columns"];
    writable: { insert: boolean; update: boolean; delete: boolean };
    dependsOn: string[];
    /** Mensagem do SQLite quando nem o PRAGMA respondeu (view órfã). */
    unavailable: string | null;
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

    const catalog = await loadCatalog(t);
    // O tipo vem do catálogo, NUNCA do probe de rowid: numa
    // `CREATE VIEW v AS SELECT rowid, … FROM t` o probe passa, e daí sairia
    // identity "rowid" numa view — com `DELETE … WHERE rowid IN (…)` quebrando
    // na cara do usuário.
    const kind = catalog.objects.get(table)?.kind ?? "table";

    let raw: Array<Record<string, unknown>>;
    try {
      raw = await t.db.getAllAsync(`PRAGMA table_info(${quoteIdent(table)})`);
    } catch (error) {
      // View sobre tabela que sumiu — normal no meio de uma migração. Sem
      // isto, uma view órfã derruba a listagem inteira e a sidebar fica em
      // branco em vez de mostrar uma linha com problema.
      const info: TableInfo = {
        kind,
        identity: "none",
        columnNames: [],
        pkColumns: [],
        columns: [],
        writable: { ...NO_WRITES },
        dependsOn: kind === "view" ? viewDependencies(catalog, table) : [],
        unavailable: error instanceof Error ? error.message : String(error),
      };
      t.schemaCache.set(table, info);
      return info;
    }

    const columnNames = raw.map((c) => String(c["name"]));
    const columns: TableSchema["columns"] = raw.map((c) => ({
      name: String(c["name"]),
      declaredType: String(c["type"] ?? ""),
      notNull: Number(c["notnull"]) === 1,
      pkIndex: Number(c["pk"]),
    }));

    let info: TableInfo;
    if (kind === "view") {
      const keyColumns = viewKeyColumns(catalog, table, columnNames);
      info = {
        kind,
        identity: keyColumns.length > 0 ? "pk" : "none",
        columnNames,
        pkColumns: keyColumns,
        // pkIndex preenchido dá de brinde os templates do console SQL, que
        // escolhem a primeira coluna com pkIndex > 0 e hoje caem em `rowid` —
        // que não existe em view.
        columns: columns.map((column) => {
          const position = keyColumns.indexOf(column.name);
          return position === -1 ? column : { ...column, pkIndex: position + 1 };
        }),
        writable: viewWritability(catalog, table),
        dependsOn: viewDependencies(catalog, table),
        unavailable: null,
      };
    } else {
      info = {
        kind,
        identity: await tableIdentity(t.db, table, raw),
        columnNames,
        pkColumns: raw
          .filter((c) => Number(c["pk"]) > 0)
          .sort((a, b) => Number(a["pk"]) - Number(b["pk"]))
          .map((c) => String(c["name"])),
        columns,
        writable: { ...ALL_WRITES },
        dependsOn: [],
        unavailable: null,
      };
    }

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

  /** Dispara o COUNT(*) exato fora do caminho crítico e esquece a promise. */
  function refreshCountInBackground(t: Tracked, table: string): void {
    void t.db
      .getAllAsync(`SELECT COUNT(*) AS n FROM ${quoteIdent(table)}`)
      .then((row) => rememberExactCount(t, table, Number(row[0]?.["n"] ?? 0)))
      .catch(() => {});
  }

  /**
   * Contagem de VIEW, com trabalho limitado por construção.
   *
   * Numa tabela dá para perguntar "isso é grande?" barato, via MAX(rowid).
   * Numa view não dá: não há metadado nenhum, e um COUNT(*) pode ser a
   * materialização de um JOIN inteiro — no caminho crítico da sidebar, a cada
   * refresh, por view. O truque é o LIMIT DENTRO da subconsulta: o SQLite pára
   * de produzir linha ao atingir o teto, então o pior caso é o orçamento, não
   * o tamanho da view.
   *
   * Abaixo do teto a contagem é exata e ninguém vê "≈"; acima vira estimativa
   * e o COUNT(*) real vai para background, exatamente como no caminho de
   * tabela grande.
   */
  async function viewCount(t: Tracked, view: string): Promise<{ total: number; exact: boolean }> {
    const probe = await t.db.getAllAsync(
      `SELECT COUNT(*) AS n FROM (SELECT 1 FROM ${quoteIdent(view)} LIMIT ${VIEW_COUNT_ROW_BUDGET + 1})`,
    );
    const seen = Number(probe[0]?.["n"] ?? 0);
    if (seen <= VIEW_COUNT_ROW_BUDGET) {
      rememberExactCount(t, view, seen);
      return { total: seen, exact: true };
    }

    const estimate = t.lastExactCount.get(view) ?? VIEW_COUNT_ROW_BUDGET;
    t.countCache.set(view, {
      value: estimate,
      exact: false,
      expiresAt: Date.now() + COUNT_TTL_MS,
    });
    refreshCountInBackground(t, view);
    return { total: estimate, exact: false };
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
    info: Pick<TableInfo, "identity" | "kind">,
  ): Promise<{ total: number; exact: boolean }> {
    const cached = t.countCache.get(table);
    if (cached && cached.expiresAt > Date.now()) {
      return { total: cached.value, exact: cached.exact };
    }
    if (info.kind === "view") return viewCount(t, table);
    // Tabela física sem rowid (WITHOUT ROWID): o COUNT(*) varre um índice
    // de verdade, então continua barato e continua exato.
    if (info.identity !== "rowid") return exactCount(t, table);

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
    refreshCountInBackground(t, table);
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
  async function inTransaction<T>(t: Tracked, run: () => Promise<T>): Promise<T> {
    let owned = false;
    try {
      await t.db.runAsync("BEGIN IMMEDIATE");
      owned = true;
    } catch {
      // Já estamos dentro de uma transação (do app, ou de um ORM): seguimos sem
      // abrir a nossa, e a atomicidade fica sendo a de quem abriu.
    }
    try {
      const result = await run();
      if (owned) await t.db.runAsync("COMMIT");
      return result;
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
  }

  async function runInTransaction(t: Tracked, statements: BulkStatement[]): Promise<number> {
    return inTransaction(t, async () => {
      let affected = 0;
      for (const statement of statements) {
        const result = await t.db.runAsync(statement.sql, statement.params);
        affected += Number(result.changes ?? 0);
      }
      return affected;
    });
  }

  /**
   * Prova, ANTES de escrever, que a referência seleciona exatamente uma linha
   * da view.
   *
   * Verificação a posteriori é impossível aqui: numa view com trigger
   * INSTEAD OF o `changes` do UPDATE/DELETE externo é sempre 0 — o statement
   * de fora não altera linha nenhuma, quem altera é o trigger, e o contador
   * não atravessa. Então não dá para escrever e conferir depois. A garantia
   * tem que vir antes, e acaba sendo mais forte: provado que o WHERE casa uma
   * linha só, o trigger dispara uma vez com o OLD/NEW certo, faça ele o que
   * fizer nas tabelas-base.
   *
   * `LIMIT 2` porque a pergunta é "é uma ou é mais de uma" — contar o resto
   * seria trabalho jogado fora.
   *
   * Roda dentro da transação de quem chama, senão outra escrita poderia entrar
   * entre a prova e o uso.
   */
  async function assertSingleRow(
    t: Tracked,
    table: string,
    where: { clause: string; params: Array<string | number | null> },
  ): Promise<void> {
    const probe = await t.db.getAllAsync(
      `SELECT COUNT(*) AS n FROM (SELECT 1 FROM ${quoteIdent(table)} WHERE ${where.clause} LIMIT 2)`,
      where.params,
    );
    const matched = Number(probe[0]?.["n"] ?? 0);
    if (matched === 1) return;
    throw new Error(
      matched === 0
        ? `row no longer matches this reference in "${table}"`
        : `reference matches more than one row in "${table}"`,
    );
  }

  /**
   * O SQLite recusa DML numa view sem o trigger INSTEAD OF correspondente,
   * com "cannot modify x because it is a view". Recusar antes, nomeando o que
   * falta, troca esse erro opaco por um que diz o que fazer.
   */
  function assertWritable(
    info: TableInfo,
    table: string,
    operation: "insert" | "update" | "delete",
  ): void {
    if (info.kind !== "view" || info.writable[operation]) return;
    throw new Error(
      `view "${table}" has no INSTEAD OF ${operation.toUpperCase()} trigger, so SQLite cannot apply this change`,
    );
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
      // `IS ?` e não `= ?`: com parâmetro NULL a igualdade não casa NADA, e a
      // linha fica ineditável e inapagável.
      //
      // Numa tabela isso é inalcançável (WITHOUT ROWID exige PK NOT NULL), mas
      // numa view a chave sai de expressão — `json_extract` de campo ausente
      // devolve NULL — e aí o caso é rotineiro. `IS` casa NULL e valor normal
      // com o mesmo plano de índice, então não há o que pesar.
      clause: columns.map((c) => `${quoteIdent(c)} IS ?`).join(" AND "),
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
        catalog: null,
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
      //
      // O catálogo cai INTEIRO em qualquer DDL: é uma query só para
      // reconstruir, DDL é raro, e um CREATE/DROP VIEW muda o grafo de
      // dependências de objetos que não são o alvo nomeado.
      t.catalog = null;
      if (table === "*") {
        // `delete("*")` era no-op — só invalidateCount tratava o coringa. Como
        // `mutationTable` devolve null (logo "*") justamente para DDL que ele
        // não sabe escopar, era o caso do CREATE VIEW que nunca invalidava.
        t.schemaCache.clear();
        t.lastExactCount.clear();
      } else {
        t.schemaCache.delete(table);
        t.lastExactCount.delete(table);
      }
      invalidateCount(t, table);
    },

    async tables(instanceId) {
      const t = get(instanceId);
      const catalog = await loadCatalog(t);
      const result: TableSchema[] = [];

      // Tabelas e views vêm intercaladas por nome. Agrupar é apresentação e
      // mora no Studio — o adapter não escolhe ordem de exibição.
      for (const [name, object] of catalog.objects) {
        // Colunas e identidade vêm do cache; contagem em duas fases — o
        // refresh de schema não custa um COUNT(*) full-scan por tabela.
        const info = await tableInfo(t, name);

        if (info.unavailable !== null) {
          result.push({
            name,
            columns: [],
            rowCount: 0,
            identity: "none",
            kind: object.kind,
            writable: { ...NO_WRITES },
            unavailable: info.unavailable,
          });
          continue;
        }

        const count = await tableCount(t, name, info);
        const entry: TableSchema = {
          name,
          columns: info.columns,
          rowCount: count.total,
          rowCountIsEstimate: !count.exact,
          identity: info.identity,
        };
        // `kind` e `writable` só saem para view: ausente já significa tabela
        // física com tudo permitido, e não trafegar o óbvio mantém o payload
        // do refresh igual ao de hoje em app que não usa view.
        if (object.kind === "view") {
          entry.kind = "view";
          entry.writable = info.writable;
          if (info.dependsOn.length > 0) entry.dependsOn = info.dependsOn;
        }
        result.push(entry);
      }
      return result;
    },

    async rows(instanceId, table, options) {
      const t = get(instanceId);
      const { db } = t;
      const info = await tableInfo(t, table);
      const { identity, columnNames, pkColumns } = info;

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
      const count = await tableCount(t, table, info);

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
      const catalog = await loadCatalog(t);
      const matches: Array<{ table: string; ref: RowRef | null; snippet: string }> = [];
      const pattern = `%${query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      let complete = true;
      // Views entram na busca. Num setup clássico isso devolve a mesma linha
      // duas vezes (view e tabela), o que é chatice; excluí-las devolveria
      // ZERO num setup onde a tabela física guarda JSON e a view é a única
      // superfície legível. Errar para o lado de incluir.
      for (const [table] of catalog.objects) {
        if (matches.length >= limit) {
          complete = false;
          break;
        }
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
        // Uma view que quebra na execução (base sumiu entre o PRAGMA e agora)
        // não pode zerar a busca inteira — mesmo motivo do try/catch da
        // listagem, só que aqui o erro só aparece ao rodar a query.
        let raw: Array<Record<string, unknown>>;
        try {
          raw = await t.db.getAllAsync(`${select} WHERE ${where} LIMIT ?`, [
            ...params,
            remaining + 1,
          ]);
        } catch {
          continue;
        }
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
      const info = await tableInfo(t, table);
      assertWritable(info, table, "update");
      const where = refToWhere(ref);
      const sql = `UPDATE ${quoteIdent(table)} SET ${columns.map((c) => `${quoteIdent(c)} = ?`).join(", ")} WHERE ${where.clause}`;
      const params = [...columns.map((c) => toParam(set[c] ?? null)), ...where.params];
      markStudioMutation(t, table, "update", "rowid" in ref ? ref.rowid : null);
      try {
        if (info.kind === "view") {
          // Prova e escrita na mesma transação: se a prova falhar, nada foi
          // escrito; e nada entra entre uma e outra.
          await inTransaction(t, async () => {
            await assertSingleRow(t, table, where);
            await t.db.runAsync(sql, params);
          });
        } else {
          await t.db.runAsync(sql, params);
        }
      } catch (error) {
        t.pendingStudioWrites.delete(table);
        throw error;
      }
    },

    async insert(instanceId, table, values) {
      const t = get(instanceId);
      const columns = Object.keys(values);
      const info = await tableInfo(t, table);
      assertWritable(info, table, "insert");
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
      // `kind !== "view"` é cinto sobre suspensório: identity nunca é "rowid"
      // numa view (o tipo vem do sqlite_master). O que o guarda documenta é o
      // motivo — last_insert_rowid NÃO é atualizado por insert feito dentro de
      // trigger, então numa view ele devolveria um id velho de outra escrita.
      if (info.kind !== "view" && info.identity === "rowid" && Number.isFinite(lastInsertRowId)) {
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
      const info = await tableInfo(t, table);
      assertWritable(info, table, "delete");
      const where = refToWhere(ref);
      const sql = `DELETE FROM ${quoteIdent(table)} WHERE ${where.clause}`;
      markStudioMutation(t, table, "delete", "rowid" in ref ? ref.rowid : null);
      try {
        if (info.kind === "view") {
          await inTransaction(t, async () => {
            await assertSingleRow(t, table, where);
            await t.db.runAsync(sql, where.params);
          });
        } else {
          await t.db.runAsync(sql, where.params);
        }
      } catch (error) {
        t.pendingStudioWrites.delete(table);
        throw error;
      }
    },

    async deleteRows(instanceId, table, refs) {
      const t = get(instanceId);
      if (refs.length === 0) return { rowsAffected: 0 };
      const info = await tableInfo(t, table);
      // Recusa deliberada. O caminho em lote existe para fazer UM statement no
      // lugar de N — e a única forma correta numa view seria N preflights
      // seguidos de N deletes, que é exatamente o que ele evita. Some isso ao
      // fato de o `IN` com row-value não ser NULL-safe e o lote deixa de ter
      // razão de existir aqui. Apagar linha a linha continua funcionando.
      if (info.kind === "view") {
        throw new Error(
          `"${table}" is a view — delete rows one at a time so each reference can be verified`,
        );
      }

      const rowids: number[] = [];
      const pks: Array<Record<string, CellValue>> = [];
      for (const ref of refs) {
        rejectScanRef(ref);
        if ("rowid" in ref) rowids.push(ref.rowid);
        else pks.push(ref.pk);
      }

      const statements: BulkStatement[] = rowidStatements(table, rowids);
      if (pks.length > 0) statements.push(...pkStatements(table, info.pkColumns, pks));

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
      const info = await tableInfo(t, table);
      // Recusa dura, e esta é a mais importante do arquivo.
      //
      // Esta operação existe POR CAUSA da truncate optimization: um DELETE sem
      // WHERE faz o SQLite descartar as páginas da tabela sem percorrer linha
      // a linha. Numa view essa otimização não existe — o DELETE dispara o
      // trigger INSTEAD OF uma vez POR LINHA.
      //
      // Medido numa view de 200k linhas em cima de uma base tipo PowerSync: o
      // trigger rodou 200.000 vezes e enfileirou 200.000 operações na fila de
      // upload, que o motor de sync então sobe para o servidor do cliente. Um
      // botão de "esvaziar" no inspector não pode gerar tráfego de produção.
      if (info.kind === "view") {
        throw new Error(
          `"${table}" is a view — DELETE FROM would fire its INSTEAD OF trigger once per row instead of truncating`,
        );
      }
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
      t.catalog = null;
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
