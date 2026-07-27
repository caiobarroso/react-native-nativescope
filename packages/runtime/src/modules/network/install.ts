import {
  NETWORK_COMMAND,
  NETWORK_EVENT,
  NETWORK_MODULE,
  type NetworkBody,
  type NetworkGetBodyResult,
  type NetworkReplayResult,
  type NetworkRequest,
} from "@rnsi/protocol";
import type { Runtime } from "../../bootstrap.ts";
import {
  captureRequestBody,
  captureResponseBody,
  createRequestBuffer,
  isIgnoredUrl,
  normalizeNetworkOptions,
  parseResponseHeaders,
  parseUrl,
  redactHeaders,
  utf8ByteLength,
  type RequestBufferEntry,
} from "./capture.ts";

/**
 * Módulo de Network — instrumenta `global.XMLHttpRequest` (o `fetch` do RN roda
 * sobre XHR, então patchar XHR captura os dois). Instalado no boot antecipado
 * (earlyBoot) via MODULE_INSTALLERS, ANTES do app fazer qualquer request.
 *
 * Princípio inegociável: o inspector NUNCA derruba o app. Todo callback vive num
 * try/catch; se a instrumentação falhar, degrada para passthrough do XHR real.
 */

const STATE: unique symbol = Symbol("rnsiNetworkState");

interface CapturedBody {
  body: NetworkBody;
  full: string | null;
}

interface XhrState {
  id: string;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  startedAt: number;
  requestBody: CapturedBody | null;
  errorMessage: string | null;
  /** id da request original quando este XHR é um replay; null no tráfego normal. */
  replayOf: string | null;
  done: boolean;
}

interface XhrLike {
  [STATE]?: XhrState;
  __rnsiReplayOf?: string;
  status: number;
  statusText?: string;
  responseType?: string;
  responseText?: string;
  response?: unknown;
  getAllResponseHeaders?(): string;
  addEventListener?(type: string, listener: () => void): void;
  open(method: string, url: string, ...rest: unknown[]): void;
  send(body?: unknown): void;
  setRequestHeader(name: string, value: string): void;
}

interface XhrProto {
  open?: (this: XhrLike, method: string, url: string, ...rest: unknown[]) => void;
  send?: (this: XhrLike, body?: unknown) => void;
  setRequestHeader?: (this: XhrLike, name: string, value: string) => void;
  __rnsiNetworkPatched?: boolean;
  __rnsiNetworkUninstall?: () => void;
}

interface XhrCtor {
  prototype: XhrProto;
  new (): XhrLike;
}

let nextId = 1;
function generateId(): string {
  return `n-${nextId++}-${Math.random().toString(36).slice(2, 8)}`;
}

function fullBody(text: string): NetworkBody {
  const trimmed = text.trimStart();
  return {
    text,
    size: utf8ByteLength(text),
    truncated: false,
    contentType: null,
    kind: trimmed.startsWith("{") || trimmed.startsWith("[") ? "json" : "text",
  };
}

function headerValueCI(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

/** Substitui (case-insensitive) ou adiciona um header. */
function withHeader(
  headers: Record<string, string>,
  name: string,
  value: string,
): Record<string, string> {
  const lower = name.toLowerCase();
  const out: Record<string, string> = {};
  let replaced = false;
  for (const [key, val] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      out[key] = value;
      replaced = true;
    } else {
      out[key] = val;
    }
  }
  if (!replaced) out[name] = value;
  return out;
}

/** Troca a query string de uma URL (preserva path e fragmento). */
function setQuery(url: string, query: string | null): string {
  const hashIdx = url.indexOf("#");
  const fragment = hashIdx === -1 ? "" : url.slice(hashIdx);
  const base = hashIdx === -1 ? url : url.slice(0, hashIdx);
  const qIdx = base.indexOf("?");
  const withoutQuery = qIdx === -1 ? base : base.slice(0, qIdx);
  const q = query ? `?${query.replace(/^\?/, "")}` : "";
  return `${withoutQuery}${q}${fragment}`;
}

/**
 * Instala o módulo. Retorna uma função de desinstalação (restaura o XHR e
 * remove o handler de comando). Idempotente: patch aplicado uma vez só.
 */
