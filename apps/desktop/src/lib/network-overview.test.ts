import { describe, expect, it } from "vitest";
import type { NetworkRequest } from "@rnsi/protocol";
import {
  buildEndpointStats,
  buildOverviewKpis,
  buildTimeline,
  isFailure,
  normalizeRoute,
  percentile,
  sortEndpoints,
  staticPrefix,
  topEndpointByCalls,
} from "./network-overview.ts";

/** Fábrica de request com defaults — os testes só passam o que importa. */
function req(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: Math.random().toString(36).slice(2),
    method: "GET",
    url: "https://api.example.com/thing",
    origin: "https://api.example.com",
    path: "/thing",
    query: null,
    status: 200,
    statusText: "OK",
    ok: true,
    error: null,
    startedAt: 1000,
    endedAt: 1100,
    duration: 100,
    requestSize: 0,
    responseSize: 0,
    requestHeaders: {},
    responseHeaders: {},
    requestBody: null,
    responseBody: null,
    ...overrides,
  };
}

describe("normalizeRoute", () => {
  it("colapsa segmento numérico", () => {
    expect(normalizeRoute("/users/42")).toBe("/users/:id");
  });

  it("colapsa uuid e hash hex longo", () => {
    expect(normalizeRoute("/u/6f9e4b2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b")).toBe("/u/:id");
    expect(normalizeRoute("/blob/4f9a3b2c1d0e9f8a7b6c")).toBe("/blob/:id");
  });

  it("colapsa token opaco longo com letra+dígito", () => {
    expect(normalizeRoute("/s/01HXQK7Z9M4N2P8R3T6V0")).toBe("/s/:id");
  });

  it("NÃO colapsa palavras fixas nem nomes de arquivo curtos", () => {
    expect(normalizeRoute("/users/settings")).toBe("/users/settings");
    expect(normalizeRoute("/avatar/abc123.png")).toBe("/avatar/abc123.png");
  });

  it("junta vários ids na mesma rota", () => {
    expect(normalizeRoute("/users/12/posts/9a3f4b2c1d0e")).toBe("/users/:id/posts/:id");
  });

  it("trata raiz e barra final", () => {
    expect(normalizeRoute("/")).toBe("/");
    expect(normalizeRoute("/users/42/")).toBe("/users/:id");
  });
});

describe("staticPrefix", () => {
  it("corta no primeiro parâmetro", () => {
    expect(staticPrefix("/users/:id/posts")).toBe("/users/");
    expect(staticPrefix("/users/:id")).toBe("/users/");
  });
  it("rota sem parâmetro volta inteira", () => {
    expect(staticPrefix("/health")).toBe("/health");
  });
});

describe("percentile", () => {
  const data = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  it("lista vazia → 0", () => {
    expect(percentile([], 95)).toBe(0);
  });
  it("um elemento → ele mesmo", () => {
    expect(percentile([42], 95)).toBe(42);
  });
  it("p50 e p95 por interpolação", () => {
    expect(percentile(data, 50)).toBeCloseTo(55, 5);
    expect(percentile(data, 95)).toBeCloseTo(95.5, 5);
  });
  it("extremos batem com min/max", () => {
    expect(percentile(data, 0)).toBe(10);
    expect(percentile(data, 100)).toBe(100);
  });
});

describe("isFailure", () => {
  it("sem resposta ou ≥400 é falha; 2xx/3xx não", () => {
    expect(isFailure({ status: null })).toBe(true);
    expect(isFailure({ status: 404 })).toBe(true);
    expect(isFailure({ status: 500 })).toBe(true);
    expect(isFailure({ status: 200 })).toBe(false);
    expect(isFailure({ status: 304 })).toBe(false);
  });
});

