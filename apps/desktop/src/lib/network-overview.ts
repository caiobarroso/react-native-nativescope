import type { NetworkRequest } from "@rnsi/protocol";
import {
  getGraphQLRequestInfo,
  getGraphQLResponseInfo,
  graphQLOperationLabel,
  graphQLOperationTypeLabel,
} from "./network-graphql.ts";

/**
 * Lógica pura do Network Insights (o resumo da sessão).
 *
 * Tudo aqui é função pura, sem React e sem relógio: recebe requests e devolve
 * números prontos pra desenhar. É o que os testes cobrem — a UI só pinta.
 *
 * Duas verdades de medição guiam o arquivo:
 *  1. Métrica agregada só faz sentido POR ENDPOINT. p95 juntando um upload de
 *     2s com um ping de 30ms não significa nada. Por isso o coração é o
 *     agrupamento por rota (`buildEndpointStats`).
 *  2. Agrupar exige NORMALIZAR a rota: `/users/1` e `/users/2` são o MESMO
 *     endpoint. Sem isso, cada id vira uma linha e a tabela não diz nada.
 */

// ---------------------------------------------------------------------------
// Normalização de rota — o coração do agrupamento.
// ---------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Um segmento de path parece um id (e não uma palavra fixa da rota)?
 * Conservador de propósito: só colapsa o que é claramente id, pra nunca fundir
 * `/users` com `/settings`.
 */
function isDynamicSegment(segment: string): boolean {
  if (segment === "") return false; // as barras viram segmentos vazios
  if (/^\d+$/.test(segment)) return true; // 42
  if (UUID_RE.test(segment)) return true; // 6f9e…-uuid canônico
  if (/^[0-9a-f]{12,}$/i.test(segment)) return true; // hash hex longo
  // Token opaco (base62 / ULID / slug com hash): longo e misturando letra+dígito.
  if (segment.length >= 16 && /\d/.test(segment) && /[a-z]/i.test(segment)) {
    return true;
  }
  return false;
}

/**
 * Troca segmentos dinâmicos por `:id`. `/users/12/posts/9a3f…` → `/users/:id/posts/:id`.
 * A query já não entra (usamos `path`). Barra final some, menos na raiz.
 */
export function normalizeRoute(path: string): string {
  if (!path || path === "/") return "/";
  const trimmed = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  const normalized = trimmed
    .split("/")
    .map((segment) => (isDynamicSegment(segment) ? ":id" : segment))
    .join("/");
  return normalized === "" ? "/" : normalized;
}

/**
 * O maior prefixo ESTÁTICO de uma rota normalizada — usado pra levar o filtro da
 * lista até este endpoint (a busca da lista casa substring de url, e `:id` não
 * casaria). `/users/:id/posts` → `/users/`.
 */
