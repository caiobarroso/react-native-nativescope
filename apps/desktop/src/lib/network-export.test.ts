import { describe, expect, it } from "vitest";
import type { NetworkRequest } from "@rnsi/protocol";
import { exportRequest } from "./network-export.ts";

function req(p: Partial<NetworkRequest> & { id: string }): NetworkRequest {
  return {
    id: p.id,
    method: p.method ?? "GET",
    url: p.url ?? "https://api.app.com/products?page=1",
    origin: "https://api.app.com",
    path: p.path ?? "/products",
    query: p.query ?? "page=1",
    status: p.status ?? 200,
    statusText: null,
    ok: true,
    error: null,
    startedAt: 0,
    endedAt: 100,
    duration: 100,
    requestSize: 0,
    responseSize: 0,
    requestHeaders: p.requestHeaders ?? { Accept: "application/json" },
    responseHeaders: {},
    requestBody: p.requestBody ?? null,
    responseBody: p.responseBody ?? null,
  };
}

const post = req({
  id: "1",
  method: "POST",
  url: "https://api.app.com/login",
  path: "/login",
  query: null,
  requestHeaders: { "Content-Type": "application/json" },
  requestBody: { text: '{"email":"a@b.c"}', size: 17, truncated: false },
  responseBody: { text: '{"token":"t","user":{"id":7}}', size: 29, truncated: false },
});

describe("exportRequest", () => {
  it("cURL: método, url, headers e body", () => {
    const out = exportRequest(post, "curl");
    expect(out).toContain("curl -X POST 'https://api.app.com/login'");
    expect(out).toContain("-H 'Content-Type: application/json'");
    expect(out).toContain(`--data '{"email":"a@b.c"}'`);
  });

  it("Fetch: fetch(url, { method, headers, body })", () => {
    const out = exportRequest(post, "fetch");
    expect(out).toContain('await fetch("https://api.app.com/login"');
    expect(out).toContain('method: "POST"');
    expect(out).toContain('"Content-Type": "application/json"');
    expect(out).toContain("body:");
  });

  it("Axios: método minúsculo e data como objeto quando o body é JSON", () => {
    const out = exportRequest(post, "axios");
    expect(out).toContain("await axios({");
    expect(out).toContain('method: "post"');
    expect(out).toContain('url: "https://api.app.com/login"');
    expect(out).toContain("data: {");
    expect(out).toContain('"email": "a@b.c"');
  });

  it("JSON: objeto com request e response parseados", () => {
    const out = exportRequest(post, "json");
    const parsed = JSON.parse(out) as {
      method: string;
      requestBody: { email: string };
      response: { body: { token: string } };
    };
    expect(parsed.method).toBe("POST");
    expect(parsed.requestBody.email).toBe("a@b.c");
    expect(parsed.response.body.token).toBe("t");
  });

  it("TypeScript: interface derivada do response body", () => {
    const out = exportRequest(post, "typescript");
    expect(out).toContain("export interface Login");
    expect(out).toContain("token: string;");
    expect(out).toContain("user:");
  });

  it("TypeScript sem JSON no response → comentário", () => {
    const out = exportRequest(req({ id: "2" }), "typescript");
    expect(out).toContain("// No JSON response body");
  });
});
