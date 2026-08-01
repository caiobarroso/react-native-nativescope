import type { LogEntry, LogLevel } from "@rnsi/protocol";
import type { LogsFilters, LogsOrder } from "./logs-store.ts";

/**
 * Derivação pura do módulo de Logs — filtro, fusão do "×N", fronteira do Mark
 * e deltas. Fora do store de propósito (mesmo padrão de `network-select.ts`):
 * é a parte com regra de negócio, e é a que dá para testar sem React.
 */

export const LEVEL_OPTIONS: readonly LogLevel[] = ["error", "warn", "info", "log", "debug"];

export interface MarkState {
  markedSeq: number | null;
  markedAt: number | null;
  showEarlier: boolean;
}

export type LogRow =
  | {
      kind: "entry";
      id: string;
      entry: LogEntry;
      /** Soma dos `repeat` das idênticas consecutivas fundidas nesta linha. */
      repeat: number;
      /** ms desde a linha anterior visível; null na primeira. */
      delta: number | null;
    }
  | {
      kind: "mark";
      id: string;
      at: number | null;
      /** Quantas linhas estão escondidas acima da marca. */
      hiddenCount: number;
    };

export function matchesFilters(entry: LogEntry, filters: LogsFilters): boolean {
  if (filters.levels.length > 0 && !filters.levels.includes(entry.level)) return false;
  if (filters.namespace !== null && entry.namespace !== filters.namespace) return false;

  const query = filters.search.trim().toLowerCase();
  if (query === "") return true;
  if (entry.message.toLowerCase().includes(query)) return true;
  if (entry.namespace !== null && entry.namespace.toLowerCase().includes(query)) return true;
  if (entry.stack !== null && entry.stack.toLowerCase().includes(query)) return true;
  for (const arg of entry.args) {
    if (arg.preview.toLowerCase().includes(query)) return true;
    if (arg.json !== null && arg.json.toLowerCase().includes(query)) return true;
  }
  return false;
}

/**
 * Contagem por nível para o segmented control. Recebe a lista JÁ escopada pela
 * marca e pela busca, mas NÃO pelo filtro de nível — senão o contador de um
 * nível zeraria ao desligá-lo, que é exatamente quando você quer vê-lo.
 */
export function countByLevel(entries: LogEntry[]): Record<LogLevel, number> {
  const counts: Record<LogLevel, number> = { debug: 0, log: 0, info: 0, warn: 0, error: 0 };
  for (const entry of entries) counts[entry.level] += entry.repeat;
  return counts;
}

export function collectNamespaces(entries: LogEntry[]): string[] {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.namespace !== null) seen.add(entry.namespace);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/**
 * true quando as duas linhas são "a mesma coisa de novo" (candidatas ao ×N).
 *
 * Os ARGUMENTOS entram na conta, espelhando o isSameLogLine do device. Sem
 * isso, dois logs com o mesmo texto e dados diferentes viravam UMA linha ×2 —
 * e a segunda entrada, que continua no store, ficava inalcançável pela lista.
 * Antes o acaso salvava: a mensagem carregava o JSON dos argumentos, então
 * dados diferentes davam mensagens diferentes. Só que o preview é capado, e
 * dois objetos que só divergissem depois do corte já colidiam.
 */
function isSameLine(a: LogEntry, b: LogEntry): boolean {
  if (a.level !== b.level || a.message !== b.message) return false;
  if (a.namespace !== b.namespace || a.stack !== b.stack) return false;
  if (a.args.length !== b.args.length) return false;
  for (let i = 0; i < a.args.length; i += 1) {
    if (a.args[i]!.json !== b.args[i]!.json) return false;
    if (a.args[i]!.preview !== b.args[i]!.preview) return false;
  }
  return true;
}

/**
 * Funde idênticas consecutivas. O device já funde dentro de um lote; isto pega
 * a costura ENTRE lotes — sem isso um loop de render vira uma linha nova a cada
 * janela de flush, que é o ruído que a fusão existe para matar.
 */
function mergeRepeats(entries: LogEntry[]): Array<{ entry: LogEntry; repeat: number }> {
  const out: Array<{ entry: LogEntry; repeat: number }> = [];
  for (const entry of entries) {
    const last = out[out.length - 1];
    if (last && isSameLine(last.entry, entry)) {
      last.repeat += entry.repeat;
      continue;
    }
    out.push({ entry, repeat: entry.repeat });
  }
  return out;
}

export function buildLogRows(
  entries: LogEntry[],
  filters: LogsFilters,
  mark: MarkState,
  order: LogsOrder = "asc",
): LogRow[] {
  const matched = entries.filter((entry) => matchesFilters(entry, filters));

  let rows: LogRow[] = [];
  const toRows = (list: LogEntry[]): LogRow[] =>
    mergeRepeats(list).map(({ entry, repeat }) => ({
      kind: "entry" as const,
      id: entry.id,
      entry,
      repeat,
      delta: null,
    }));

  if (mark.markedSeq === null) {
    rows = toRows(matched);
  } else {
    const boundary = mark.markedSeq;
    const earlier = matched.filter((entry) => entry.seq <= boundary);
    const later = matched.filter((entry) => entry.seq > boundary);
    if (mark.showEarlier) rows.push(...toRows(earlier));
    rows.push({
      kind: "mark",
      id: "rnsi-log-mark",
      at: mark.markedAt,
      hiddenCount: mark.showEarlier ? 0 : earlier.length,
    });
    rows.push(...toRows(later));
  }

  // Delta em relação à linha ANTERIOR VISÍVEL, calculado SEMPRE na ordem
  // cronológica — mesmo quando a lista vai ser exibida invertida. É o número
  // que se olha caçando lentidão ("essa linha veio 120ms depois da outra"), e
  // calcular depois da inversão daria valores negativos, sem significado.
  let previousTs: number | null = null;
  for (const row of rows) {
    if (row.kind !== "entry") continue;
    row.delta = previousTs === null ? null : row.entry.ts - previousTs;
    previousTs = row.entry.ts;
  }

  // Inverter no fim leva a régua do Mark junto, e ela cai no lugar certo: o
  // recente fica acima dela e o "earlier" abaixo.
  if (order === "desc") rows.reverse();

  return rows;
}

/** Aplica só a fronteira da marca — base para as contagens do segmented. */
export function scopeToMark(entries: LogEntry[], mark: MarkState): LogEntry[] {
  if (mark.markedSeq === null || mark.showEarlier) return entries;
  const boundary = mark.markedSeq;
  return entries.filter((entry) => entry.seq > boundary);
}

export interface HighlightSegment {
  text: string;
  match: boolean;
}

/** Fatia um texto nos trechos que casam com a busca (case-insensitive). */
export function highlightSegments(text: string, query: string): HighlightSegment[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [{ text, match: false }];

  const segments: HighlightSegment[] = [];
  const haystack = text.toLowerCase();
  let cursor = 0;
  for (;;) {
    const index = haystack.indexOf(needle, cursor);
    if (index === -1) break;
    if (index > cursor) segments.push({ text: text.slice(cursor, index), match: false });
    segments.push({ text: text.slice(index, index + needle.length), match: true });
    cursor = index + needle.length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments.length > 0 ? segments : [{ text, match: false }];
}
