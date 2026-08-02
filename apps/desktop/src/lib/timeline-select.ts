import type { LogEntry, NetworkRequest } from "@rnsi/protocol";
import type { ActivityItem } from "./store.ts";

/**
 * Derivação da Timeline — a lente que mescla logs, requests e escritas de
 * storage num eixo só.
 *
 * Isto NÃO é um módulo: não há código no device, nem protocolo, nem linha de
 * config. É leitura pura de stores que os módulos já preencheram. O precedente
 * direto é `network-storage-link.ts`, que já correlaciona Network com Storage
 * por tempo; aqui a mesma ideia vira três fontes no eixo temporal.
 *
 * A regra que impede virar sopa: a Timeline é SEMPRE escopada por uma âncora.
 * Não existe modo firehose — sem âncora, a tela mostra âncoras para escolher.
 */

export type TimelineSource = "logs" | "network" | "storage";

export const TIMELINE_SOURCES: readonly TimelineSource[] = ["logs", "network", "storage"];

export interface TimelineWindowOption {
  ms: number;
  label: string;
}

export type TimelineWindowMode = "time" | "events";

export interface TimelineEventCountOption {
  count: number;
  label: string;
}

export const WINDOW_OPTIONS: readonly TimelineWindowOption[] = [
  { ms: 5_000, label: "±5s" },
  { ms: 30_000, label: "±30s" },
  { ms: 120_000, label: "±2min" },
];

export const EVENT_COUNT_OPTIONS: readonly TimelineEventCountOption[] = [
  { count: 5, label: "5 before / 5 after" },
  { count: 10, label: "10 before / 10 after" },
  { count: 25, label: "25 before / 25 after" },
];

/**
 * Rótulo honesto para a contagem de eventos.
 *
 * Uma marca não tem "antes" — ela existe para dizer "a partir daqui". O
 * buildTimeline sempre soube disso (filtra `ts >= anchor.ts` e corta em N), mas
 * o seletor continuava prometendo "5 before / 5 after" e entregando 5 no total.
 */
export function eventCountLabel(
  option: TimelineEventCountOption,
  anchor: TimelineAnchor | null,
): string {
  return anchor?.kind === "mark" ? `${option.count} after the mark` : option.label;
}

export const DEFAULT_WINDOW_MS = 30_000;

/**
 * Corte grosso do modo por eventos: nada a mais de 5 min da âncora pode entrar
 * num recorte de até 25 eventos ao redor dela. Existe só para o sort não
 * percorrer o store inteiro a cada render — ver o comentário no buildTimeline.
 */
const EVENTS_MODE_GUARD_MS = 5 * 60_000;

export interface TimelineAnchor {
  id: string;
  /**
   * `mark` é o único com janela só-para-frente (você marca e DEPOIS age). Todos
   * os outros olham para os dois lados, porque a pergunta neles é "o que
   * aconteceu em volta disto" — e a metade que mais importa costuma ser a de
   * trás. `log`/`request` vêm dos botões dentro dos módulos; `error` e
   * `request` também são sugeridos automaticamente na tela de âncoras.
   */
  kind: "mark" | "log" | "error" | "request";
  ts: number;
  label: string;
  detail: string | null;
}

export type TimelineRow =
  | { kind: "log"; id: string; ts: number; entry: LogEntry }
  | { kind: "request"; id: string; ts: number; request: NetworkRequest }
  | { kind: "storage"; id: string; ts: number; item: ActivityItem };

export function isAnchorRow(row: TimelineRow, anchor: TimelineAnchor): boolean {
  if (row.id === anchor.id) return true;
  if ((anchor.kind === "log" || anchor.kind === "error") && anchor.id === `log:${row.id}`) {
    return row.kind === "log";
  }
  if (anchor.kind === "request" && anchor.id === `req:${row.id}`) {
    return row.kind === "request";
  }
  return false;
}

/** Quantas âncoras de cada tipo oferecer na tela de escolha. */
const ANCHOR_LIMIT = 8;

/**
 * Âncoras: os momentos que valem investigar. É o empty state que também é o
 * tutorial — você nunca chega na Timeline sem escopo por acidente.
 */
