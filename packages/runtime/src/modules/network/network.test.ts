import { afterEach, describe, expect, it } from "vitest";
import type { NetworkRequest } from "@rnsi/protocol";
import type { Runtime } from "../../bootstrap.ts";
import { installNetworkModule } from "./install.ts";
import {
  captureRequestBody,
  isIgnoredUrl,
  makeBody,
  normalizeNetworkOptions,
  parseResponseHeaders,
  parseUrl,
  utf8ByteLength,
} from "./capture.ts";

describe("network capture — helpers puros", () => {
  it("parseUrl separa origin/path/query (absoluto e relativo)", () => {
    expect(parseUrl("https://api.app.com/products?page=1")).toEqual({
      origin: "https://api.app.com",
      path: "/products",
      query: "page=1",
    });
    expect(parseUrl("/users")).toEqual({ origin: "", path: "/users", query: null });
    expect(parseUrl("https://x.io")).toEqual({ origin: "https://x.io", path: "/", query: null });
  });

  it("utf8ByteLength conta multibyte e surrogates", () => {
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("á")).toBe(2);
    expect(utf8ByteLength("€")).toBe(3);
    expect(utf8ByteLength("😀")).toBe(4);
  });

  it("parseResponseHeaders parseia o texto cru do getAllResponseHeaders", () => {
    const raw = "Content-Type: application/json\r\nContent-Length: 42\r\n";
    expect(parseResponseHeaders(raw)).toEqual({
      "Content-Type": "application/json",
      "Content-Length": "42",
    });
  });

  it("isIgnoredUrl filtra ruído de devtools por padrão", () => {
    const options = normalizeNetworkOptions({});
    expect(isIgnoredUrl("http://localhost:8081/symbolicate", options)).toBe(true);
    expect(isIgnoredUrl("https://api.app.com/products", options)).toBe(false);
  });

  it("isIgnoredUrl respeita ignoreUrls do usuário", () => {
    const options = normalizeNetworkOptions({ ignoreUrls: ["/analytics"] });
    expect(isIgnoredUrl("https://api.app.com/analytics/track", options)).toBe(true);
  });

  it("makeBody capa o preview e marca truncated, mantendo o size real", () => {
    const options = normalizeNetworkOptions({ maxBodyPreview: 10 });
    const { body, full } = makeBody("0123456789ABCDEF", options, "text/plain");
    expect(body.text).toBe("0123456789");
    expect(body.truncated).toBe(true);
    expect(body.size).toBe(16);
    expect(full).toBe("0123456789ABCDEF"); // íntegro retido (abaixo do maxBodyStore)
  });

  it("makeBody detecta JSON pelo primeiro caractere", () => {
    const options = normalizeNetworkOptions({});
    expect(makeBody('{"a":1}', options, null).body.kind).toBe("json");
    expect(makeBody("hello", options, null).body.kind).toBe("text");
  });

  it("captureRequestBody classifica string vs binário", () => {
    const options = normalizeNetworkOptions({});
    expect(captureRequestBody('{"q":1}', options)?.body.kind).toBe("json");
    expect(captureRequestBody(new ArrayBuffer(8), options)?.body).toEqual({
      text: "",
      size: 8,
      truncated: false,
      contentType: null,
      kind: "binary",
    });
    expect(captureRequestBody(null, options)).toBeNull();
  });
});

// -------------------------------------------------------------- patch de XHR

class FakeXHR {
  status = 0;
  statusText = "";
  responseType = "";
  responseText = "";
  response: unknown = undefined;
  private resHeaders = "";
  private listeners: Record<string, Array<() => void>> = {};

  open(_method: string, _url: string): void {}
  send(_body?: unknown): void {}
  setRequestHeader(_name: string, _value: string): void {}
  getAllResponseHeaders(): string {
    return this.resHeaders;
  }
  addEventListener(type: string, fn: () => void): void {
    (this.listeners[type] ??= []).push(fn);
  }

  // Helpers de teste:
  respond(status: number, body: string, headers: string): void {
    this.status = status;
    this.responseText = body;
    this.resHeaders = headers;
    this.emit("loadend");
  }
  fail(message: "error" | "timeout" | "abort"): void {
    this.status = 0;
    this.emit(message);
    this.emit("loadend");
  }
  private emit(type: string): void {
    for (const fn of this.listeners[type] ?? []) fn();
  }
}

interface FakeRuntime {
  runtime: Runtime;
  events: Array<{ module: string; event: string; data: unknown }>;
  invoke: (command: string, data: unknown) => unknown | Promise<unknown>;
}

