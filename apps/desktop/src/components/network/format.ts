import type { NetworkRequest } from "@rnsi/protocol";

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

/** Classe de cor do status: 2xx verde, 3xx laranja, 4xx/5xx vermelho. */
export function statusColorClass(request: Pick<NetworkRequest, "status" | "ok">): string {
  const { status } = request;
  if (status === null) return "text-deleted";
  if (status >= 500) return "text-deleted";
  if (status >= 400) return "text-deleted";
  if (status >= 300) return "text-updated";
  if (status >= 200) return "text-created";
  return "text-text-muted";
}

/** Rótulo curto do status para exibir na linha. */
export function statusLabel(request: Pick<NetworkRequest, "status" | "error">): string {
  if (request.status !== null) return String(request.status);
  return request.error ? "ERR" : "—";
}

/** Cor do método — ajuda a escanear a lista por tipo de operação. */
export function methodColorClass(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return "text-created";
    case "POST":
      return "text-accent";
    case "PUT":
    case "PATCH":
      return "text-updated";
    case "DELETE":
      return "text-deleted";
    default:
      return "text-text-muted";
  }
}

/** Classe HTTP para filtros/agrupamento futuros. */
export function statusClass(status: number | null): "2xx" | "3xx" | "4xx" | "5xx" | "err" {
  if (status === null) return "err";
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  if (status >= 300) return "3xx";
  return "2xx";
}

/** Endpoint enxuto para a linha: path (+ query encurtada). */
export function endpointLabel(request: Pick<NetworkRequest, "path" | "query">): string {
  return request.query ? `${request.path}?${request.query}` : request.path;
}
