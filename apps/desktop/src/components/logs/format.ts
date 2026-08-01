import type { LogEntry, LogLevel } from "@rnsi/protocol";

/**
 * Formatação do módulo de Logs. Separado do `network/format.ts` de propósito:
 * log precisa de MILISSEGUNDO no relógio (duas linhas no mesmo segundo é o
 * caso comum, não a exceção), enquanto request se resolve em segundos.
 */

/** HH:MM:SS.mmm local, largura fixa. */
export function formatLogClock(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "—";
  const date = new Date(ts);
  const pad = (n: number, width = 2): string => String(n).padStart(width, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(
    date.getMilliseconds(),
    3,
  )}`;
}

/** Tempo desde a linha anterior — o número que se olha caçando lentidão. */
export function formatDelta(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `+${Math.round(ms)}ms`;
  if (ms < 60_000) return `+${(ms / 1000).toFixed(1)}s`;
  return `+${Math.round(ms / 60_000)}m`;
}

/** Relógio absoluto completo para o detalhe. */
export function formatAbsolute(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "—";
  return new Date(ts).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * Cor da mensagem por nível. Só error e warn ganham cor — hierarquia vem de
 * destacar a exceção, não de pintar tudo. Info/log/debug se diferenciam por
 * peso de texto, que é o que mantém a lista legível quando ela é longa.
 */
export function levelTextClass(level: LogLevel): string {
  switch (level) {
    case "error":
      return "text-deleted";
    case "warn":
      return "text-updated";
    case "info":
      return "text-text";
    case "log":
      return "text-text-muted";
    case "debug":
      return "text-text-subtle";
  }
}

/** Chip do nível na lista. */
export function levelBadgeClass(level: LogLevel): string {
  switch (level) {
    case "error":
      return "border-deleted/50 bg-deleted-wash text-deleted";
    // Não existe `updated-wash` nos tokens; `accent-wash` é o fundo quente da
    // mesma família (--updated e --accent são o mesmo coral no tema claro).
    case "warn":
      return "border-updated/50 bg-accent-wash text-updated";
    case "info":
      return "border-border bg-surface-sunken text-text-muted";
    case "log":
      return "border-border bg-surface-sunken text-text-subtle";
    case "debug":
      return "border-transparent bg-transparent text-text-subtle";
  }
}

export function levelLabel(level: LogLevel): string {
  return level.toUpperCase();
}

/** Rótulo da origem, só quando ela não é o `console` trivial. */
export function sourceLabel(source: LogEntry["source"]): string | null {
  if (source === "exception") return "uncaught";
  if (source === "rejection") return "unhandled rejection";
  return null;
}
