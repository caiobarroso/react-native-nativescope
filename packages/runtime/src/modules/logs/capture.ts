import { LOGS_MODULE, LOGS_EVENT, type LogArg, type LogBatch, type LogEntry, type LogLevel } from "@rnsi/protocol";

/**
 * Helpers PUROS de captura de logs (sem tocar globals) — o que dá para testar
 * sem um `console` de verdade. O patch em si vive em install.ts.
 */

export const LOG_LEVELS: readonly LogLevel[] = ["debug", "log", "info", "warn", "error"];

export interface LogsOptions {
  /** Níveis capturados. Fora daqui, o console segue intacto e nada é emitido. */
  levels: LogLevel[];
  /** Teto do JSON de UM argumento, em chars. */
  maxArgLength: number;
  /** Teto da mensagem renderizada na lista. */
  maxMessageLength: number;
  /** Args além disto viram um marcador — ninguém loga 30 argumentos de propósito. */
  maxArgs: number;
  maxDepth: number;
  maxKeys: number;
  maxArrayItems: number;
  /** Strings dentro de objetos são cortadas aqui (o objeto inteiro tem outro teto). */
  maxStringLength: number;
  /** Entradas por lote. */
  maxBatchEntries: number;
  /** Teto de tamanho do lote, bem abaixo do WIRE_MESSAGE_BUDGET (256 KB). */
  maxBatchChars: number;
  /** Janela de acúmulo antes do flush. */
  flushMs: number;
  /** Teto duro de entradas por segundo. O excedente vira `dropped`. */
  maxPerSecond: number;
  /**
   * Entradas retidas enquanto a conexão não está pronta. É o que salva os logs
   * de startup — o handshake acontece centenas de ms depois do boot do app.
   */
  preReadyBuffer: number;
  /** Substrings de mensagem a ignorar. */
  ignorePatterns: string[];
  /**
   * Chaves cujo valor vira `«redacted»` antes de sair do device. Já normalizadas
   * (minúsculas, sem separadores). Vazio = redação desligada.
   */
  redactKeys: string[];
}

const DEFAULT_MAX_ARG_LENGTH = 8 * 1024;
const DEFAULT_MAX_MESSAGE_LENGTH = 4 * 1024;
const DEFAULT_MAX_ARGS = 12;
const DEFAULT_MAX_DEPTH = 6;
const DEFAULT_MAX_KEYS = 100;
const DEFAULT_MAX_ARRAY_ITEMS = 100;
const DEFAULT_MAX_STRING_LENGTH = 2 * 1024;
const DEFAULT_MAX_BATCH_ENTRIES = 200;
const DEFAULT_MAX_BATCH_CHARS = 96 * 1024;
const DEFAULT_FLUSH_MS = 120;
const DEFAULT_MAX_PER_SECOND = 500;
const DEFAULT_PRE_READY_BUFFER = 500;

/**
 * Ruído que nunca ajuda o dev e que, no nosso caso, também é perigoso: o
 * próprio inspector grita no console quando um frame estoura o orçamento de fio
 * (bootstrap.ts). Capturar essa linha e emiti-la fecharia um ciclo que CRESCE a
 * cada volta. O guard de reentrância do install.ts é a defesa real; isto aqui é
 * o cinto extra.
 */
const DEFAULT_IGNORE = ["[rnsi]", "[nativescope]"];

