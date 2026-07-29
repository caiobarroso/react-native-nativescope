import type { NetworkRequest } from "@rnsi/protocol";
import {
  getGraphQLRequestInfo,
  graphQLOperationLabel,
  graphQLOperationTypeLabel,
} from "../../lib/network-graphql.ts";

/** Bytes legíveis — mesma escala do resto do Studio. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** Duração legível: ms abaixo de 1s, senão segundos. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
}

/** Horário local do início da request — HH:MM:SS em 24h, largura fixa. */
export function formatClock(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "—";
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Classe de cor do status: 2xx verde, 3xx laranja, 4xx/5xx vermelho. */
export function statusColorClass(
  request: Pick<NetworkRequest, "status" | "ok">,
): string {
  const { status } = request;
  if (status === null) return "text-deleted";
  if (status >= 500) return "text-deleted";
  if (status >= 400) return "text-deleted";
  if (status >= 300) return "text-updated";
  if (status >= 200) return "text-created";
  return "text-text-muted";
}

/** Rótulo curto do status para exibir na linha. */
export function statusLabel(
  request: Pick<NetworkRequest, "status" | "error">,
): string {
  if (request.status !== null) return String(request.status);
  return request.error ? "ERR" : "—";
}

/** Reason phrases canônicas dos códigos mais comuns. */
const STATUS_REASON: Record<number, string> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  301: "Moved Permanently",
  302: "Found",
  303: "See Other",
  304: "Not Modified",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

/** Reason phrase canônica do status — evita o `statusText` cru inconsistente do
 *  device (ex.: Android manda "no error" num 200). Cai para o statusText do
 *  device (title-cased) quando o código não está no mapa. */
export function statusReason(
  request: Pick<NetworkRequest, "status" | "statusText">,
): string | null {
  if (request.status === null) return null;
  const canonical = STATUS_REASON[request.status];
  if (canonical) return canonical;
  const raw = request.statusText?.trim();
  if (!raw) return null;
  return raw.replace(/\b\w/g, (char) => char.toUpperCase());
}

/** Cor do método — ajuda a escanear a lista por tipo de operação. */
export function methodColorClass(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
    case "QUERY":
      return "text-created";
    case "POST":
    case "MUT":
    case "MUTATION":
      return "text-accent";
    case "PUT":
    case "PATCH":
      return "text-updated";
    case "DELETE":
      return "text-deleted";
    case "SUB":
    case "SUBSCRIPTION":
    case "BATCH":
      return "text-updated";
    default:
      return "text-text-muted";
  }
}

/** Classe HTTP para filtros/agrupamento futuros. */
export function statusClass(
  status: number | null,
): "2xx" | "3xx" | "4xx" | "5xx" | "err" {
  if (status === null) return "err";
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  if (status >= 300) return "3xx";
  return "2xx";
}

/** Endpoint enxuto para a linha: path (+ query encurtada). */
export function endpointLabel(request: NetworkRequest): string {
  const graphQL = getGraphQLRequestInfo(request);
  if (graphQL) return graphQLOperationLabel(request);
  return request.query ? `${request.path}?${request.query}` : request.path;
}

/** GET/POST para HTTP; QUERY/MUT/BATCH para GraphQL. */
export function requestTypeLabel(request: NetworkRequest): string {
  return getGraphQLRequestInfo(request)
    ? graphQLOperationTypeLabel(request)
    : request.method;
}
