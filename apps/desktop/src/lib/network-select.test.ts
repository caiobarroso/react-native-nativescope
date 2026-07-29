import { describe, expect, it } from "vitest";
import type { NetworkRequest } from "@rnsi/protocol";
import type { NetworkFilters } from "./network-store.ts";
import { buildDisplayRows, groupKey, matchesFilters, statusClassOf } from "./network-select.ts";

function req(p: Partial<NetworkRequest> & { id: string }): NetworkRequest {
  return {
    id: p.id,
    method: p.method ?? "GET",
    url: p.url ?? "https://api.app.com/x",
    origin: p.origin ?? "https://api.app.com",
    path: p.path ?? "/x",
    query: p.query ?? null,
    status: p.status === undefined ? 200 : p.status,
    statusText: null,
    ok: p.ok ?? true,
    error: p.error ?? null,
    startedAt: p.startedAt ?? 0,
    endedAt: p.endedAt ?? 100,
    duration: p.duration ?? 100,
    requestSize: 0,
    responseSize: p.responseSize ?? 0,
    requestHeaders: p.requestHeaders ?? {},
    responseHeaders: p.responseHeaders ?? {},
    requestBody: p.requestBody ?? null,
    responseBody: p.responseBody ?? null,
  };
}

const NO_FILTERS: NetworkFilters = {
  methods: [],
  statusClasses: [],
  search: "",
  slowerThanMs: null,
  grouped: true,
  protocol: "all",
  graphQLOperation: "all",
};

describe("statusClassOf", () => {
  it("mapeia status para classe", () => {
    expect(statusClassOf(200)).toBe("2xx");
    expect(statusClassOf(301)).toBe("3xx");
    expect(statusClassOf(404)).toBe("4xx");
    expect(statusClassOf(500)).toBe("5xx");
    expect(statusClassOf(null)).toBe("err");
  });
});

describe("groupKey", () => {
  it("ignora a query (agrupa por método+baseURL+path)", () => {
    const a = req({ id: "1", path: "/products", query: "page=1" });
    const b = req({ id: "2", path: "/products", query: "page=2" });
    expect(groupKey(a)).toBe(groupKey(b));
    expect(groupKey(a)).toBe("GET https://api.app.com/products");
  });
});

describe("matchesFilters", () => {
  it("filtra por método", () => {
    const r = req({ id: "1", method: "POST" });
    expect(matchesFilters(r, { ...NO_FILTERS, methods: ["POST"] })).toBe(true);
    expect(matchesFilters(r, { ...NO_FILTERS, methods: ["GET"] })).toBe(false);
  });

  it("filtra por classe de status", () => {
    const r = req({ id: "1", status: 404 });
    expect(matchesFilters(r, { ...NO_FILTERS, statusClasses: ["4xx"] })).toBe(true);
    expect(matchesFilters(r, { ...NO_FILTERS, statusClasses: ["2xx"] })).toBe(false);
  });

  it("filtra por lentidão", () => {
    const r = req({ id: "1", duration: 250 });
    expect(matchesFilters(r, { ...NO_FILTERS, slowerThanMs: 300 })).toBe(false);
    expect(matchesFilters(r, { ...NO_FILTERS, slowerThanMs: 100 })).toBe(true);
  });

  it("busca textual em url, headers e body", () => {
    const r = req({
      id: "1",
      url: "https://api.app.com/users/42",
      requestHeaders: { Authorization: "Bearer secret-token" },
      responseBody: { text: '{"name":"Caio"}', size: 15, truncated: false },
    });
    expect(matchesFilters(r, { ...NO_FILTERS, search: "users/42" })).toBe(true); // url
    expect(matchesFilters(r, { ...NO_FILTERS, search: "secret-token" })).toBe(true); // header value
    expect(matchesFilters(r, { ...NO_FILTERS, search: "caio" })).toBe(true); // body, case-insensitive
    expect(matchesFilters(r, { ...NO_FILTERS, search: "nope" })).toBe(false);
  });

  it("filtra HTTP e GraphQL sem separar as timelines", () => {
    const http = req({
      id: "http",
      method: "POST",
      requestBody: {
        text: '{"username":"ada"}',
        size: 18,
        truncated: false,
        kind: "json",
      },
    });
    const graphQL = req({
      id: "graphql",
      method: "POST",
      path: "/graphql",
      requestBody: {
        text: JSON.stringify({
          query: "mutation SaveUser { saveUser { id } }",
          operationName: "SaveUser",
        }),
        size: 70,
        truncated: false,
        kind: "json",
      },
    });

    expect(
      matchesFilters(http, { ...NO_FILTERS, protocol: "http" }),
    ).toBe(true);
    expect(
      matchesFilters(graphQL, { ...NO_FILTERS, protocol: "http" }),
    ).toBe(false);
    expect(
      matchesFilters(graphQL, {
        ...NO_FILTERS,
        protocol: "graphql",
        graphQLOperation: "mutation",
      }),
    ).toBe(true);
    expect(
      matchesFilters(graphQL, {
        ...NO_FILTERS,
        protocol: "graphql",
        graphQLOperation: "query",
      }),
    ).toBe(false);
  });
});

describe("buildDisplayRows", () => {
  it("modo flat: uma linha por request", () => {
    const requests = [req({ id: "1" }), req({ id: "2" })];
    const rows = buildDisplayRows(requests, { ...NO_FILTERS, grouped: false }, []);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.kind === "request")).toBe(true);
  });

  it("agrupado: grupo de 1 vira linha flat; grupo de N vira header colapsado", () => {
    const requests = [
      req({ id: "a1", path: "/products", query: "page=1" }),
      req({ id: "a2", path: "/products", query: "page=2" }),
      req({ id: "b1", path: "/profile" }),
    ];
    const rows = buildDisplayRows(requests, NO_FILTERS, []);
    // /products (2) vira 1 header; /profile (1) vira 1 request
    expect(rows).toHaveLength(2);
    const group = rows.find((r) => r.kind === "group");
    expect(group?.kind).toBe("group");
    if (group?.kind === "group") {
      expect(group.count).toBe(2);
      expect(group.path).toBe("/products");
      expect(group.expanded).toBe(false);
    }
  });

  it("grupo expandido injeta as linhas filhas indentadas", () => {
    const requests = [
      req({ id: "a1", path: "/products", query: "page=1" }),
      req({ id: "a2", path: "/products", query: "page=2" }),
    ];
    const key = groupKey(requests[0]!);
    const rows = buildDisplayRows(requests, NO_FILTERS, [key]);
    // header + 2 filhos
    expect(rows).toHaveLength(3);
    expect(rows[0]!.kind).toBe("group");
    expect(rows[1]).toMatchObject({ kind: "request", indent: true });
    expect(rows[2]).toMatchObject({ kind: "request", indent: true });
  });

  it("marca hasError quando algum membro do grupo falhou", () => {
    const requests = [
      req({ id: "a1", path: "/orders", status: 200 }),
      req({ id: "a2", path: "/orders", status: 404 }),
    ];
    const rows = buildDisplayRows(requests, NO_FILTERS, []);
    const group = rows[0];
    expect(group?.kind).toBe("group");
    if (group?.kind === "group") expect(group.hasError).toBe(true);
  });

  it("aplica filtros antes de agrupar", () => {
    const requests = [
      req({ id: "a1", path: "/products", status: 200 }),
      req({ id: "a2", path: "/products", status: 500 }),
    ];
    const rows = buildDisplayRows(requests, { ...NO_FILTERS, statusClasses: ["5xx"] }, []);
    // só a de 500 sobra → grupo de 1 → linha flat
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "request" });
  });
});