export function normalizeLogsOptions(config: unknown): LogsOptions {
  const c = (config && typeof config === "object" ? config : {}) as Record<string, unknown>;
  const toStringArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const positive = (v: unknown, fallback: number): number =>
    typeof v === "number" && v > 0 ? Math.floor(v) : fallback;

  const levels = Array.isArray(c.levels)
    ? LOG_LEVELS.filter((level) => (c.levels as unknown[]).includes(level))
    : [...LOG_LEVELS];

  return {
    levels: levels.length > 0 ? levels : [...LOG_LEVELS],
    maxArgLength: positive(c.maxArgLength, DEFAULT_MAX_ARG_LENGTH),
    maxMessageLength: positive(c.maxMessageLength, DEFAULT_MAX_MESSAGE_LENGTH),
    maxArgs: positive(c.maxArgs, DEFAULT_MAX_ARGS),
    maxDepth: positive(c.maxDepth, DEFAULT_MAX_DEPTH),
    maxKeys: positive(c.maxKeys, DEFAULT_MAX_KEYS),
    maxArrayItems: positive(c.maxArrayItems, DEFAULT_MAX_ARRAY_ITEMS),
    maxStringLength: positive(c.maxStringLength, DEFAULT_MAX_STRING_LENGTH),
    maxBatchEntries: positive(c.maxBatchEntries, DEFAULT_MAX_BATCH_ENTRIES),
    maxBatchChars: positive(c.maxBatchChars, DEFAULT_MAX_BATCH_CHARS),
    flushMs: positive(c.flushMs, DEFAULT_FLUSH_MS),
    maxPerSecond: positive(c.maxPerSecond, DEFAULT_MAX_PER_SECOND),
    preReadyBuffer: positive(c.preReadyBuffer, DEFAULT_PRE_READY_BUFFER),
    ignorePatterns: [...DEFAULT_IGNORE, ...toStringArray(c.ignorePatterns)],
    // `redact: false` desliga por inteiro; `redactKeys` SOMA aos defaults, como
    // ignorePatterns. Quem quiser ver um token específico desliga e pronto.
    redactKeys:
      c.redact === false
        ? []
        : [...DEFAULT_REDACT_KEYS, ...toStringArray(c.redactKeys).map(normalizeKey)],
  };
}

export function isIgnoredMessage(message: string, options: LogsOptions): boolean {
  for (const needle of options.ignorePatterns) {
    if (needle && message.indexOf(needle) !== -1) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * Serialização
 * ------------------------------------------------------------------ */

interface PlainState {
  truncated: boolean;
}

function isError(value: unknown): value is Error {
  if (value instanceof Error) return true;
  const candidate = value as { message?: unknown; stack?: unknown } | null;
  return (
    candidate !== null &&
    typeof candidate === "object" &&
    typeof candidate.message === "string" &&
    typeof candidate.stack === "string"
  );
}

function isReactElement(value: object): boolean {
  const marker = (value as { $$typeof?: unknown }).$$typeof;
  return typeof marker === "symbol" && String(marker).indexOf("react.element") !== -1;
}

function reactTypeName(value: object): string {
  const type = (value as { type?: unknown }).type;
  if (typeof type === "string") return type;
  if (typeof type === "function") return (type as { name?: string }).name || "Component";
  return "Component";
}

/**
 * Converte qualquer valor num plain object serializável, com tetos em
 * profundidade, chaves, itens e tamanho de string. Nunca lança: um getter que
 * explode vira marcador, não crash do app.
 */
function toPlain(
  value: unknown,
  options: LogsOptions,
  depth: number,
  seen: Set<unknown>,
  state: PlainState,
): unknown {
  if (value === null) return null;

  const type = typeof value;
  if (type === "string") {
    const text = value as string;
    if (text.length > options.maxStringLength) {
      state.truncated = true;
      return `${text.slice(0, options.maxStringLength)}…`;
    }
    return text;
  }
  if (type === "number") return Number.isFinite(value) ? value : `«${String(value)}»`;
  if (type === "boolean") return value;
  if (type === "undefined") return "«undefined»";
  if (type === "bigint") return `${String(value)}n`;
  if (type === "symbol") return String(value);
  if (type === "function") {
    return `«function ${(value as { name?: string }).name || "anonymous"}»`;
  }

  const object = value as object;
  if (seen.has(object)) {
    state.truncated = true;
    return "«circular»";
  }
  if (isError(object)) {
    const error = object as Error;
    return { name: error.name, message: error.message, stack: error.stack ?? null };
  }
  if (object instanceof Date) return object.toISOString();
  if (object instanceof RegExp) return String(object);
  if (isReactElement(object)) return `«ReactElement ${reactTypeName(object)}»`;

  if (depth >= options.maxDepth) {
    state.truncated = true;
    return Array.isArray(object) ? `«Array(${object.length})»` : "«…»";
  }

  seen.add(object);
  try {
    if (Array.isArray(object)) {
      const limit = Math.min(object.length, options.maxArrayItems);
      const out: unknown[] = [];
      for (let i = 0; i < limit; i += 1) {
        out.push(toPlain(object[i], options, depth + 1, seen, state));
      }
      if (object.length > limit) {
        state.truncated = true;
        out.push(`«+${object.length - limit} items»`);
      }
      return out;
    }
    if (typeof Map !== "undefined" && object instanceof Map) {
      const out: Record<string, unknown> = {};
      let count = 0;
      for (const [key, entry] of object) {
        if (count >= options.maxKeys) {
          state.truncated = true;
          out["«…»"] = `+${object.size - count} entries`;
          break;
        }
        count += 1;
        const name = String(key);
        out[name] = isSecretKey(name, options)
          ? REDACTED
          : toPlain(entry, options, depth + 1, seen, state);
      }
      return { "«Map»": out };
    }
    if (typeof Set !== "undefined" && object instanceof Set) {
      const out: unknown[] = [];
      let count = 0;
      for (const entry of object) {
        if (count >= options.maxArrayItems) {
          state.truncated = true;
          out.push(`«+${object.size - count} items»`);
          break;
        }
        count += 1;
        out.push(toPlain(entry, options, depth + 1, seen, state));
      }
      return { "«Set»": out };
    }

    const keys = Object.keys(object);
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const key of keys) {
      if (count >= options.maxKeys) {
        state.truncated = true;
        out["«…»"] = `+${keys.length - count} keys`;
        break;
      }
      count += 1;
      if (isSecretKey(key, options)) {
        // Nem lê o valor: um getter de token não deve nem ser invocado.
        out[key] = REDACTED;
        continue;
      }
      try {
        out[key] = toPlain((object as Record<string, unknown>)[key], options, depth + 1, seen, state);
      } catch {
        out[key] = "«getter threw»"; // getter que explode nunca derruba a captura
      }
    }
    return out;
  } finally {
    // Só ciclos contam: irmãos repetidos são legítimos e devem serializar.
    seen.delete(object);
  }
}

function primitiveLabel(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "function") {
    return `ƒ ${(value as { name?: string }).name || "anonymous"}`;
  }
  return String(value);
}

