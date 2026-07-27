import {
  NETWORK_COMMAND,
  NETWORK_EVENT,
  NETWORK_MODULE,
  type NetworkBody,
  type NetworkGetBodyResult,
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
  type NetworkOptions,
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
  done: boolean;
}

interface XhrLike {
  [STATE]?: XhrState;
  status: number;
  statusText?: string;
  responseType?: string;
  responseText?: string;
  response?: unknown;
  getAllResponseHeaders?(): string;
  addEventListener?(type: string, listener: () => void): void;
}

interface XhrCtor {
  prototype: {
    open?: (this: XhrLike, method: string, url: string, ...rest: unknown[]) => void;
    send?: (this: XhrLike, body?: unknown) => void;
    setRequestHeader?: (this: XhrLike, name: string, value: string) => void;
    __rnsiNetworkPatched?: boolean;
    __rnsiNetworkUninstall?: () => void;
  };
}

let nextId = 1;
function generateId(): string {
  return `n-${nextId++}-${Math.random().toString(36).slice(2, 8)}`;
}

function fullBody(text: string, contentType: string | null): NetworkBody {
  const trimmed = text.trimStart();
  return {
    text,
    size: utf8ByteLength(text),
    truncated: false,
    contentType,
    kind: trimmed.startsWith("{") || trimmed.startsWith("[") ? "json" : "text",
  };
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

  const buffer = createRequestBuffer(options.maxRequests);
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
        attachListeners(this, state, runtime, buffer, options);
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

  const removeCommand = runtime.onModuleCommand(NETWORK_MODULE, (command, data) => {
    if (command === NETWORK_COMMAND.getBody) return handleGetBody(data, buffer);
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

function attachListeners(
  xhr: XhrLike,
  state: XhrState,
  runtime: Runtime,
  buffer: ReturnType<typeof createRequestBuffer>,
  options: NetworkOptions,
): void {
  if (typeof xhr.addEventListener !== "function") return;
  const note = (message: string) => {
    if (state.errorMessage === null) state.errorMessage = message;
  };
  try {
    xhr.addEventListener("error", () => note("network error"));
    xhr.addEventListener("timeout", () => note("timeout"));
    xhr.addEventListener("abort", () => note("aborted"));
    xhr.addEventListener("loadend", () => finalize(xhr, state, runtime, buffer, options));
  } catch {
    /* nunca propaga */
  }
}

function finalize(
  xhr: XhrLike,
  state: XhrState,
  runtime: Runtime,
  buffer: ReturnType<typeof createRequestBuffer>,
  options: NetworkOptions,
): void {
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

function handleGetBody(
  data: unknown,
  buffer: ReturnType<typeof createRequestBuffer>,
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
  return { available: true, body: fullBody(full, null) };
}