describe("buildEndpointStats", () => {
  it("agrupa por rota normalizada, não por id cru", () => {
    const stats = buildEndpointStats([
      req({ path: "/users/1", duration: 100 }),
      req({ path: "/users/2", duration: 300 }),
      req({ path: "/users/3", duration: 200 }),
    ]);
    expect(stats).toHaveLength(1);
    expect(stats[0]!.route).toBe("/users/:id");
    expect(stats[0]!.count).toBe(3);
    expect(stats[0]!.p50).toBeCloseTo(200, 5);
  });

  it("método diferente é endpoint diferente", () => {
    const stats = buildEndpointStats([
      req({ method: "GET", path: "/users/1" }),
      req({ method: "POST", path: "/users/2" }),
    ]);
    expect(stats).toHaveLength(2);
  });

  it("conta erros e taxa de erro", () => {
    const stats = buildEndpointStats([
      req({ path: "/a/1", status: 200 }),
      req({ path: "/a/2", status: 500 }),
      req({ path: "/a/3", status: null, ok: false, error: "boom" }),
      req({ path: "/a/4", status: 200 }),
    ]);
    expect(stats[0]!.count).toBe(4);
    expect(stats[0]!.errorCount).toBe(2);
    expect(stats[0]!.errorRate).toBeCloseTo(0.5, 5);
  });

  it("soma bytes (enviado + baixado)", () => {
    const stats = buildEndpointStats([
      req({ path: "/a/1", requestSize: 10, responseSize: 90 }),
      req({ path: "/a/2", requestSize: 5, responseSize: 95 }),
    ]);
    expect(stats[0]!.totalBytes).toBe(200);
  });

  it("trend fica em ordem cronológica (antigo→novo)", () => {
    // store entrega mais-novo-primeiro; a mais nova tem duration 3.
    const stats = buildEndpointStats([
      req({ path: "/a/1", duration: 3, endedAt: 3000 }),
      req({ path: "/a/2", duration: 2, endedAt: 2000 }),
      req({ path: "/a/3", duration: 1, endedAt: 1000 }),
    ]);
    expect(stats[0]!.trend).toEqual([1, 2, 3]);
    expect(stats[0]!.lastAt).toBe(3000);
  });
});

describe("sortEndpoints", () => {
  const stats = buildEndpointStats([
    req({ path: "/slow/1", duration: 900 }),
    req({ path: "/busy/1" }),
    req({ path: "/busy/2" }),
    req({ path: "/busy/3" }),
  ]);
  it("por chamadas coloca o mais chamado no topo", () => {
    expect(sortEndpoints(stats, "calls")[0]!.route).toBe("/busy/:id");
  });
  it("por p95 coloca o mais lento no topo", () => {
    expect(sortEndpoints(stats, "p95")[0]!.route).toBe("/slow/:id");
  });
});

describe("topEndpointByCalls", () => {
  it("pega o mais chamado; null quando vazio", () => {
    expect(topEndpointByCalls([])).toBeNull();
    const stats = buildEndpointStats([
      req({ path: "/x/1" }),
      req({ path: "/y/1" }),
      req({ path: "/y/2" }),
    ]);
    expect(topEndpointByCalls(stats)!.route).toBe("/y/:id");
  });
});

describe("buildTimeline", () => {
  it("lista vazia → sem baldes", () => {
    const t = buildTimeline([]);
    expect(t.buckets).toHaveLength(0);
  });

  it("separa ok de erro nos baldes", () => {
    const t = buildTimeline(
      [
        req({ startedAt: 0, status: 200 }),
        req({ startedAt: 0, status: 500 }),
        req({ startedAt: 0, status: null, ok: false }),
      ],
      40,
    );
    const totalOk = t.buckets.reduce((sum, b) => sum + b.ok, 0);
    const totalErr = t.buckets.reduce((sum, b) => sum + b.error, 0);
    expect(totalOk).toBe(1);
    expect(totalErr).toBe(2);
  });

  it("distribui ao longo da janela e nunca estoura o alvo de baldes", () => {
    const requests = Array.from({ length: 100 }, (_, i) =>
      req({ startedAt: i * 1000 }),
    );
    const t = buildTimeline(requests, 20);
    expect(t.buckets.length).toBeLessThanOrEqual(20);
    const total = t.buckets.reduce((sum, b) => sum + b.total, 0);
    expect(total).toBe(100);
  });
});

describe("buildOverviewKpis", () => {
  it("zera com lista vazia", () => {
    const k = buildOverviewKpis([]);
    expect(k.total).toBe(0);
    expect(k.errorRate).toBe(0);
    expect(k.totalBytes).toBe(0);
  });

  it("agrega total, erro, bytes e janela", () => {
    const k = buildOverviewKpis([
      req({ status: 200, requestSize: 10, responseSize: 90, startedAt: 1000, endedAt: 1100 }),
      req({ status: 500, requestSize: 0, responseSize: 50, startedAt: 2000, endedAt: 2500 }),
    ]);
    expect(k.total).toBe(2);
    expect(k.errorCount).toBe(1);
    expect(k.errorRate).toBeCloseTo(0.5, 5);
    expect(k.bytesDown).toBe(140);
    expect(k.bytesUp).toBe(10);
    expect(k.totalBytes).toBe(150);
    expect(k.spanMs).toBe(1500);
  });
});
