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
  makeBody,
  normalizeNetworkOptions,
  parseResponseHeaders,
  parseUrl,
  redactHeaders,
  utf8ByteLength,
  type RequestBufferEntry,
} from "./capture.ts";

/**
 * Módulo de Network — instrumenta os DOIS pontos de saída HTTP do app:
 *
 *  - `global.XMLHttpRequest` (axios e libs que usam XHR direto; e, no RN
 *    "clássico", o próprio fetch, que roda sobre XHR via whatwg-fetch);
 *  - `global.fetch` (em Expo SDK 52+ o fetch é NATIVO e NÃO passa por XHR — sem
 *    envolver o fetch, nenhuma request baseada nele apareceria).
 *
 * Um guard (`insideFetch`) evita contagem dupla no RN clássico, onde o fetch
 * cria um XHR interno que também seria capturado. Instalado no boot antecipado
 * (earlyBoot) via MODULE_INSTALLERS, ANTES do app fazer qualquer request.
 *
 * Princípio inegociável: o inspector NUNCA derruba o app. Todo callback vive num
 * try/catch; se a instrumentação falhar, degrada para passthrough do real.
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

  // Enquanto true, o wrapper de fetch está executando o fetch original. No RN
  // clássico isso cria um XHR interno (whatwg) — suprimimos a captura no XHR
  // para não contar a MESMA request duas vezes (o wrapper de fetch já captura).
  // Confiável porque whatwg chama open/send SINCRONAMENTE dentro do fetch.
  let insideFetch = false;

  /**
   * Ponto único de emissão — XHR e fetch convergem aqui. Memoiza auth/cookie do
   * origin (replay current-session), guarda os corpos íntegros no buffer (para
   * get-body/replay) e manda o fato ao Studio. `rawRequestHeaders` vem SEM
   * redação (o replay precisa do Authorization real).
   */
  function commit(
    record: NetworkRequest,
    rawRequestHeaders: Record<string, string>,
    full: { request: string | null; response: string | null },
  ): void {
    const auth = headerValueCI(rawRequestHeaders, "authorization");
    const cookie = headerValueCI(rawRequestHeaders, "cookie");
    if (auth !== undefined || cookie !== undefined) {
      latestAuthByOrigin.set(record.origin, {
        ...(auth !== undefined ? { authorization: auth } : {}),
        ...(cookie !== undefined ? { cookie } : {}),
      });
    }
    buffer.set(record.id, {
      requestFull: full.request,
      responseFull: full.response,
      method: record.method,
      url: record.url,
      requestHeaders: rawRequestHeaders,
    });
    runtime.sendModuleEvent(NETWORK_MODULE, NETWORK_EVENT.request, record);
  }

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

      commit(record, state.requestHeaders, {
        request: state.requestBody?.full ?? null,
        response: responseCaptured?.full ?? null,
      });
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
      // insideFetch: este XHR é o interno do whatwg-fetch, que o wrapper de
      // fetch já vai capturar — não conta duas vezes.
      if (state && !insideFetch && !isIgnoredUrl(state.url, options)) {
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

  // --- Interceptação de fetch --------------------------------------------
  // Necessária porque o Expo (SDK 52+) troca o global.fetch por uma implementação
  // NATIVA que não passa por XMLHttpRequest. Capturamos request pelos argumentos
  // e response pela Promise (lendo um clone, para não consumir o corpo do app).

  type FetchFn = (input: unknown, init?: unknown) => unknown;

  interface FetchReq {
    url: string;
    method: string;
    headers: Record<string, string>;
    reqBody: { body: NetworkBody; full: string | null } | null;
  }

  function headersToObject(source: unknown): Record<string, string> {
    const out: Record<string, string> = {};
    if (!source || typeof source !== "object") return out;
    const asHeaders = source as { forEach?: (cb: (value: unknown, key: unknown) => void) => void };
    if (typeof asHeaders.forEach === "function") {
      // Headers (fetch) — forEach(value, name).
      asHeaders.forEach((value, key) => {
        out[String(key)] = String(value);
      });
      return out;
    }
    if (Array.isArray(source)) {
      for (const pair of source) {
        if (Array.isArray(pair) && pair.length >= 2) out[String(pair[0])] = String(pair[1]);
      }
      return out;
    }
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      out[key] = String(value);
    }
    return out;
  }

  function extractFetchRequest(input: unknown, init: unknown): FetchReq {
    let url = "";
    let method = "GET";
    let headers: Record<string, string> = {};
    const request = input as { url?: unknown; method?: unknown; headers?: unknown };
    if (typeof input === "string") {
      url = input;
    } else if (input && typeof request.url !== "undefined") {
      // Request object (ou URL com href): lê url/method/headers dele.
      url = String(request.url);
      if (request.method) method = String(request.method);
      if (request.headers) headers = headersToObject(request.headers);
    } else {
      url = String(input);
    }
    const opts = (init && typeof init === "object" ? init : {}) as {
      method?: unknown;
      headers?: unknown;
      body?: unknown;
    };
    if (opts.method) method = String(opts.method);
    if (opts.headers) headers = { ...headers, ...headersToObject(opts.headers) };
    return {
      url,
      method: method.toUpperCase(),
      headers,
      reqBody: captureRequestBody(opts.body, options),
    };
  }

  function emitFetch(
    id: string,
    req: FetchReq,
    startedAt: number,
    status: number | null,
    statusText: string | null,
    responseHeaders: Record<string, string>,
    error: string | null,
    respCap: { body: NetworkBody; full: string | null } | null,
  ): void {
    const { origin, path, query } = parseUrl(req.url);
    const endedAt = Date.now();
    const record: NetworkRequest = {
      id,
      method: req.method,
      url: req.url,
      origin,
      path,
      query,
      status,
      statusText,
      ok: status !== null && status >= 200 && status < 300,
      error,
      startedAt,
      endedAt,
      duration: Math.max(0, endedAt - startedAt),
      requestSize: req.reqBody?.body.size ?? 0,
      responseSize: respCap?.body.size ?? 0,
      requestHeaders: redactHeaders(req.headers, options.redactHeaders),
      responseHeaders: redactHeaders(responseHeaders, options.redactHeaders),
      requestBody: req.reqBody?.body ?? null,
      responseBody: respCap?.body ?? null,
      replayOf: null,
    };
    commit(record, req.headers, {
      request: req.reqBody?.full ?? null,
      response: respCap?.full ?? null,
    });
  }

  function onFetchResponse(id: string, req: FetchReq, startedAt: number, res: unknown): void {
    try {
      const response = res as {
        status?: unknown;
        statusText?: unknown;
        headers?: unknown;
        clone?: () => { text?: () => Promise<string> };
      };
      const responseHeaders = headersToObject(response.headers);
      const status =
        typeof response.status === "number" && response.status > 0 ? response.status : null;
      const statusText = typeof response.statusText === "string" ? response.statusText : null;
      const contentType = headerValueCI(responseHeaders, "content-type") ?? null;

      let clone: { text?: () => Promise<string> } | null = null;
      try {
        clone = options.captureBody && typeof response.clone === "function" ? response.clone() : null;
      } catch {
        clone = null;
      }
      const done = (respCap: { body: NetworkBody; full: string | null } | null) =>
        emitFetch(id, req, startedAt, status, statusText, responseHeaders, null, respCap);

      if (clone && typeof clone.text === "function") {
        clone.text().then(
          (text) => {
            try {
              done(text ? makeBody(text, options, contentType, "text") : null);
            } catch {
              /* nunca propaga */
            }
          },
          () => {
            try {
              done(null);
            } catch {
              /* nunca propaga */
            }
          },
        );
      } else {
        done(null);
      }
    } catch {
      /* nunca propaga */
    }
  }

  function onFetchError(id: string, req: FetchReq, startedAt: number, err: unknown): void {
    try {
      const message =
        (err && typeof err === "object" && "message" in err
          ? String((err as { message?: unknown }).message)
          : String(err)) || "network error";
      emitFetch(id, req, startedAt, null, null, {}, message, null);
    } catch {
      /* nunca propaga */
    }
  }

  type WrappedFetch = FetchFn & { __rnsiFetchPatched?: boolean; __rnsiOriginalFetch?: FetchFn };
  const rootFetch = root as unknown as { fetch?: WrappedFetch };

  function makeFetchWrapper(orig: FetchFn): WrappedFetch {
    const wrapped = function fetch(this: unknown, input: unknown, init?: unknown) {
      const startedAt = Date.now();
      let id = "";
      let req: FetchReq | null = null;
      try {
        id = generateId();
        req = extractFetchRequest(input, init);
      } catch {
        /* nunca propaga */
      }
      // whatwg cria seu XHR interno DENTRO desta chamada (síncrono) — o guard
      // faz o patch de XHR ignorá-lo, evitando captura dupla.
      insideFetch = true;
      let result: unknown;
      try {
        result = orig.call(this, input, init);
      } finally {
        insideFetch = false;
      }
      try {
        if (id && req && !isIgnoredUrl(req.url, options)) {
          const captured = req;
          Promise.resolve(result).then(
            (res) => onFetchResponse(id, captured, startedAt, res),
            (err) => onFetchError(id, captured, startedAt, err),
          );
        }
      } catch {
        /* nunca propaga */
      }
      return result;
    } as WrappedFetch;
    wrapped.__rnsiFetchPatched = true;
    wrapped.__rnsiOriginalFetch = orig;
    return wrapped;
  }

  /** Envolve o `global.fetch` atual, se ainda não for o nosso. Idempotente. */
  function wrapCurrentFetch(): void {
    try {
      const current = rootFetch.fetch;
      if (typeof current !== "function" || current.__rnsiFetchPatched) return;
      rootFetch.fetch = makeFetchWrapper(current);
    } catch {
      /* nunca propaga */
    }
  }

  function installFetchCapture(): () => void {
    wrapCurrentFetch();
    // Expo (SDK 52+) reinstala o fetch NATIVO logo após o InitializeCore (no seu
    // runtime "winter", via Object.defineProperty), sobrescrevendo o nosso wrap.
    // Re-envolvemos no próximo tick, quando esse fetch já é o definitivo — como
    // toda request do app é posterior (toque/effect), nada escapa.
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (typeof setTimeout === "function") timer = setTimeout(wrapCurrentFetch, 0);
    return () => {
      try {
        if (timer) clearTimeout(timer);
        const current = rootFetch.fetch;
        if (current?.__rnsiFetchPatched && current.__rnsiOriginalFetch) {
          rootFetch.fetch = current.__rnsiOriginalFetch;
        }
      } catch {
        /* nunca propaga */
      }
    };
  }

  const removeFetch = installFetchCapture();

  const removeCommand = runtime.onModuleCommand(NETWORK_MODULE, (command, data) => {
    if (command === NETWORK_COMMAND.getBody) return handleGetBody(data, buffer);
    if (command === NETWORK_COMMAND.replay) return handleReplay(data);
    throw new Error(`unknown network command: ${command}`);
  });

  return () => {
    try {
      uninstall();
      removeFetch();
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
