import type { NetworkBody } from "@rnsi/protocol";

/**
 * Helpers PUROS de captura de rede (sem tocar globals) — o que dá para testar
 * sem um XMLHttpRequest de verdade. O patch em si vive em install.ts.
 */

export interface NetworkOptions {
  captureBody: boolean;
  maxBodyPreview: number;
  /** Acima disto o corpo íntegro não é retido (só o preview). Limita memória. */
  maxBodyStore: number;
  maxRequests: number;
  /** Substrings de URL a ignorar (além dos defaults de ruído de devtools). */
  ignoreUrls: string[];
  /** Nomes de header a mascarar no que vai para o Studio. */
  redactHeaders: string[];
}

const DEFAULT_MAX_BODY_PREVIEW = 32 * 1024;
const DEFAULT_MAX_BODY_STORE = 2 * 1024 * 1024;
const DEFAULT_MAX_REQUESTS = 1000;

/** Ruído de devtools que nunca interessa ao dev. WS do inspector não passa por XHR. */
const DEFAULT_IGNORE = ["/symbolicate", "/inspector/", "/logs?"];

export function normalizeNetworkOptions(config: unknown): NetworkOptions {
  const c = (config && typeof config === "object" ? config : {}) as Record<string, unknown>;
  const toStringArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return {
    captureBody: c.captureBody !== false,
    maxBodyPreview:
      typeof c.maxBodyPreview === "number" && c.maxBodyPreview > 0
        ? c.maxBodyPreview
        : DEFAULT_MAX_BODY_PREVIEW,
    maxBodyStore:
      typeof c.maxBodyStore === "number" && c.maxBodyStore > 0
        ? c.maxBodyStore
        : DEFAULT_MAX_BODY_STORE,
    maxRequests:
      typeof c.maxRequests === "number" && c.maxRequests > 0
        ? Math.floor(c.maxRequests)
        : DEFAULT_MAX_REQUESTS,
    ignoreUrls: [...DEFAULT_IGNORE, ...toStringArray(c.ignoreUrls)],
    redactHeaders: toStringArray(c.redactHeaders).map((h) => h.toLowerCase()),
  };
}

export function isIgnoredUrl(url: string, options: NetworkOptions): boolean {
  if (!url) return true;
  for (const needle of options.ignoreUrls) {
    if (needle && url.indexOf(needle) !== -1) return true;
  }
  return false;
}

/** UTF-8 byte length sem depender de TextEncoder/Buffer (nem sempre presentes no Hermes). */
export function utf8ByteLength(str: string): number {
  let n = 0;
  for (let i = 0; i < str.length; i += 1) {
    const c = str.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i += 1; // par surrogate → 1 code point de 4 bytes
    } else n += 3;
  }
  return n;
}

/**
 * Parse de URL sem depender do `URL` global (RN nem sempre polyfilla completo).
 * Extrai origin/path/query de forma tolerante — inclusive URLs relativas.
 */
export function parseUrl(url: string): { origin: string; path: string; query: string | null } {
  const match = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]+)?([^?#]*)(\?[^#]*)?/i.exec(url) ?? [];
  const origin = match[1] ?? "";
  const path = match[2] || "/";
  const rawQuery = match[3] ?? "";
  const query = rawQuery.length > 1 ? rawQuery.slice(1) : null;
  return { origin, path, query };
}

/** Parseia o texto cru de getAllResponseHeaders() num objeto. */
export function parseResponseHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const line of raw.trim().split(/[\r\n]+/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const name = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (name) out[name] = value;
  }
  return out;
}

export function redactHeaders(
  headers: Record<string, string>,
  redact: string[],
): Record<string, string> {
  if (redact.length === 0) return headers;
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = redact.includes(name.toLowerCase()) ? "«redacted»" : value;
  }
  return out;
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

function looksLikeJson(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith("{") || t.startsWith("[");
}

/** Monta o NetworkBody (preview capado) + o texto íntegro (ou null) a reter. */
export function makeBody(
  text: string,
  options: NetworkOptions,
  contentType: string | null,
  kind: NetworkBody["kind"] = "text",
): { body: NetworkBody; full: string | null } {
  const size = utf8ByteLength(text);
  const truncated = text.length > options.maxBodyPreview;
  const preview = truncated ? text.slice(0, options.maxBodyPreview) : text;
  const body: NetworkBody = {
    text: preview,
    size,
    truncated,
    contentType,
    kind: kind === "text" && looksLikeJson(text) ? "json" : kind,
  };
  const full = size <= options.maxBodyStore ? text : null;
  return { body, full };
}

/** Corpo não-textual: registra tipo + tamanho, sem texto. */
export function nonTextBody(
  kind: NetworkBody["kind"],
  size: number,
  contentType: string | null,
): { body: NetworkBody; full: string | null } {
  return {
    body: { text: "", size, truncated: false, contentType, kind },
    full: null,
  };
}

/** Extrai o corpo de request a partir do argumento de xhr.send(...). */
export function captureRequestBody(
  body: unknown,
  options: NetworkOptions,
): { body: NetworkBody; full: string | null } | null {
  if (body === null || body === undefined || body === "") return null;
  if (!options.captureBody) return null;

  if (typeof body === "string") return makeBody(body, options, null, "text");

  // URLSearchParams e afins com toString() útil.
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
    return makeBody(body.toString(), options, "application/x-www-form-urlencoded", "form");
  }
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    return nonTextBody("form", 0, "multipart/form-data");
  }
  if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) {
    return nonTextBody("binary", body.byteLength, null);
  }
  if (ArrayBuffer.isView(body)) {
    return nonTextBody("binary", (body as ArrayBufferView).byteLength, null);
  }
  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return nonTextBody("binary", body.size, body.type || null);
  }
  return nonTextBody("unknown", 0, null);
}

/**
 * Extrai o corpo de response de um XHR já finalizado. Só texto/json rendem
 * preview; blob/arraybuffer viram binário (tamanho pelo Content-Length).
 */
export function captureResponseBody(
  xhr: {
    responseType?: string;
    responseText?: string;
    response?: unknown;
  },
  responseHeaders: Record<string, string>,
  options: NetworkOptions,
): { body: NetworkBody; full: string | null } | null {
  if (!options.captureBody) return null;
  const contentType = headerValue(responseHeaders, "content-type") ?? null;
  const contentLength = Number(headerValue(responseHeaders, "content-length"));
  const type = xhr.responseType ?? "";

  try {
    if (type === "" || type === "text") {
      const text = typeof xhr.responseText === "string" ? xhr.responseText : "";
      if (text === "") return null;
      return makeBody(text, options, contentType, "text");
    }
    if (type === "json") {
      const text = xhr.response === undefined ? "" : JSON.stringify(xhr.response);
      if (!text) return null;
      return makeBody(text, options, contentType, "json");
    }
  } catch {
    /* corpo ilegível: cai no binário */
  }
  const size = Number.isFinite(contentLength) ? contentLength : 0;
  return nonTextBody("binary", size, contentType);
}

/** Buffer em anel por-id: retém as últimas N requests p/ get-body/replay. */
export interface RequestBufferEntry {
  requestFull: string | null;
  responseFull: string | null;
  /** headers/url/method capturados — base do replay. */
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
}

export function createRequestBuffer(max: number) {
  const map = new Map<string, RequestBufferEntry>();
  return {
    set(id: string, entry: RequestBufferEntry): void {
      map.set(id, entry);
      while (map.size > max) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        map.delete(oldest);
      }
    },
    get(id: string): RequestBufferEntry | undefined {
      return map.get(id);
    },
    get size(): number {
      return map.size;
    },
  };
}