export const REDACTED = "«redacted»";

/**
 * Chaves cujo VALOR nunca sai do device.
 *
 * Ligado por padrão, ao contrário do `redactHeaders` do Network — e de
 * propósito. Um header `authorization` é secreto quase por definição, então lá
 * o opt-in é barato; aqui o dev que escreve `console.log("auth", { token })`
 * não tem como saber que precisava configurar algo, e no modo `--lan` isso vai
 * para a rede local protegido só pelo token de sessão. Perder um valor com o
 * marcador `«redacted»` na tela é reversível em uma linha de config; vazar não é.
 *
 * A comparação é por SUBSTRING sobre a chave normalizada (minúscula, sem `_`
 * nem `-`), então `accessToken`, `access_token` e `API-KEY` caem todos. O preço
 * é falso positivo em coisas como `tokenCount` — visível, e desligável.
 */
const DEFAULT_REDACT_KEYS = [
  "password",
  "passwd",
  "secret",
  "token",
  "authorization",
  "apikey",
  "credential",
  "privatekey",
  "creditcard",
  "cardnumber",
  "cvv",
];

/** Minúsculas e sem separadores: `access_token`, `AccessToken` e `ACCESS-TOKEN` viram um só. */
function normalizeKey(key: string): string {
  let out = "";
  for (let i = 0; i < key.length; i += 1) {
    const char = key[i]!;
    if (char !== "_" && char !== "-" && char !== ".") out += char.toLowerCase();
  }
  return out;
}

export function isSecretKey(key: string, options: LogsOptions): boolean {
  if (options.redactKeys.length === 0) return false;
  const normalized = normalizeKey(key);
  for (const needle of options.redactKeys) {
    if (needle && normalized.indexOf(needle) !== -1) return true;
  }
  return false;
}

