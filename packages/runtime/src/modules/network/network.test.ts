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
    onReadyChange: (h: (ready: boolean) => void) => {
      h(true);
      return () => {};
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

describe("network module — replay", () => {
  const original = (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
  afterEach(() => {
    (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = original;
  });

  function setupTracked(config?: unknown): { fake: FakeRuntime; instances: FakeXHR[] } {
    const instances: FakeXHR[] = [];
    class XHR extends FakeXHR {
      constructor() {
        super();
        instances.push(this);
      }
    }
    (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = XHR;
    const fake = fakeRuntime();
    installNetworkModule(fake.runtime, config);
    return { fake, instances };
  }

  function newCtor(): new () => FakeXHR {
    return (globalThis as unknown as { XMLHttpRequest: new () => FakeXHR }).XMLHttpRequest;
  }

  function lastRecord(fake: FakeRuntime): NetworkRequest {
    return fake.events[fake.events.length - 1]!.data as NetworkRequest;
  }

  it("replay original reexecuta com headers/url capturados e marca replayOf", () => {
    const { fake, instances } = setupTracked();
    const Ctor = newCtor();
    const xhr = new Ctor();
    xhr.open("POST", "https://api.app.com/login");
    xhr.setRequestHeader("Authorization", "Bearer original");
    xhr.send('{"email":"a@b.c"}');
    xhr.respond(200, '{"token":"t"}', "content-type: application/json");
    const originalId = lastRecord(fake).id;

    const before = instances.length;
    const result = fake.invoke("replay", { id: originalId, mode: "original" }) as { id: string | null };
    expect(result.id).not.toBeNull();
    // O replay criou um novo XHR; dispara a conclusão dele.
    const replayXhr = instances[before]!;
    replayXhr.respond(200, '{"token":"t2"}', "content-type: application/json");

    const replayed = lastRecord(fake);
    expect(replayed.id).toBe(result.id);
    expect(replayed.replayOf).toBe(originalId);
    expect(replayed.method).toBe("POST");
    expect(replayed.url).toBe("https://api.app.com/login");
    expect(replayed.requestHeaders.Authorization).toBe("Bearer original");
  });

  it("replay current-session usa a Authorization mais recente do mesmo origin", () => {
    const { fake, instances } = setupTracked();
    const Ctor = newCtor();

    const login = new Ctor();
    login.open("POST", "https://api.app.com/login");
    login.setRequestHeader("Authorization", "Bearer old");
    login.send("{}");
    login.respond(200, "{}", "");
    const loginId = lastRecord(fake).id;

    // Request posterior ao mesmo origin com token novo → vira a sessão fresca.
    const me = new Ctor();
    me.open("GET", "https://api.app.com/me");
    me.setRequestHeader("Authorization", "Bearer fresh");
    me.send();
    me.respond(200, "{}", "");

    const before = instances.length;
    fake.invoke("replay", { id: loginId, mode: "current-session" });
    instances[before]!.respond(200, "{}", "");

    expect(lastRecord(fake).requestHeaders.Authorization).toBe("Bearer fresh");
  });

  it("replay aplica overrides de body e query", () => {
    const { fake, instances } = setupTracked();
    const Ctor = newCtor();
    const xhr = new Ctor();
    xhr.open("GET", "https://api.app.com/products?page=1");
    xhr.send();
    xhr.respond(200, "[]", "");
    const id = lastRecord(fake).id;

    const before = instances.length;
    fake.invoke("replay", {
      id,
      mode: "original",
      overrides: { query: "page=2", body: '{"x":1}' },
    });
    instances[before]!.respond(200, "[]", "");

    const replayed = lastRecord(fake);
    expect(replayed.url).toBe("https://api.app.com/products?page=2");
    expect(replayed.query).toBe("page=2");
    expect(replayed.requestBody?.text).toBe('{"x":1}');
  });

  it("replay remove headers capturados quando solicitado", () => {
    const { fake, instances } = setupTracked();
    const Ctor = newCtor();
    const xhr = new Ctor();
    xhr.open("GET", "https://api.app.com/profile");
    xhr.setRequestHeader("Authorization", "Bearer old");
    xhr.setRequestHeader("X-Client", "NativeScope");
    xhr.send();
    xhr.respond(200, "{}", "");
    const id = lastRecord(fake).id;

    const before = instances.length;
    fake.invoke("replay", {
      id,
      mode: "original",
      overrides: { removedHeaders: ["authorization"] },
    });
    instances[before]!.respond(200, "{}", "");

    expect(lastRecord(fake).requestHeaders.Authorization).toBeUndefined();
    expect(lastRecord(fake).requestHeaders["X-Client"]).toBe("NativeScope");
  });

  it("replay de id inexistente → { id: null }, sem nova request", () => {
    const { fake } = setupTracked();
    const before = fake.events.length;
    const result = fake.invoke("replay", { id: "ghost", mode: "original" }) as { id: string | null };
    expect(result.id).toBeNull();
    expect(fake.events.length).toBe(before);
  });
});

// -------------------------------------------------------------- wrap de fetch
// O Expo (SDK 52+) troca o global.fetch por uma implementação NATIVA que NÃO
// passa por XMLHttpRequest — então o módulo também envolve o fetch. Estes testes
// blindam esse caminho e a de-duplicação (insideFetch) do caso whatwg.

interface FakeResponse {
  status: number;
  statusText: string;
  ok: boolean;
  headers: { forEach(cb: (value: string, key: string) => void): void };
  clone(): { text(): Promise<string> };
  text(): Promise<string>;
}

function fakeResponse(status: number, body: string, headers: Record<string, string>): FakeResponse {
  const entries = Object.entries(headers);
  return {
    status,
    statusText: status === 200 ? "OK" : "",
    ok: status >= 200 && status < 300,
    headers: {
      forEach(cb) {
        for (const [key, value] of entries) cb(value, key);
      },
    },
    clone: () => ({ text: () => Promise.resolve(body) }),
    text: () => Promise.resolve(body),
  };
}

/** Drena microtasks — a captura de fetch é async (Promise.then + clone().text()). */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe("network module — wrap de fetch (Expo nativo / whatwg)", () => {
  const originalXHR = (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
  const originalFetch = (globalThis as { fetch?: unknown }).fetch;
  let cleanup: (() => void) | null = null;

  afterEach(() => {
    // Restaura o fetch e cancela o timer de re-wrap (evita vazar entre testes).
    cleanup?.();
    cleanup = null;
    (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = originalXHR;
    (globalThis as { fetch?: unknown }).fetch = originalFetch;
  });

  function setup(fetchImpl: (input: unknown, init?: unknown) => unknown): FakeRuntime {
    class XHR extends FakeXHR {}
    (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = XHR;
    (globalThis as { fetch?: unknown }).fetch = fetchImpl;
    const fake = fakeRuntime();
    cleanup = installNetworkModule(fake.runtime);
    return fake;
  }

  function currentFetch(): (input: unknown, init?: unknown) => Promise<FakeResponse> {
    return (globalThis as unknown as { fetch: (i: unknown, x?: unknown) => Promise<FakeResponse> })
      .fetch;
  }

  it("envolve o global.fetch e captura request + response", async () => {
    const fake = setup(() =>
      Promise.resolve(fakeResponse(200, '{"ok":true}', { "content-type": "application/json" })),
    );
    const res = await currentFetch()("https://api.app.com/users?page=1", {
      method: "POST",
      headers: { Authorization: "Bearer tok" },
      body: '{"q":1}',
    });
    // O corpo do app continua legível — lemos um clone, não o original.
    expect(await res.text()).toBe('{"ok":true}');
    await flush();

    expect(fake.events).toHaveLength(1);
    const record = fake.events[0]!.data as NetworkRequest;
    expect(record.method).toBe("POST");
    expect(record.origin).toBe("https://api.app.com");
    expect(record.path).toBe("/users");
    expect(record.query).toBe("page=1");
    expect(record.status).toBe(200);
    expect(record.ok).toBe(true);
    expect(record.requestHeaders.Authorization).toBe("Bearer tok");
    expect(record.requestBody?.text).toBe('{"q":1}');
    expect(record.responseBody?.text).toBe('{"ok":true}');
    expect(record.responseBody?.kind).toBe("json");
  });

  it("rejeição do fetch vira ok:false + error", async () => {
    const fake = setup(() => Promise.reject(new Error("Network request failed")));
    await currentFetch()("https://api.app.com/down").catch(() => {});
    await flush();

    expect(fake.events).toHaveLength(1);
    const record = fake.events[0]!.data as NetworkRequest;
    expect(record.status).toBeNull();
    expect(record.ok).toBe(false);
    expect(record.error).toBe("Network request failed");
  });

  it("não conta em dobro quando o fetch usa um XHR interno (whatwg)", async () => {
    // Simula o whatwg-fetch: ao rodar, cria e dispara um XHR SINCRONAMENTE — que
    // o patch de XHR também veria se o guard insideFetch não o suprimisse.
    const fake = setup((input) => {
      const Ctor = (globalThis as unknown as { XMLHttpRequest: new () => FakeXHR }).XMLHttpRequest;
      const xhr = new Ctor();
      xhr.open("GET", String(input));
      xhr.send();
      xhr.respond(200, "{}", "content-type: application/json");
      return Promise.resolve(fakeResponse(200, "{}", { "content-type": "application/json" }));
    });
    await currentFetch()("https://api.app.com/thing");
    await flush();

    // Exatamente 1 — o XHR interno foi suprimido (insideFetch).
    expect(fake.events).toHaveLength(1);
    expect((fake.events[0]!.data as NetworkRequest).url).toBe("https://api.app.com/thing");
  });

  it("respeita ignoreUrls também no caminho de fetch", async () => {
    const fake = setup(() => Promise.resolve(fakeResponse(200, "{}", {})));
    await currentFetch()("http://localhost:8081/symbolicate");
    await flush();
    expect(fake.events).toHaveLength(0);
  });
});