export function installNetworkModule(runtime: Runtime, config?: unknown): () => void {
  const options = normalizeNetworkOptions(config);
  const root = globalThis as unknown as { XMLHttpRequest?: XhrCtor };
  const XHR = root.XMLHttpRequest;
  if (!XHR || !XHR.prototype) return () => {};
  if (XHR.prototype.__rnsiNetworkPatched) {
    return XHR.prototype.__rnsiNetworkUninstall ?? (() => {});
  }

  // Referência já estreitada (o guard acima garante definido) — usada nas
  // closures abaixo, onde o TS não propaga o narrowing do const capturado.
  const Ctor: XhrCtor = XHR;
  const buffer = createRequestBuffer(options.maxRequests);
  // Auth/cookie mais recentes por origin — base do replay "current-session".
  const latestAuthByOrigin = new Map<string, { authorization?: string; cookie?: string }>();

  function finalize(xhr: XhrLike, state: XhrState): void {
    if (state.done) return;
    state.done = true;
    try {
      const endedAt = Date.now();
      const rawStatus = typeof xhr.status === "number" ? xhr.status : 0;
      const status = rawStatus > 0 ? rawStatus : null;
      const ok = status !== null && status >= 200 && status < 300;
      const responseHeaders = parseResponseHeaders(
        typeof xhr.getAllResponseHeaders === "function" ? xhr.getAllResponseHeaders() : "",
      );
      const responseCaptured = captureResponseBody(xhr, responseHeaders, options);
      const { origin, path, query } = parseUrl(state.url);

      // Guarda a sessão fresca deste origin p/ o replay current-session.
      const auth = headerValueCI(state.requestHeaders, "authorization");
      const cookie = headerValueCI(state.requestHeaders, "cookie");
      if (auth !== undefined || cookie !== undefined) {
        latestAuthByOrigin.set(origin, {
          ...(auth !== undefined ? { authorization: auth } : {}),
          ...(cookie !== undefined ? { cookie } : {}),
        });
      }

      const error =
        status === null ? (state.errorMessage ?? "request failed (no response)") : null;

      const record: NetworkRequest = {
        id: state.id,
        method: state.method,
        url: state.url,
        origin,
        path,
        query,
        status,
        statusText: typeof xhr.statusText === "string" ? xhr.statusText : null,
        ok,
        error,
        startedAt: state.startedAt,
        endedAt,
        duration: Math.max(0, endedAt - state.startedAt),
        requestSize: state.requestBody?.body.size ?? 0,
        responseSize: responseCaptured?.body.size ?? 0,
        requestHeaders: redactHeaders(state.requestHeaders, options.redactHeaders),
        responseHeaders: redactHeaders(responseHeaders, options.redactHeaders),
        requestBody: state.requestBody?.body ?? null,
        responseBody: responseCaptured?.body ?? null,
        replayOf: state.replayOf,
      };

      buffer.set(state.id, {
        requestFull: state.requestBody?.full ?? null,
        responseFull: responseCaptured?.full ?? null,
        method: state.method,
        url: state.url,
        requestHeaders: state.requestHeaders,
      });

      runtime.sendModuleEvent(NETWORK_MODULE, NETWORK_EVENT.request, record);
    } catch {
      /* a instrumentação nunca derruba o app, mesmo ao emitir */
    }
  }

  function attachListeners(xhr: XhrLike, state: XhrState): void {
    if (typeof xhr.addEventListener !== "function") return;
    const note = (message: string) => {
      if (state.errorMessage === null) state.errorMessage = message;
    };
    try {
      xhr.addEventListener("error", () => note("network error"));
      xhr.addEventListener("timeout", () => note("timeout"));
      xhr.addEventListener("abort", () => note("aborted"));
      xhr.addEventListener("loadend", () => finalize(xhr, state));
    } catch {
      /* nunca propaga */
    }
  }

  const proto = XHR.prototype;
  const originalOpen = proto.open;
  const originalSend = proto.send;
  const originalSetRequestHeader = proto.setRequestHeader;

  proto.open = function open(this: XhrLike, method, url, ...rest) {
    try {
      this[STATE] = {
        id: generateId(),
        method: String(method || "GET").toUpperCase(),
        url: String(url || ""),
        requestHeaders: {},
        startedAt: 0,
        requestBody: null,
        errorMessage: null,
        replayOf: this.__rnsiReplayOf ?? null,
        done: false,
      };
    } catch {
      /* nunca propaga */
    }
    return originalOpen?.call(this, method, url, ...rest);
  };

  proto.setRequestHeader = function setRequestHeader(this: XhrLike, name, value) {
    try {
      const state = this[STATE];
      if (state) state.requestHeaders[String(name)] = String(value);
    } catch {
      /* nunca propaga */
    }
    return originalSetRequestHeader?.call(this, name, value);
  };

  proto.send = function send(this: XhrLike, body) {
    try {
      const state = this[STATE];
      if (state && !isIgnoredUrl(state.url, options)) {
        state.startedAt = Date.now();
        state.requestBody = captureRequestBody(body, options);
        attachListeners(this, state);
      }
    } catch {
      /* nunca propaga */
    }
    return originalSend?.call(this, body);
  };

  proto.__rnsiNetworkPatched = true;
  const uninstall = () => {
    proto.open = originalOpen;
    proto.send = originalSend;
    proto.setRequestHeader = originalSetRequestHeader;
    delete proto.__rnsiNetworkPatched;
    delete proto.__rnsiNetworkUninstall;
  };
  proto.__rnsiNetworkUninstall = uninstall;

  function handleReplay(data: unknown): NetworkReplayResult {
    const input = (data && typeof data === "object" ? data : {}) as {
      id?: unknown;
      mode?: unknown;
      overrides?: {
        method?: unknown;
        url?: unknown;
        query?: unknown;
        headers?: Record<string, unknown>;
        body?: unknown;
      };
    };
    const id = typeof input.id === "string" ? input.id : "";
    const entry = buffer.get(id);
    if (!entry) return { id: null };
    const overrides = input.overrides ?? {};

    const method =
      typeof overrides.method === "string" ? overrides.method.toUpperCase() : entry.method;
    let url = typeof overrides.url === "string" ? overrides.url : entry.url;
    if (typeof overrides.query === "string" || overrides.query === null) {
      url = setQuery(url, overrides.query as string | null);
    }

    let headers: Record<string, string> = { ...entry.requestHeaders };
    if (overrides.headers && typeof overrides.headers === "object") {
      for (const [key, value] of Object.entries(overrides.headers)) {
        if (typeof value === "string") headers = withHeader(headers, key, value);
      }
    }
    if (input.mode === "current-session") {
      const fresh = latestAuthByOrigin.get(parseUrl(url).origin);
      if (fresh?.authorization) headers = withHeader(headers, "Authorization", fresh.authorization);
      if (fresh?.cookie) headers = withHeader(headers, "Cookie", fresh.cookie);
    }

    const body =
      overrides.body !== undefined
        ? (overrides.body as string | null)
        : entry.requestFull;

    return { id: executeReplay(id, method, url, headers, body) };
  }

  function executeReplay(
    originalId: string,
    method: string,
    url: string,
    headers: Record<string, string>,
    body: string | null,
  ): string | null {
    try {
      const xhr = new Ctor();
      xhr.__rnsiReplayOf = originalId;
      xhr.open(method, url);
      for (const [name, value] of Object.entries(headers)) {
        try {
          xhr.setRequestHeader(name, value);
        } catch {
          /* headers proibidos (Host, Content-Length…): ignora, não aborta o replay */
        }
      }
      const newId = xhr[STATE]?.id ?? null;
      xhr.send(body ?? undefined);
      return newId;
    } catch {
      return null;
    }
  }

  const removeCommand = runtime.onModuleCommand(NETWORK_MODULE, (command, data) => {
    if (command === NETWORK_COMMAND.getBody) return handleGetBody(data, buffer);
    if (command === NETWORK_COMMAND.replay) return handleReplay(data);
    throw new Error(`unknown network command: ${command}`);
  });

  return () => {
    try {
      uninstall();
      removeCommand();
    } catch {
      /* nunca propaga */
    }
  };
}

function handleGetBody(
  data: unknown,
  buffer: { get(id: string): RequestBufferEntry | undefined },
): NetworkGetBodyResult {
  const input = (data && typeof data === "object" ? data : {}) as {
    id?: unknown;
    side?: unknown;
  };
  const id = typeof input.id === "string" ? input.id : "";
  const side = input.side === "request" ? "request" : "response";
  const entry = buffer.get(id);
  if (!entry) return { available: false, body: null };
  const full = side === "request" ? entry.requestFull : entry.responseFull;
  if (full === null) return { available: false, body: null };
  return { available: true, body: fullBody(full) };
}