export function staticPrefix(route: string): string {
  const cut = route.indexOf("/:");
  if (cut === -1) return route;
  const prefix = route.slice(0, cut);
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

// ---------------------------------------------------------------------------
// Estatística.
// ---------------------------------------------------------------------------

/** Uma request falhou? Sem resposta ou status ≥ 400 (igual ao resto do módulo). */
export function isFailure(request: Pick<NetworkRequest, "status">): boolean {
  return (
    request.status === null ||
    request.status >= 400 ||
    ("requestBody" in request &&
      getGraphQLResponseInfo(request as NetworkRequest)?.hasErrors === true)
  );
}

/**
 * Percentil p (0–100) de uma lista JÁ ordenada asc. Interpolação linear entre os
 * dois ranks vizinhos — o padrão de bibliotecas de estatística. Lista vazia → 0.
 */
export function percentile(sortedAsc: number[], p: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  if (n === 1) return sortedAsc[0]!;
  const rank = (Math.min(100, Math.max(0, p)) / 100) * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedAsc[lo]!;
  const frac = rank - lo;
  return sortedAsc[lo]! * (1 - frac) + sortedAsc[hi]! * frac;
}

/** Quantos pontos de tendência guardar por endpoint (mantém o sparkline leve). */
const TREND_POINTS = 40;

export interface EndpointStat {
  /** Chave de agrupamento: método + origin + rota normalizada. */
  key: string;
  method: string;
  /** Rota normalizada, para exibir (ex.: `/users/:id`). */
  route: string;
  origin: string;
  count: number;
  errorCount: number;
  /** 0..1. */
  errorRate: number;
  p50: number;
  p95: number;
  slowest: number;
  /** Baixado + enviado, somado no grupo. */
  totalBytes: number;
  /** endedAt mais recente do grupo (para ordenar por recência). */
  lastAt: number;
  /** Durações em ordem cronológica (antigo→novo), para o sparkline. */
  trend: number[];
  /** Ids do grupo, mais recentes primeiro (para o drill-in e abrir na lista). */
  requestIds: string[];
}

function endpointKey(request: NetworkRequest): string {
  const graphQL = getGraphQLRequestInfo(request);
  if (graphQL) {
    return `graphql ${request.origin}${request.path} ${graphQLOperationLabel(request)}`;
  }
  return `${request.method} ${request.origin} ${normalizeRoute(request.path)}`;
}

/**
 * Agrupa as requests por endpoint normalizado e calcula as métricas de cada um.
 * Espera a lista mais-recentes-primeiro (como o store entrega). Não ordena o
 * resultado — quem chama escolhe a ordenação com `sortEndpoints`.
 */
export function buildEndpointStats(requests: NetworkRequest[]): EndpointStat[] {
  interface Acc {
    key: string;
    method: string;
    route: string;
    origin: string;
    durations: number[];
    errorCount: number;
    totalBytes: number;
    lastAt: number;
    requestIds: string[];
  }

  const groups = new Map<string, Acc>();
  for (const request of requests) {
    const key = endpointKey(request);
    const graphQL = getGraphQLRequestInfo(request);
    let acc = groups.get(key);
    if (!acc) {
      acc = {
        key,
        method: graphQL ? graphQLOperationTypeLabel(request) : request.method,
        route: graphQL
          ? graphQLOperationLabel(request)
          : normalizeRoute(request.path),
        origin: request.origin,
        durations: [],
        errorCount: 0,
        totalBytes: 0,
        lastAt: 0,
        requestIds: [],
      };
      groups.set(key, acc);
    }
    acc.durations.push(request.duration);
    if (isFailure(request)) acc.errorCount += 1;
    acc.totalBytes += request.requestSize + request.responseSize;
    if (request.endedAt > acc.lastAt) acc.lastAt = request.endedAt;
    acc.requestIds.push(request.id);
  }

  const stats: EndpointStat[] = [];
  for (const acc of groups.values()) {
    const sorted = [...acc.durations].sort((a, b) => a - b);
    const count = sorted.length;
    // `durations` foi preenchido do mais novo pro mais velho; invertemos para o
    // sparkline crescer da esquerda (antigo) para a direita (novo).
    const trend = [...acc.durations].reverse().slice(-TREND_POINTS);
    stats.push({
      key: acc.key,
      method: acc.method,
      route: acc.route,
      origin: acc.origin,
      count,
      errorCount: acc.errorCount,
      errorRate: count === 0 ? 0 : acc.errorCount / count,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      slowest: count === 0 ? 0 : sorted[count - 1]!,
      totalBytes: acc.totalBytes,
      lastAt: acc.lastAt,
      trend,
      requestIds: acc.requestIds,
    });
  }
  return stats;
}

export type EndpointSort = "calls" | "errors" | "p95" | "bytes" | "recent";

/** Ordena os endpoints por uma coluna (sempre desc — o "pior" no topo). */
export function sortEndpoints(
  stats: EndpointStat[],
  sort: EndpointSort,
): EndpointStat[] {
  const by: Record<EndpointSort, (s: EndpointStat) => number> = {
    calls: (s) => s.count,
    errors: (s) => s.errorRate,
    p95: (s) => s.p95,
    bytes: (s) => s.totalBytes,
    recent: (s) => s.lastAt,
  };
  const pick = by[sort];
  // Desempate estável por contagem, depois recência — evita linhas pulando.
  return [...stats].sort(
    (a, b) => pick(b) - pick(a) || b.count - a.count || b.lastAt - a.lastAt,
  );
}

/**
 * O "vilão": o endpoint mais chamado (over-fetch / N+1 / re-render disparando o
 * mesmo GET). Em empate, o com maior taxa de erro. `null` se não há dados.
 */
export function topEndpointByCalls(stats: EndpointStat[]): EndpointStat | null {
  let top: EndpointStat | null = null;
  for (const stat of stats) {
    if (
      !top ||
      stat.count > top.count ||
      (stat.count === top.count && stat.errorRate > top.errorRate)
    ) {
      top = stat;
    }
  }
  return top;
}

// ---------------------------------------------------------------------------
// Timeline (todos os requests no tempo, separados por ok/erro).
// ---------------------------------------------------------------------------

export interface TimelineBucket {
  /** epoch ms do início do balde. */
  start: number;
  ok: number;
  error: number;
  total: number;
}

export interface Timeline {
  buckets: TimelineBucket[];
  bucketMs: number;
  start: number;
  end: number;
}

/**
 * Distribui as requests em baldes de tempo iguais entre a primeira e a última.
 * Sobrevive à crítica da "sopa": é temporal, não mistura métricas incomparáveis
 * — só mostra volume e falha ao longo do tempo. `bucketCount` é o alvo (o número
 * real de baldes pode ser menor quando a janela é curta).
 */
export function buildTimeline(
  requests: NetworkRequest[],
  bucketCount = 40,
): Timeline {
  const starts = requests
    .map((r) => r.startedAt)
    .filter((t) => Number.isFinite(t));
  if (starts.length === 0) {
    return { buckets: [], bucketMs: 0, start: 0, end: 0 };
  }

  const start = Math.min(...starts);
  const end = Math.max(...starts);
  const span = Math.max(1, end - start);
  const target = Math.max(1, bucketCount);
  const bucketMs = Math.max(1, Math.ceil(span / target));
  const n = Math.min(target, Math.floor(span / bucketMs) + 1);

  const buckets: TimelineBucket[] = Array.from({ length: n }, (_, i) => ({
    start: start + i * bucketMs,
    ok: 0,
    error: 0,
    total: 0,
  }));

  for (const request of requests) {
    if (!Number.isFinite(request.startedAt)) continue;
    const raw = Math.floor((request.startedAt - start) / bucketMs);
    const index = Math.min(n - 1, Math.max(0, raw));
    const bucket = buckets[index]!;
    if (isFailure(request)) bucket.error += 1;
    else bucket.ok += 1;
    bucket.total += 1;
  }

  return { buckets, bucketMs, start, end };
}

// ---------------------------------------------------------------------------
// KPIs (os poucos números do topo).
// ---------------------------------------------------------------------------

export interface OverviewKpis {
  total: number;
  errorCount: number;
  /** 0..1. */
  errorRate: number;
  /** p95 geral — resumo grosso; o número honesto por rota está na tabela. */
  p95: number;
  bytesDown: number;
  bytesUp: number;
  totalBytes: number;
  /** Duração da janela capturada (ms). */
  spanMs: number;
}

export function buildOverviewKpis(requests: NetworkRequest[]): OverviewKpis {
  const total = requests.length;
  if (total === 0) {
    return {
      total: 0,
      errorCount: 0,
      errorRate: 0,
      p95: 0,
      bytesDown: 0,
      bytesUp: 0,
      totalBytes: 0,
      spanMs: 0,
    };
  }

  let errorCount = 0;
  let bytesDown = 0;
  let bytesUp = 0;
  let minStart = Infinity;
  let maxEnd = -Infinity;
  const durations: number[] = [];

  for (const request of requests) {
    if (isFailure(request)) errorCount += 1;
    bytesDown += request.responseSize;
    bytesUp += request.requestSize;
    durations.push(request.duration);
    if (request.startedAt < minStart) minStart = request.startedAt;
    if (request.endedAt > maxEnd) maxEnd = request.endedAt;
  }

  durations.sort((a, b) => a - b);
  return {
    total,
    errorCount,
    errorRate: errorCount / total,
    p95: percentile(durations, 95),
    bytesDown,
    bytesUp,
    totalBytes: bytesDown + bytesUp,
    spanMs: Number.isFinite(minStart) && Number.isFinite(maxEnd)
      ? Math.max(0, maxEnd - minStart)
      : 0,
  };
}
