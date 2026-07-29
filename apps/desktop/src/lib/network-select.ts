import type { NetworkRequest } from "@rnsi/protocol";
import type { NetworkFilters, StatusClass } from "./network-store.ts";
import {
  getGraphQLRequestInfo,
  getGraphQLResponseInfo,
  getNetworkProtocol,
  graphQLGroupKey,
  graphQLSearchText,
} from "./network-graphql.ts";

/** Classe HTTP de um status (err = sem resposta). */
export function statusClassOf(status: number | null): StatusClass {
  if (status === null) return "err";
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  if (status >= 300) return "3xx";
  return "2xx";
}

/** Chave de agrupamento: método + baseURL + path (query ignorada, de propósito). */
export function groupKey(request: NetworkRequest): string {
  return (
    graphQLGroupKey(request) ??
    `${request.method} ${request.origin}${request.path}`
  );
}

function headersInclude(headers: Record<string, string>, needle: string): boolean {
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase().includes(needle) || value.toLowerCase().includes(needle)) return true;
  }
  return false;
}

/** Um request passa nos filtros ativos? Buscas vazias = sem restrição. */
export function matchesFilters(request: NetworkRequest, filters: NetworkFilters): boolean {
  const protocol = getNetworkProtocol(request);
  if (filters.protocol !== "all" && protocol !== filters.protocol) return false;
  if (protocol === "graphql" && filters.graphQLOperation !== "all") {
    const info = getGraphQLRequestInfo(request);
    if (
      !info?.operations.some(
        (operation) =>
          operation.operationType === filters.graphQLOperation,
      )
    ) {
      return false;
    }
  }
  if (filters.methods.length > 0 && !filters.methods.includes(request.method)) return false;
  if (
    filters.statusClasses.length > 0 &&
    !filters.statusClasses.includes(
      getGraphQLResponseInfo(request)?.hasErrors
        ? "err"
        : statusClassOf(request.status),
    )
  ) {
    return false;
  }
  if (filters.slowerThanMs !== null && request.duration < filters.slowerThanMs) return false;

  const search = filters.search.trim().toLowerCase();
  if (search) {
    const inUrl = request.url.toLowerCase().includes(search);
    const inHeaders =
      headersInclude(request.requestHeaders, search) ||
      headersInclude(request.responseHeaders, search);
    const inReqBody = request.requestBody?.text.toLowerCase().includes(search) ?? false;
    const inResBody = request.responseBody?.text.toLowerCase().includes(search) ?? false;
    const inGraphQL = graphQLSearchText(request).includes(search);
    if (!inUrl && !inHeaders && !inReqBody && !inResBody && !inGraphQL) return false;
  }
  return true;
}

export type DisplayRow =
  | {
      kind: "group";
      key: string;
      method: string;
      origin: string;
      path: string;
      count: number;
      /** Request mais recente do grupo — dá cor/status ao cabeçalho. */
      sample: NetworkRequest;
      /** true se algum request do grupo falhou (status ≥ 400 ou sem resposta). */
      hasError: boolean;
      expanded: boolean;
    }
  | { kind: "request"; request: NetworkRequest; indent: boolean };

function isError(request: NetworkRequest): boolean {
  return (
    request.status === null ||
    request.status >= 400 ||
    getGraphQLResponseInfo(request)?.hasErrors === true
  );
}

/**
 * Constrói as linhas exibíveis a partir dos requests (já mais-recentes-primeiro),
 * aplicando filtros e, se ligado, agrupando por método+baseURL+path. Grupos com
 * um único request aparecem como linha normal (sem cromo de grupo).
 */
export function buildDisplayRows(
  requests: NetworkRequest[],
  filters: NetworkFilters,
  expandedGroups: string[],
): DisplayRow[] {
  const filtered = requests.filter((r) => matchesFilters(r, filters));

  if (!filters.grouped) {
    return filtered.map((request) => ({ kind: "request", request, indent: false }));
  }

  // Ordem de inserção = por recência do membro mais novo (iteramos do mais novo).
  const groups = new Map<string, NetworkRequest[]>();
  for (const request of filtered) {
    const key = groupKey(request);
    const list = groups.get(key);
    if (list) list.push(request);
    else groups.set(key, [request]);
  }

  const expanded = new Set(expandedGroups);
  const rows: DisplayRow[] = [];
  for (const [key, list] of groups) {
    const sample = list[0]!;
    if (list.length === 1) {
      rows.push({ kind: "request", request: sample, indent: false });
      continue;
    }
    const isExpanded = expanded.has(key);
    rows.push({
      kind: "group",
      key,
      method: sample.method,
      origin: sample.origin,
      path: sample.path,
      count: list.length,
      sample,
      hasError: list.some(isError),
      expanded: isExpanded,
    });
    if (isExpanded) {
      for (const request of list) rows.push({ kind: "request", request, indent: true });
    }
  }
  return rows;
}

/** Presets do filtro de lentidão (ms). */
export const SLOW_PRESETS: Array<{ label: string; ms: number }> = [
  { label: "100ms", ms: 100 },
  { label: "300ms", ms: 300 },
  { label: "500ms", ms: 500 },
  { label: "1s", ms: 1000 },
];

export const METHOD_OPTIONS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export const STATUS_CLASS_OPTIONS: StatusClass[] = [
  "2xx",
  "3xx",
  "4xx",
  "5xx",
  "err",
];