export function collectAnchors({
  logs,
  requests,
  markedAt,
}: {
  logs: LogEntry[];
  requests: NetworkRequest[];
  markedAt: number | null;
}): TimelineAnchor[] {
  const anchors: TimelineAnchor[] = [];

  if (markedAt !== null) {
    anchors.push({
      id: "mark",
      kind: "mark",
      ts: markedAt,
      label: "Mark",
      detail: "everything you did after dropping the marker",
    });
  }

  const errors = logs.filter((entry) => entry.level === "error");
  for (const entry of errors.slice(-ANCHOR_LIMIT).reverse()) {
    anchors.push({
      id: `log:${entry.id}`,
      kind: "error",
      ts: entry.ts,
      label: entry.message,
      detail: entry.namespace,
    });
  }

  const failed = requests.filter(
    (request) => request.error !== null || (request.status !== null && request.status >= 400),
  );
  for (const request of failed.slice(0, ANCHOR_LIMIT)) {
    anchors.push({
      id: `req:${request.id}`,
      kind: "request",
      ts: request.startedAt,
      label: `${request.method} ${request.path}`,
      detail: request.error ?? (request.status === null ? null : String(request.status)),
    });
  }

  return anchors;
}

/**
 * Janela da âncora.
 *
 * Marca olha para FRENTE ("marquei e agora fiz a ação"); erro e request olham
 * para trás ("o que aconteceu antes disso quebrar"). Usar a mesma janela
 * simétrica nos dois casos desperdiçaria metade da tela.
 */
export function anchorWindow(
  anchor: TimelineAnchor,
  windowMs: number,
): { from: number; to: number } {
  if (anchor.kind === "mark") return { from: anchor.ts, to: anchor.ts + windowMs * 2 };
  return { from: anchor.ts - windowMs, to: anchor.ts + windowMs };
}

export function buildTimeline({
  logs,
  requests,
  activity,
  anchor,
  windowMs,
  windowMode = "time",
  eventCount = EVENT_COUNT_OPTIONS[0]!.count,
  sources,
}: {
  logs: LogEntry[];
  requests: NetworkRequest[];
  activity: ActivityItem[];
  anchor: TimelineAnchor | null;
  windowMs: number;
  windowMode?: TimelineWindowMode;
  eventCount?: number;
  sources: TimelineSource[];
}): TimelineRow[] {
  if (anchor === null) return [];

  const rows: TimelineRow[] = [];

  /**
   * No modo por tempo, a janela é a própria pergunta. No modo por eventos ela
   * não existe — mas empurrar TUDO significava ordenar ~7.200 linhas (5k logs +
   * 2k requests + 200 de storage) a cada render, e a Timeline re-renderiza a
   * cada lote de log, ~8×/s com stream vivo.
   *
   * O corte grosso resolve: quem está a mais de 5 minutos da âncora jamais
   * entra num recorte de N eventos ao redor dela — e mesmo que entrasse, uma
   * "vizinhança" a cinco minutos de distância não é vizinhança nenhuma.
   */
  const { from, to } =
    windowMode === "events"
      ? { from: anchor.ts - EVENTS_MODE_GUARD_MS, to: anchor.ts + EVENTS_MODE_GUARD_MS }
      : anchorWindow(anchor, windowMs);

  const addIfIncluded = (row: TimelineRow): void => {
    if (row.ts >= from && row.ts <= to) rows.push(row);
  };

  if (sources.includes("logs")) {
    for (const entry of logs) {
      addIfIncluded({ kind: "log", id: entry.id, ts: entry.ts, entry });
    }
  }

  if (sources.includes("network")) {
    for (const request of requests) {
      // Ancorado no INÍCIO: é quando o app decidiu chamar, que é o fato causal.
      addIfIncluded({ kind: "request", id: request.id, ts: request.startedAt, request });
    }
  }

  if (sources.includes("storage")) {
    for (const item of activity) {
      // Mudanças feitas pelo Studio não são comportamento do app.
      if (item.source !== "app") continue;
      addIfIncluded({ kind: "storage", id: `activity:${item.id}`, ts: item.timestamp, item });
    }
  }

  rows.sort((a, b) => a.ts - b.ts);

  if (windowMode === "events") {
    if (anchor.kind === "mark") {
      return rows.filter((row) => row.ts >= anchor.ts).slice(0, eventCount);
    }

    const before = rows.filter((row) => row.ts < anchor.ts).slice(-eventCount);
    const current = rows.filter((row) => row.ts === anchor.ts);
    const after = rows.filter((row) => row.ts > anchor.ts).slice(0, eventCount);
    return [...before, ...current, ...after];
  }

  return rows;
}
