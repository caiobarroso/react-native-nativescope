import type { NetworkBody, NetworkRequest } from "@rnsi/protocol";
import { getOperationAST, parse, print } from "graphql";

export type NetworkProtocol = "http" | "graphql";
export type GraphQLOperationType =
  | "query"
  | "mutation"
  | "subscription"
  | "unknown";

export interface GraphQLOperation {
  operationType: GraphQLOperationType;
  operationName: string | null;
  query: string | null;
  formattedQuery: string | null;
  variables: unknown;
  extensions: unknown;
}

export interface GraphQLRequestInfo {
  protocol: "graphql";
  source: "body" | "query";
  operations: GraphQLOperation[];
  primary: GraphQLOperation;
  batched: boolean;
}

export interface GraphQLResponseInfo {
  data: unknown;
  errors: unknown[];
  extensions: unknown;
  hasErrors: boolean;
  batched: boolean;
  raw: unknown;
}

interface GraphQLPayload {
  query?: unknown;
  operationName?: unknown;
  variables?: unknown;
  extensions?: unknown;
}

const requestInfoCache = new WeakMap<
  NetworkRequest,
  GraphQLRequestInfo | null
>();
const responseInfoCache = new WeakMap<
  NetworkRequest,
  GraphQLResponseInfo | null
>();

export function getNetworkProtocol(request: NetworkRequest): NetworkProtocol {
  return getGraphQLRequestInfo(request) ? "graphql" : "http";
}

export function getGraphQLRequestInfo(
  request: NetworkRequest,
): GraphQLRequestInfo | null {
  if (requestInfoCache.has(request)) return requestInfoCache.get(request)!;
  const result = interpretGraphQLRequest(request);
  requestInfoCache.set(request, result);
  return result;
}

function interpretGraphQLRequest(
  request: NetworkRequest,
): GraphQLRequestInfo | null {
  const fromQuery = graphQLPayloadFromQuery(request.query);
  if (fromQuery) {
    const operation = operationFromPayload(fromQuery);
    return {
      protocol: "graphql",
      source: "query",
      operations: [operation],
      primary: operation,
      batched: false,
    };
  }

  const body = request.requestBody;
  if (!body || body.kind === "binary" || body.kind === "form") return null;

  const contentType = body.contentType?.toLowerCase() ?? "";
  if (contentType.includes("application/graphql")) {
    const operation = operationFromPayload({ query: body.text });
    return {
      protocol: "graphql",
      source: "body",
      operations: [operation],
      primary: operation,
      batched: false,
    };
  }

  const parsed = parseJson(body.text);
  if (Array.isArray(parsed)) {
    const payloads = parsed.filter(isGraphQLPayload);
    if (payloads.length === 0 || payloads.length !== parsed.length) return null;
    const operations = payloads.map(operationFromPayload);
    return {
      protocol: "graphql",
      source: "body",
      operations,
      primary: operations[0]!,
      batched: true,
    };
  }

  if (!isGraphQLPayload(parsed)) return null;
  const operation = operationFromPayload(parsed);
  return {
    protocol: "graphql",
    source: "body",
    operations: [operation],
    primary: operation,
    batched: false,
  };
}

export function getGraphQLResponseInfo(
  request: NetworkRequest,
): GraphQLResponseInfo | null {
  if (responseInfoCache.has(request)) return responseInfoCache.get(request)!;
  const result = interpretGraphQLResponse(request);
  responseInfoCache.set(request, result);
  return result;
}

function interpretGraphQLResponse(
  request: NetworkRequest,
): GraphQLResponseInfo | null {
  if (!getGraphQLRequestInfo(request)) return null;
  return getGraphQLResponseInfoFromBody(request.responseBody);
}

export function getGraphQLResponseInfoFromBody(
  body: NetworkBody | null,
): GraphQLResponseInfo | null {
  const parsed = parseBodyJson(body);
  if (parsed === undefined) return null;

  if (Array.isArray(parsed)) {
    const entries = parsed.filter(isRecord);
    const errors = entries.flatMap((entry) =>
      Array.isArray(entry.errors) ? entry.errors : [],
    );
    return {
      data: entries.map((entry) => entry.data),
      errors,
      extensions: entries.map((entry) => entry.extensions),
      hasErrors: errors.length > 0,
      batched: true,
      raw: parsed,
    };
  }

  if (!isRecord(parsed)) return null;
  const errors = Array.isArray(parsed.errors) ? parsed.errors : [];
  return {
    data: parsed.data,
    errors,
    extensions: parsed.extensions,
    hasErrors: errors.length > 0,
    batched: false,
    raw: parsed,
  };
}