function fakeRuntime(): FakeRuntime {
  const events: FakeRuntime["events"] = [];
  let handler: ((command: string, data: unknown) => unknown) | null = null;
  const runtime = {
    registry: {} as Runtime["registry"],
    sendModuleEvent: (module: string, event: string, data?: unknown) =>
      events.push({ module, event, data }),
    onModuleCommand: (_module: string, h: (command: string, data: unknown) => unknown) => {
      handler = h;
      return () => {
        handler = null;
      };
    },
    close: () => {},
  } satisfies Runtime;
  return {
    runtime,
    events,
    invoke: (command, data) => {
      if (!handler) throw new Error("nenhum handler registrado");
      return handler(command, data);
    },
  };
}

describe("network module — patch de XMLHttpRequest", () => {
  const original = (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
  afterEach(() => {
    (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = original;
  });

  function setup(config?: unknown): FakeRuntime {
    // Classe fresca por teste → o flag de patch não vaza entre casos.
    class XHR extends FakeXHR {}
    (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = XHR;
    const fake = fakeRuntime();
    installNetworkModule(fake.runtime, config);
    return fake;
  }

  it("captura uma request GET e emite module.event network/request", () => {
    const fake = setup();
    const Ctor = (globalThis as unknown as { XMLHttpRequest: new () => FakeXHR }).XMLHttpRequest;
    const xhr = new Ctor();
    xhr.open("get", "https://api.app.com/products?page=1");
    xhr.setRequestHeader("Authorization", "Bearer tok");
    xhr.send('{"q":1}');
    xhr.respond(200, '{"ok":true}', "content-type: application/json\r\ncontent-length: 11");

    expect(fake.events).toHaveLength(1);
    const evt = fake.events[0]!;
    expect(evt.module).toBe("network");
    expect(evt.event).toBe("request");
    const record = evt.data as NetworkRequest;
    expect(record.method).toBe("GET");
    expect(record.path).toBe("/products");
    expect(record.query).toBe("page=1");
    expect(record.status).toBe(200);
    expect(record.ok).toBe(true);
    expect(record.requestHeaders.Authorization).toBe("Bearer tok");
    expect(record.requestBody?.text).toBe('{"q":1}');
    expect(record.responseBody?.text).toBe('{"ok":true}');
    expect(record.responseBody?.kind).toBe("json");
  });

  it("marca ok:false e error em falha de rede (status 0)", () => {
    const fake = setup();
    const Ctor = (globalThis as unknown as { XMLHttpRequest: new () => FakeXHR }).XMLHttpRequest;
    const xhr = new Ctor();
    xhr.open("POST", "https://api.app.com/login");
    xhr.send("{}");
    xhr.fail("timeout");

    expect(fake.events).toHaveLength(1);
    const record = fake.events[0]!.data as NetworkRequest;
    expect(record.status).toBeNull();
    expect(record.ok).toBe(false);
    expect(record.error).toBe("timeout");
  });

  it("não captura URLs ignoradas (ruído de devtools)", () => {
    const fake = setup();
    const Ctor = (globalThis as unknown as { XMLHttpRequest: new () => FakeXHR }).XMLHttpRequest;
    const xhr = new Ctor();
    xhr.open("GET", "http://localhost:8081/symbolicate");
    xhr.send();
    xhr.respond(200, "{}", "");
    expect(fake.events).toHaveLength(0);
  });

  it("get-body devolve o corpo íntegro da response capturada", () => {
    const fake = setup({ maxBodyPreview: 4 }); // força truncated no evento
    const Ctor = (globalThis as unknown as { XMLHttpRequest: new () => FakeXHR }).XMLHttpRequest;
    const xhr = new Ctor();
    xhr.open("GET", "https://api.app.com/feed");
    xhr.send();
    xhr.respond(200, '{"items":[1,2,3]}', "content-type: application/json");

    const record = fake.events[0]!.data as NetworkRequest;
    expect(record.responseBody?.truncated).toBe(true);
    expect(record.responseBody?.text).toBe('{"it'); // preview capado em 4

    const result = fake.invoke("get-body", { id: record.id, side: "response" }) as {
      available: boolean;
      body: { text: string } | null;
    };
    expect(result.available).toBe(true);
    expect(result.body?.text).toBe('{"items":[1,2,3]}');
  });

  it("get-body de id inexistente → available:false", () => {
    const fake = setup();
    const result = fake.invoke("get-body", { id: "nope", side: "response" }) as {
      available: boolean;
    };
    expect(result.available).toBe(false);
  });

  it("não derruba o app: instalar duas vezes é idempotente", () => {
    const fake = setup();
    const XHR = (globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest;
    // segunda instalação não repatcha nem lança
    expect(() => installNetworkModule(fake.runtime)).not.toThrow();
    expect((globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest).toBe(XHR);
  });
});