/** O que cabe numa LINHA da lista sem o log virar parágrafo. */
const PREVIEW_LIMIT = 80;

/**
 * Quantos itens o array tinha DE VERDADE.
 *
 * O toPlain corta em maxArrayItems e empurra `«+N items»` no fim, então o
 * comprimento do array já achatado mente: 200 itens viram 101. O preview tem
 * que dizer 200 — é o número que o dev reconhece.
 */
const ARRAY_CUT = /^«\+(\d+) items»$/;
function arrayCount(plain: unknown[]): number {
  const last = plain[plain.length - 1];
  const cut = typeof last === "string" ? ARRAY_CUT.exec(last) : null;
  return cut ? plain.length - 1 + Number(cut[1]) : plain.length;
}
/** Teto da silhueta de chaves antes de virar só a contagem. */
const SILHOUETTE_LIMIT = 120;

/**
 * Preview de UMA LINHA, para a lista e para a mensagem.
 *
 * Escada de degradação, do mais informativo ao mais compacto:
 *
 *   {"id":7,"ok":true}     cabe inteiro — o dev lê o valor sem clicar
 *   {ts, context, error}   não coube — silhueta de chaves
 *   {14 keys}              nem a silhueta coube
 *
 * O conteúdo íntegro nunca depende disto: ele viaja em `json` e quem o mostra é
 * o painel de detalhe. Antes o teto era 200 chars de JSON cru colados dentro da
 * mensagem, e um único log de erro ocupava três linhas da lista — repetindo o
 * que o painel logo abaixo já mostrava estruturado.
 */
function compactPreview(plain: unknown, limit: number = PREVIEW_LIMIT): string {
  let text: string;
  try {
    text = JSON.stringify(plain) ?? "null";
  } catch {
    return "«unserializable»";
  }
  if (text.length <= limit) return text;

  if (Array.isArray(plain)) return `[${arrayCount(plain)} items]`;
  if (plain !== null && typeof plain === "object") {
    const keys = Object.keys(plain as Record<string, unknown>);
    if (keys.length === 0) return text.slice(0, limit) + "…";
    const silhouette = `{${keys.join(", ")}}`;
    return silhouette.length <= SILHOUETTE_LIMIT ? silhouette : `{${keys.length} keys}`;
  }
  return `${text.slice(0, limit)}…`;
}

