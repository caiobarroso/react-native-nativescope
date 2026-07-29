import { describe, expect, it } from "vitest";
import type { NetworkRequest } from "@rnsi/protocol";
import {
  formatGraphQLQuery,
  getGraphQLRequestInfo,
  getGraphQLResponseInfo,
  graphQLOperationLabel,
  graphQLOperationTypeLabel,
} from "./network-graphql.ts";

function request(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: "request-1",
    method: "POST",
    url: "https://api.test/graphql",
    origin: "https://api.test",
    path: "/graphql",
    query: "",
    status: 200,
    statusText: "OK",
    ok: true,
    error: null,
    startedAt: 1,
    endedAt: 2,
    duration: 1,
    requestSize: 100,
    responseSize: 100,
    requestHeaders: { "content-type": "application/json" },
    responseHeaders: { "content-type": "application/json" },
    requestBody: {
      text: JSON.stringify({
        query: "query GetUser($id: ID!) { user(id: $id) { id name } }",
        operationName: "GetUser",
        variables: { id: "42" },
      }),
      size: 100,
      truncated: false,
      contentType: "application/json",
      kind: "json",
    },
    responseBody: {
      text: JSON.stringify({ data: { user: { id: "42", name: "Ada" } } }),
      size: 100,
      truncated: false,
      contentType: "application/json",
      kind: "json",
    },
    replayOf: null,
    ...overrides,
  };
}

describe("network GraphQL interpretation", () => {
  it("detects a POST envelope and extracts its operation", () => {
    const value = request();
    const info = getGraphQLRequestInfo(value);

    expect(info?.source).toBe("body");
    expect(info?.primary.operationType).toBe("query");
    expect(info?.primary.operationName).toBe("GetUser");
    expect(info?.primary.variables).toEqual({ id: "42" });
    expect(graphQLOperationTypeLabel(value)).toBe("QUERY");
    expect(graphQLOperationLabel(value)).toBe("GetUser");
  });

  it("detects GraphQL GET requests", () => {
    const value = request({
      method: "GET",
      query: new URLSearchParams({
        query: "query Countries { countries { code name } }",
        operationName: "Countries",
        variables: JSON.stringify({ limit: 10 }),
      }).toString(),
      requestBody: null,
    });

    const info = getGraphQLRequestInfo(value);
    expect(info?.source).toBe("query");
    expect(info?.primary.operationName).toBe("Countries");
    expect(info?.primary.variables).toEqual({ limit: 10 });
  });

  it("supports persisted and batched operations", () => {
    const persisted = request({
      requestBody: {
        text: JSON.stringify({
          operationName: "PersistedViewer",
          variables: { id: 1 },
          extensions: {
            persistedQuery: { version: 1, sha256Hash: "abc" },
          },
        }),
        size: 80,
        truncated: false,
        contentType: "application/json",
        kind: "json",
      },
    });
    expect(getGraphQLRequestInfo(persisted)?.primary.operationName).toBe(
      "PersistedViewer",
    );

    const batched = request({
      requestBody: {
        text: JSON.stringify([
          { query: "query A { a }", operationName: "A" },
          { query: "mutation B { b }", operationName: "B" },
        ]),
        size: 90,
        truncated: false,
        contentType: "application/json",
        kind: "json",
      },
    });
    expect(getGraphQLRequestInfo(batched)?.operations).toHaveLength(2);
    expect(graphQLOperationTypeLabel(batched)).toBe("BATCH");
  });

  it("does not classify ordinary JSON requests as GraphQL", () => {
    const value = request({
      path: "/auth/login",
      requestBody: {
        text: JSON.stringify({ username: "ada", password: "secret" }),
        size: 50,
        truncated: false,
        contentType: "application/json",
        kind: "json",
      },
    });
    expect(getGraphQLRequestInfo(value)).toBeNull();
  });

  it("recognizes GraphQL errors even when HTTP is 200", () => {
    const value = request({
      responseBody: {
        text: JSON.stringify({
          data: { user: null },
          errors: [{ message: "User not found", path: ["user"] }],
        }),
        size: 80,
        truncated: false,
        contentType: "application/json",
        kind: "json",
      },
    });
    const response = getGraphQLResponseInfo(value);
    expect(response?.hasErrors).toBe(true);
    expect(response?.errors).toHaveLength(1);
  });

  it("formats valid documents and preserves invalid text", () => {
    expect(formatGraphQLQuery("query A{a b}")).toContain("query A");
    expect(formatGraphQLQuery("query {")).toBe("query {");
  });
});