export function graphQLOperationLabel(request: NetworkRequest): string {
  const info = getGraphQLRequestInfo(request);
  if (!info) return "";
  if (info.batched) return `${info.operations.length} operations`;
  return info.primary.operationName ?? "Anonymous operation";
}

export function graphQLOperationTypeLabel(request: NetworkRequest): string {
  const info = getGraphQLRequestInfo(request);
  if (!info) return request.method;
  if (info.batched) return "BATCH";
  switch (info.primary.operationType) {
    case "mutation":
      return "MUT";
    case "subscription":
      return "SUB";
    case "query":
      return "QUERY";
    default:
      return "GQL";
  }
}

export function graphQLGroupKey(request: NetworkRequest): string | null {
  const info = getGraphQLRequestInfo(request);
  if (!info) return null;
  const names = info.operations
    .map(
      (operation) =>
        operation.operationName ??
        operation.formattedQuery ??
        operation.query ??
        "anonymous",
    )
    .join("|");
  return `graphql ${request.origin}${request.path} ${names}`;
}

export function graphQLSearchText(request: NetworkRequest): string {
  const info = getGraphQLRequestInfo(request);
  if (!info) return "";
  return info.operations
    .flatMap((operation) => [
      operation.operationType,
      operation.operationName ?? "",
      operation.query ?? "",
      stringifyForSearch(operation.variables),
    ])
    .join(" ")
    .toLowerCase();
}

export function formatGraphQLQuery(query: string): string {
  try {
    return print(parse(query));
  } catch {
    return query;
  }
}

function operationFromPayload(payload: GraphQLPayload): GraphQLOperation {
  const query = typeof payload.query === "string" ? payload.query : null;
  const explicitName =
    typeof payload.operationName === "string" && payload.operationName.length > 0
      ? payload.operationName
      : null;

  let operationType: GraphQLOperationType = "unknown";
  let operationName = explicitName;
  let formattedQuery = query;

  if (query) {
    try {
      const document = parse(query);
      const operation = getOperationAST(document, explicitName);
      operationType = operation?.operation ?? "unknown";
      operationName = explicitName ?? operation?.name?.value ?? null;
      formattedQuery = print(document);
    } catch {
      // Ainda é GraphQL quando o envelope é explícito; a UI mostra o texto cru.
    }
  }

  return {
    operationType,
    operationName,
    query,
    formattedQuery,
    variables: parseMaybeJson(payload.variables),
    extensions: parseMaybeJson(payload.extensions),
  };
}

function graphQLPayloadFromQuery(query: string | null): GraphQLPayload | null {
  if (!query) return null;
  const params = new URLSearchParams(query);
  const document = params.get("query");
  const operationName = params.get("operationName");
  const extensions = params.get("extensions");
  if (!document && !operationName && !hasPersistedQuery(extensions)) return null;
  return {
    query: document,
    operationName,
    variables: params.get("variables"),
    extensions,
  };
}

function isGraphQLPayload(value: unknown): value is GraphQLPayload {
  if (!isRecord(value)) return false;
  if (typeof value.query === "string") return true;
  if (typeof value.operationName === "string") return true;
  return isRecord(value.extensions) && isRecord(value.extensions.persistedQuery);
}

function hasPersistedQuery(value: string | null): boolean {
  const parsed = parseMaybeJson(value);
  return isRecord(parsed) && isRecord(parsed.persistedQuery);
}

function parseBodyJson(body: NetworkBody | null): unknown | undefined {
  if (!body || body.truncated || body.kind === "binary" || body.kind === "form") {
    return undefined;
  }
  return parseJson(body.text);
}

function parseJson(value: string): unknown | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringifyForSearch(value: unknown): string {
  if (value == null) return "";
  try {
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return "";
  }
}