/** Cabeçalho de erro numa linha: `Error: mensagem`, capado. */
function errorPreview(value: Error): string {
  const text = `${value.name}: ${value.message}`;
  return text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT)}…` : text;
}

/** Caps mais apertados na 2ª passada, quando a 1ª estourou o teto de tamanho. */
function tighten(options: LogsOptions): LogsOptions {
  return {
    ...options,
    maxDepth: 2,
    maxKeys: 20,
    maxArrayItems: 20,
    maxStringLength: 200,
  };
}

export function serializeArg(value: unknown, options: LogsOptions): LogArg {
  if (typeof value === "string") {
    const truncated = value.length > options.maxArgLength;
    return {
      kind: "text",
      preview: truncated ? `${value.slice(0, options.maxArgLength)}…` : value,
      json: null,
      truncated,
    };
  }
  if (
    value === null ||
    value === undefined ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return { kind: "text", preview: primitiveLabel(value), json: null, truncated: false };
  }
  if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") {
    return { kind: "unserializable", preview: primitiveLabel(value), json: null, truncated: false };
  }

  const errorLike = isError(value);
  const state: PlainState = { truncated: false };
  let plain = toPlain(value, options, 0, new Set<unknown>(), state);
  let json: string;
  try {
    json = JSON.stringify(plain, null, 2) ?? "null";
  } catch {
    return { kind: "unserializable", preview: "«unserializable»", json: null, truncated: false };
  }

  // Estourou o teto: reserializa com caps apertados. O JSON que chega ao Studio
  // tem que ser VÁLIDO — cortar a string no meio quebraria o viewer.
  if (json.length > options.maxArgLength) {
    const tight = tighten(options);
    state.truncated = true;
    plain = toPlain(value, tight, 0, new Set<unknown>(), state);
    try {
      json = JSON.stringify(plain, null, 2) ?? "null";
    } catch {
      json = "null";
    }
    if (json.length > options.maxArgLength) {
      const preview = compactPreview(plain, PREVIEW_LIMIT);
      plain = { "«truncated»": "objeto grande demais para o fio", preview };
      json = JSON.stringify(plain, null, 2) ?? "null";
    }
  }

  const preview = errorLike ? errorPreview(value as Error) : compactPreview(plain);

  return {
    kind: errorLike ? "error" : "json",
    preview,
    json,
    truncated: state.truncated,
  };
}

/* ------------------------------------------------------------------ *
 * Mensagem e namespace
 * ------------------------------------------------------------------ */

export function formatMessage(args: LogArg[], options: LogsOptions): string {
  const message = args.map((arg) => arg.preview).join(" ");
  return message.length > options.maxMessageLength
    ? `${message.slice(0, options.maxMessageLength)}…`
    : message;
}

const NAMESPACE_BRACKET = /^\s*\[([^\]\s][^\]]{0,31})\]/;
const NAMESPACE_COLON = /^\s*([A-Za-z][\w.-]{0,31}):\s/;

/**
 * Palavras que são NÍVEL, não namespace.
 *
 * `console.error("[ERROR] Auth: falhou")` é o formato de meio mundo. Tratar
 * "ERROR" como namespace pintava dois badges idênticos no detalhe (um de nível,
 * outro de namespace), enchia o filtro de namespace com ERROR/WARN/INFO, e —
 * pior — escondia "Auth", que é o namespace de verdade, porque a regra de
 * colchete vencia antes da regra de dois-pontos.
 */
const LEVEL_WORDS = new Set([
  "log",
  "info",
  "warn",
  "warning",
  "error",
  "err",
  "debug",
  "trace",
  "fatal",
  "critical",
  "notice",
  "verbose",
  "silly",
]);

/** Prefixos de nível empilhados (`[INFO][Auth]`) são raros mas existem. */
const MAX_LEVEL_PREFIXES = 3;

/**
 * Namespace inferido do prefixo da mensagem.
 *
 * Pedir para o dev taguear 300 `console.log` que já existem não escala; metade
 * do mundo já escreve `console.log("[Auth] ...")`. Isto dá estrutura de graça
 * em código legado, sem exigir uma linha de mudança no app.
 */
export function deriveNamespace(message: string): string | null {
  let rest = message;
  for (let i = 0; i < MAX_LEVEL_PREFIXES; i += 1) {
    const bracket = NAMESPACE_BRACKET.exec(rest);
    if (!bracket?.[1]) break;
    const label = bracket[1].trim();
    if (!LEVEL_WORDS.has(label.toLowerCase())) return label || null;
    // Era só o nível: descarta e procura o namespace no que sobrou.
    rest = rest.slice(bracket[0].length);
  }
  const colon = NAMESPACE_COLON.exec(rest);
  if (colon?.[1]) return colon[1].trim() || null;
  return null;
}

/**
 * Duas entradas são "a mesma linha de novo", para efeito do ×N?
 *
 * Os ARGUMENTOS entram na conta. Antes bastava nível+mensagem, e isso só
 * parecia funcionar porque a mensagem carregava até 200 chars do JSON dos
 * argumentos: dois objetos que só diferissem DEPOIS do corte já fundiam, e um
 * deles simplesmente não era emitido. Com o preview reduzido a uma silhueta a
 * colisão deixaria de ser exceção e viraria o caso comum.
 *
 * Comparação estrutural em vez de assinatura em string: sai fora no primeiro
 * campo diferente, sem concatenar até 96 KB de argumentos por log só para
 * descobrir que dois logs são diferentes.
 */
export function isSameLogLine(a: LogEntry, b: LogEntry): boolean {
  if (a.level !== b.level || a.message !== b.message) return false;
  if (a.namespace !== b.namespace || a.stack !== b.stack) return false;
  if (a.args.length !== b.args.length) return false;
  for (let i = 0; i < a.args.length; i += 1) {
    const left = a.args[i]!;
    const right = b.args[i]!;
    if (left.json !== right.json || left.preview !== right.preview) return false;
  }
  return true;
}

/** Estimativa barata do custo de fio de uma entrada. */
function entryCost(entry: LogEntry): number {
  let cost = entry.message.length + 200;
  for (const arg of entry.args) cost += arg.preview.length + (arg.json?.length ?? 0);
  if (entry.stack) cost += entry.stack.length;
  return cost;
}

/* ------------------------------------------------------------------ *
 * Batcher
 * ------------------------------------------------------------------ */

export interface LogBatcher {
  push(entry: LogEntry): void;
  /** Entrega o que está pendente agora (no-op enquanto não está pronto). */
  flush(): void;
  /** Conexão pronta (hello-ack) ou caída. Ao ficar pronta, drena o acumulado. */
  setReady(ready: boolean): void;
  dispose(): void;
}

/**
 * Acumula entradas e entrega em LOTES.
 *
 * Por que não reusar o `createCoalescer` do storage: ele é last-write-wins —
 * o flush entrega só o último item da chave e DESCARTA os intermediários. Isso
 * é correto para storage (o último valor da chave é o estado) e errado para
 * log, onde cada linha é um fato distinto. Aqui a fusão só acontece entre
 * entradas IDÊNTICAS e consecutivas, virando `repeat` (o "×N").
 *
 * Três defesas de volume, nesta ordem:
 *  1. fusão de idênticas consecutivas (o loop de render vira uma linha);
 *  2. teto duro por segundo, com `dropped` honesto;
 *  3. lote fechado por contagem, por tamanho ou por janela.
 */
export function createLogBatcher(
  deliver: (batch: LogBatch) => void,
  options: LogsOptions,
): LogBatcher {
  let pending: LogEntry[] = [];
  let pendingChars = 0;
  let dropped = 0;
  let ready = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let windowStart = 0;
  let windowCount = 0;
  let disposed = false;

  function clearTimer(): void {
    if (timer !== null && typeof clearTimeout === "function") clearTimeout(timer);
    timer = null;
  }

  function scheduleFlush(): void {
    if (timer !== null || typeof setTimeout !== "function") return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, options.flushMs);
  }

  function flush(): void {
    if (disposed) return;
    // Enquanto não está pronto o acumulado FICA — é o que salva o startup.
    if (!ready || pending.length === 0) return;
    clearTimer();
    while (pending.length > 0) {
      const entries = pending.splice(0, options.maxBatchEntries);
      const batch: LogBatch = { entries, dropped };
      dropped = 0;
      deliver(batch);
    }
    pendingChars = 0;
  }

  return {
    push(entry) {
      if (disposed) return;

      const now = entry.ts;
      if (now - windowStart >= 1000) {
        windowStart = now;
        windowCount = 0;
      }

      // Fusão de idênticas consecutivas: não conta contra o teto e não cresce
      // o lote — é o caso do loop de render, que é ruído, não informação.
      const last = pending[pending.length - 1];
      if (last && isSameLogLine(last, entry)) {
        last.repeat += 1;
        return;
      }

      if (windowCount >= options.maxPerSecond) {
        dropped += 1;
        return;
      }
      windowCount += 1;

      pending.push(entry);
      pendingChars += entryCost(entry);

      if (!ready) {
        // Ring pré-conexão: mantém as MAIS RECENTES e conta o que caiu.
        while (pending.length > options.preReadyBuffer) {
          const evicted = pending.shift();
          if (evicted) pendingChars -= entryCost(evicted);
          dropped += 1;
        }
        return;
      }

      if (pending.length >= options.maxBatchEntries || pendingChars >= options.maxBatchChars) {
        flush();
        return;
      }
      scheduleFlush();
    },
    flush,
    setReady(next) {
      if (ready === next) return;
      ready = next;
      if (ready) flush();
    },
    dispose() {
      disposed = true;
      clearTimer();
      pending = [];
      pendingChars = 0;
      dropped = 0;
    },
  };
}

/** Reexportado para o install não reimportar do protocolo. */
export { LOGS_MODULE, LOGS_EVENT };
