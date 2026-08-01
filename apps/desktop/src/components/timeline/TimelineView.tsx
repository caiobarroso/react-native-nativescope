import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { LogEntry } from "@rnsi/protocol";
import {
  Check,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  ExternalLink,
  Flag,
  Globe,
  PlayCircle,
  ScrollText,
} from "lucide-react";
import { useStudio } from "../../lib/store.ts";
import { useLogs } from "../../lib/logs-store.ts";
import { useNetwork } from "../../lib/network-store.ts";
import { openInStorage } from "../../lib/studio-client.ts";
import { useTimeline } from "../../lib/timeline-store.ts";
import {
  TIMELINE_SOURCES,
  EVENT_COUNT_OPTIONS,
  WINDOW_OPTIONS,
  buildTimeline,
  eventCountLabel,
  isAnchorRow,
  type TimelineAnchor,
  type TimelineRow,
  type TimelineSource,
} from "../../lib/timeline-select.ts";
import { formatDuration, statusColorClass } from "../network/format.ts";
import { formatLogClock, levelBadgeClass, levelLabel, levelTextClass } from "../logs/format.ts";
import { TimelineAnchors } from "./TimelineAnchors.tsx";
import { TimelineStory } from "./TimelineStory.tsx";

const ROW_HEIGHT = 34;
const EXPANDED_ROW_HEIGHT = 88;
const SECTION_HEIGHT = 30;
const CONTEXT_ROW_LIMIT = 3;

type TimelineDisplayItem =
  | {
      kind: "section";
      id: string;
      label: string;
      count: number;
      side: "before" | "after";
      expanded: boolean;
      hiddenCount: number;
    }
  | { kind: "event"; id: string; row: TimelineRow; isAnchor: boolean }
  | { kind: "anchor"; id: string; anchor: TimelineAnchor };

const SOURCE_LABEL: Record<TimelineSource, string> = {
  logs: "Logs",
  network: "Network",
  storage: "Storage",
};

/**
 * Uma cor por trilha, usada no chip E na linha. É o que deixa a lista mesclada
 * legível de relance: você vê a cor, sabe de onde a linha veio, sem ler o
 * ícone. As mesmas cores da animação de "how it works".
 */
const SOURCE_DOT: Record<TimelineSource, string> = {
  logs: "bg-text-subtle",
  network: "bg-accent",
  storage: "bg-created",
};

const TRACK_ICON_COLOR: Record<TimelineRow["kind"], string> = {
  log: "text-text-subtle",
  request: "text-accent",
  storage: "text-created",
};

/**
 * A lente que junta as três fontes num eixo só. Sempre escopada — sem âncora,
 * mostra a tela de âncoras em vez de um firehose.
 */
export function TimelineView() {
  const anchor = useTimeline((s) => s.anchor);
  const windowMs = useTimeline((s) => s.windowMs);
  const windowMode = useTimeline((s) => s.windowMode);
  const eventCount = useTimeline((s) => s.eventCount);
  const sources = useTimeline((s) => s.sources);
  const origin = useTimeline((s) => s.origin);
  const chooseAnother = useTimeline((s) => s.chooseAnother);
  const goBack = useTimeline((s) => s.goBack);
  const setWindowMs = useTimeline((s) => s.setWindowMs);
  const setEventCount = useTimeline((s) => s.setEventCount);
  const toggleSource = useTimeline((s) => s.toggleSource);
  const setActiveModule = useStudio((s) => s.setActiveModule);
  const selectLog = useLogs((s) => s.select);
  const selectRequest = useNetwork((s) => s.select);
  const [showStory, setShowStory] = useState(false);
  const [expandedBefore, setExpandedBefore] = useState(false);
  const [expandedAfter, setExpandedAfter] = useState(false);
  const [expandedRowIds, setExpandedRowIds] = useState<Set<string>>(() => new Set());

  const logs = useLogs((s) => s.entries);
  const requests = useNetwork((s) => s.requests);
  const activity = useStudio((s) => s.activity);

  const parentRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(
    () => buildTimeline({ logs, requests, activity, anchor, windowMs, windowMode, eventCount, sources }),
    [logs, requests, activity, anchor, windowMs, windowMode, eventCount, sources],
  );

  const displayItems = useMemo<TimelineDisplayItem[]>(() => {
    if (anchor === null || rows.length === 0) return [];

    const before = rows.filter((row) => row.ts < anchor.ts);
    const current = rows.filter((row) => row.ts === anchor.ts);
    const after = rows.filter((row) => row.ts > anchor.ts);
    const items: TimelineDisplayItem[] = [];

    const addContext = (
      side: "before" | "after",
      label: string,
      contextRows: TimelineRow[],
      expanded: boolean,
    ) => {
      if (contextRows.length === 0) return;
      const hiddenCount = Math.max(0, contextRows.length - CONTEXT_ROW_LIMIT);
      const visibleRows = expanded
        ? contextRows
        : side === "before"
          ? contextRows.slice(-CONTEXT_ROW_LIMIT)
          : contextRows.slice(0, CONTEXT_ROW_LIMIT);

      if (side === "after") {
        items.push({
          kind: "section",
          id: `${side}-section`,
          label,
          count: contextRows.length,
          side,
          expanded,
          hiddenCount,
        });
      }
      for (const row of visibleRows) {
        items.push({ kind: "event", id: row.id, row, isAnchor: isAnchorRow(row, anchor) });
      }
      if (side === "before") {
        items.push({
          kind: "section",
          id: `${side}-section`,
          label,
          count: contextRows.length,
          side,
          expanded,
          hiddenCount,
        });
      }
    };

    addContext("before", "Before this moment", before, expandedBefore);

    if (current.length === 0) {
      items.push({ kind: "anchor", id: "current-anchor", anchor });
    } else {
      for (const row of current) {
        items.push({ kind: "event", id: row.id, row, isAnchor: isAnchorRow(row, anchor) });
      }
    }

    addContext("after", "After this moment", after, expandedAfter);
    return items;
  }, [anchor, expandedAfter, expandedBefore, rows]);

  const virtualizer = useVirtualizer({
    count: displayItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const item = displayItems[index];
      if (item?.kind === "event") {
        return expandedRowIds.has(item.row.id) ? EXPANDED_ROW_HEIGHT : ROW_HEIGHT;
      }
      return item?.kind === "section" ? SECTION_HEIGHT : ROW_HEIGHT;
    },
    overscan: 16,
  });

  const originLabel = origin?.module === "logs" ? "Logs" : origin?.module === "network" ? "Network" : null;
  const hasOrigin = originLabel !== null;
  const scopeValue = windowMode === "time" ? `time:${windowMs}` : `events:${eventCount}`;
  const anchorDisplayIndex = displayItems.findIndex(
    (item) =>
      (item.kind === "event" && anchor !== null && isAnchorRow(item.row, anchor)) ||
      item.kind === "anchor",
  );

  useEffect(() => {
    if (anchorDisplayIndex < 0 || showStory) return;
    virtualizer.scrollToIndex(anchorDisplayIndex, { align: "center" });
  }, [anchorDisplayIndex, anchor?.id, showStory, virtualizer]);

  useEffect(() => {
    virtualizer.measure();
  }, [expandedRowIds, virtualizer]);

  if (anchor === null) return <TimelineAnchors />;

  if (showStory) {
    return <TimelineExplainer onClose={() => setShowStory(false)} />;
  }

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-surface-sunken px-3 py-2">
        <button
          onClick={hasOrigin ? goBack : chooseAnother}
          title={hasOrigin ? `Return to ${originLabel}` : "Pick another moment"}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border bg-surface-raised px-2 text-[11px] text-text-muted hover:text-text"
        >
          <ArrowLeft size={12} strokeWidth={1.5} />
          {hasOrigin ? `Back to ${originLabel}` : "Change moment"}
        </button>

        {hasOrigin && (
          <button
            onClick={chooseAnother}
            title="Pick another moment without leaving the Timeline"
            className="inline-flex h-7 shrink-0 items-center rounded-md px-2 text-[11px] text-text-subtle hover:bg-surface-hover hover:text-text"
          >
            Change moment
          </button>
        )}

        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="shrink-0 text-[11px] font-semibold text-text">
            Timeline
          </span>
          <span className="truncate text-[11px] text-text-subtle">
            around {anchor.label} · {formatLogClock(anchor.ts)}
          </span>
          {originLabel !== null && (
            <span className="hidden shrink-0 text-[10px] text-text-subtle sm:inline">
              from {originLabel}
            </span>
          )}
        </span>

        <select
          value={scopeValue}
          onChange={(event) => {
            const [mode, value] = event.target.value.split(":");
            if (mode === "events") {
              setEventCount(Number(value));
            } else {
              setWindowMs(Number(value));
            }
          }}
          aria-label="Timeline scope"
          title="Choose a time or event window around the moment"
          className="h-7 shrink-0 rounded-md border border-border bg-surface-raised px-1.5 text-[11px] text-text-muted focus:border-accent focus:outline-none"
        >
          <optgroup label="By time">
            {WINDOW_OPTIONS.map((option) => (
              <option key={`time:${option.ms}`} value={`time:${option.ms}`}>
                {option.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="By events">
            {EVENT_COUNT_OPTIONS.map((option) => (
              <option key={`events:${option.count}`} value={`events:${option.count}`}>
                {eventCountLabel(option, anchor)}
              </option>
            ))}
          </optgroup>
        </select>

        <div className="flex h-7 shrink-0 items-center gap-0.5 rounded-md border border-border bg-surface-raised p-0.5">
          {TIMELINE_SOURCES.map((source) => {
            const active = sources.includes(source);
            return (
              <button
                key={source}
                onClick={() => toggleSource(source)}
                title={active ? `Hide ${SOURCE_LABEL[source]}` : `Show ${SOURCE_LABEL[source]}`}
                className={`inline-flex h-6 items-center gap-1.5 rounded px-1.5 text-[10px] font-semibold ${
                  active ? "bg-accent-wash text-accent" : "text-text-subtle hover:text-text"
                }`}
              >
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${SOURCE_DOT[source]} ${
                    active ? "" : "opacity-40"
                  }`}
                />
                {SOURCE_LABEL[source]}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => setShowStory((current) => !current)}
          aria-expanded={showStory}
          title="What this screen is doing"
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] text-text-subtle hover:bg-surface-hover hover:text-text"
        >
          <PlayCircle size={13} strokeWidth={1.5} />
          How it works
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center">
          <p className="max-w-[320px] text-[12px] text-text-muted">
            Nothing recorded in this window. Widen it, or turn another track back on.
          </p>
        </div>
      ) : (
        <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
            {virtualizer.getVirtualItems().map((item) => (
              <div
                key={item.key}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: item.size,
                  transform: `translateY(${item.start}px)`,
                }}
              >
                {(() => {
                  const displayItem = displayItems[item.index]!;
                  if (displayItem.kind === "section") {
                    return (
                      <TimelineSectionRow
                        label={displayItem.label}
                        count={displayItem.count}
                        side={displayItem.side}
                        expanded={displayItem.expanded}
                        hiddenCount={displayItem.hiddenCount}
                        onToggle={
                          displayItem.side === "before"
                            ? () => setExpandedBefore(!displayItem.expanded)
                            : () => setExpandedAfter(!displayItem.expanded)
                        }
                      />
                    );
                  }
                  if (displayItem.kind === "anchor") {
                    return <TimelineAnchorRow anchor={displayItem.anchor} />;
                  }
                  const row = displayItem.row;
                  const canExpand = isTimelineRowExpandable(row);
                  const onOpen =
                    row.kind === "log"
                      ? () => {
                          selectLog(row.id);
                          setActiveModule("logs");
                        }
                      : row.kind === "request"
                        ? () => {
                            selectRequest(row.id);
                            setActiveModule("network");
                          }
                        : () => openInStorage(row.item);
                  return (
                    <TimelineRowView
                      row={row}
                      anchorTs={anchor.ts}
                      isAnchor={displayItem.isAnchor}
                      expanded={expandedRowIds.has(row.id)}
                      canExpand={canExpand}
                      onOpen={onOpen}
                      onToggle={
                        canExpand
                          ? () =>
                              setExpandedRowIds((current) => {
                                const next = new Set(current);
                                if (next.has(row.id)) {
                                  next.delete(row.id);
                                } else {
                                  next.add(row.id);
                                }
                                return next;
                              })
                          : undefined
                      }
                    />
                  );
                })()}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TimelineExplainer({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-20 flex min-h-0 min-w-0 flex-col bg-surface">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-surface-sunken px-3">
        <PlayCircle size={14} strokeWidth={1.5} className="shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[12px] font-semibold leading-tight text-text">How Timeline works</h2>
          <p className="truncate text-[11px] leading-tight text-text-subtle">
            One moment brings Logs, Network and Storage into one clear story.
          </p>
        </div>
        <button
          onClick={onClose}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border bg-surface-raised px-2 text-[11px] text-text-muted hover:text-text"
        >
          <ArrowLeft size={12} strokeWidth={1.5} />
          Back to timeline
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          className="mx-auto flex min-h-full w-full max-w-[1080px] flex-col justify-center px-6 py-10"
          style={{ justifyContent: "safe center" }}
        >
          <TimelineStory />
        </div>
      </div>
    </div>
  );
}

function TimelineSectionRow({
  label,
  count,
  side,
  expanded,
  hiddenCount,
  onToggle,
}: {
  label: string;
  count: number;
  side: "before" | "after";
  expanded: boolean;
  hiddenCount: number;
  onToggle?: () => void;
}) {
  return (
    <div className="flex h-full items-center gap-2 border-b border-border bg-surface-sunken px-3">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
        {label}
      </span>
      <span className="font-mono text-[10px] tabular-nums text-text-subtle">{count}</span>
      {onToggle && (expanded || hiddenCount > 0) && (
        <button
          onClick={onToggle}
          aria-expanded={expanded}
          className="ml-auto text-[10px] font-medium text-text-muted transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          {expanded
            ? "Collapse"
            : `Show ${hiddenCount} ${side === "before" ? "earlier" : "later"}`}
        </button>
      )}
    </div>
  );
}

function TimelineAnchorRow({ anchor }: { anchor: TimelineAnchor }) {
  return (
    <div className="relative flex h-full w-full items-center gap-2 border-l-4 border-l-accent bg-accent-wash px-3 shadow-[inset_0_0_24px_color-mix(in_srgb,var(--accent)_8%,transparent)] before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-accent after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-accent">
      <span className="w-[74px] shrink-0 font-mono text-[10px] tabular-nums text-text-subtle">
        {formatLogClock(anchor.ts)}
      </span>
      <span className="w-14 shrink-0 text-right font-mono text-[10px] tabular-nums text-accent">now</span>
      <Flag size={13} strokeWidth={2} className="shrink-0 text-accent" aria-hidden />
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-semibold text-text">
        {anchor.label}
      </span>
      <span className="shrink-0 rounded border border-accent/50 bg-accent px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
        You are here
      </span>
    </div>
  );
}

function isTimelineRowExpandable(row: TimelineRow): boolean {
  const value =
    row.kind === "log"
      ? row.entry.message
      : row.kind === "request"
        ? row.request.path
        : row.item.key;
  return value.includes("\n") || value.length > 96;
}

function TimelineRowView({
  row,
  anchorTs,
  isAnchor,
  expanded,
  canExpand,
  onOpen,
  onToggle,
}: {
  row: TimelineRow;
  anchorTs: number;
  isAnchor: boolean;
  expanded: boolean;
  canExpand: boolean;
  onOpen?: () => void;
  onToggle?: () => void;
}) {
  const offset = row.ts - anchorTs;
  const offsetLabel = isAnchor
    ? "now"
    : `${offset >= 0 ? "+" : "−"}${formatDuration(Math.abs(offset))}`;

  return (
    <div
      role={canExpand ? "button" : undefined}
      tabIndex={canExpand ? 0 : undefined}
      aria-current={isAnchor ? "true" : undefined}
      aria-expanded={canExpand ? expanded : undefined}
      title={canExpand ? (expanded ? "Collapse event" : "Expand event") : undefined}
      onClick={canExpand ? onToggle : undefined}
      onKeyDown={(event) => {
        if (!canExpand || onToggle === undefined) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle();
        }
      }}
      className={`relative flex w-full gap-2 border-b px-3 outline-none transition-colors focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent ${
        expanded ? "h-[88px] items-start py-2" : "h-[34px] items-center"
      } ${
        isAnchor
          ? "border-l-4 border-l-accent bg-accent-wash shadow-[inset_0_0_24px_color-mix(in_srgb,var(--accent)_8%,transparent)] before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-accent after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-accent"
          : `border-l-2 border-l-transparent border-border ${canExpand ? "cursor-pointer hover:bg-surface-hover" : ""}`
      }`}
    >
      <span className="w-[74px] shrink-0 font-mono text-[10px] tabular-nums text-text-subtle">
        {formatLogClock(row.ts)}
      </span>
      <span className="w-14 shrink-0 text-right font-mono text-[10px] tabular-nums text-text-subtle">
        {offsetLabel}
      </span>
      <TrackIcon row={row} />
      <span className={`min-w-0 flex-1 ${expanded ? "max-h-[68px] overflow-y-auto" : ""}`}>
        {row.kind === "log" ? (
          <LogCell row={row} expanded={expanded} />
        ) : row.kind === "request" ? (
          <RequestCell row={row} expanded={expanded} />
        ) : (
          <StorageCell row={row} expanded={expanded} />
        )}
      </span>
      {isAnchor && (
        <span className="inline-flex shrink-0 items-center gap-1 rounded border border-accent/50 bg-accent px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
          <Flag size={10} strokeWidth={2} />
          You are here
        </span>
      )}
      <span className={`flex shrink-0 items-center gap-1 ${expanded ? "self-start" : ""}`}>
        {row.kind === "log" && <CopyLogButton entry={row.entry} />}
        {onOpen && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
            onKeyDown={(event) => event.stopPropagation()}
            aria-label={`Open this ${timelineRowLabel(row)} in ${timelineRowDestination(row)}`}
            title={`Open this ${timelineRowLabel(row)} in ${timelineRowDestination(row)}`}
            className="inline-flex h-5 w-5 items-center justify-center rounded text-text-subtle transition-colors hover:bg-surface-hover hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            <ExternalLink size={12} strokeWidth={1.5} aria-hidden />
          </button>
        )}
        {canExpand && expanded ? (
          <ChevronDown
            size={13}
            strokeWidth={1.5}
            className="text-accent"
            aria-hidden
          />
        ) : canExpand ? (
          <ChevronRight
            size={13}
            strokeWidth={1.5}
            className="text-text-subtle"
            aria-hidden
          />
        ) : null}
      </span>
    </div>
  );
}

function timelineRowDestination(row: TimelineRow): string {
  return row.kind === "log"
    ? "Logs"
    : row.kind === "request"
      ? "Network"
      : "Storage";
}

function timelineRowLabel(row: TimelineRow): string {
  return row.kind === "log"
    ? "log"
    : row.kind === "request"
      ? "request"
      : "storage change";
}

function CopyLogButton({ entry }: { entry: LogEntry }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        void navigator.clipboard.writeText(copyableLogText(entry)).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        });
      }}
      onKeyDown={(event) => event.stopPropagation()}
      aria-label={copied ? "Log copied" : "Copy log"}
      title={copied ? "Log copied" : "Copy log"}
      className="inline-flex h-5 w-5 items-center justify-center rounded text-text-subtle transition-colors hover:bg-surface-hover hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
    >
      {copied ? <Check size={12} strokeWidth={2} aria-hidden /> : <Copy size={12} strokeWidth={1.5} aria-hidden />}
    </button>
  );
}

function copyableLogText(entry: LogEntry): string {
  const head = `[${formatLogClock(entry.ts)}] ${levelLabel(entry.level)}${
    entry.namespace !== null ? ` ${entry.namespace}` : ""
  } ${entry.message}`;
  const data = entry.args
    .filter((arg) => arg.json !== null)
    .map((arg) => arg.json)
    .join("\n");
  return [head, data, entry.stack].filter((part): part is string => Boolean(part)).join("\n");
}

function TrackIcon({ row }: { row: TimelineRow }) {
  const color = TRACK_ICON_COLOR[row.kind];
  if (row.kind === "log") {
    return <ScrollText size={12} strokeWidth={1.5} className={`shrink-0 ${color}`} />;
  }
  if (row.kind === "request") {
    return <Globe size={12} strokeWidth={1.5} className={`shrink-0 ${color}`} />;
  }
  return <Database size={12} strokeWidth={1.5} className={`shrink-0 ${color}`} />;
}

function LogCell({
  row,
  expanded,
}: {
  row: Extract<TimelineRow, { kind: "log" }>;
  expanded: boolean;
}) {
  const { entry } = row;
  return (
    <span className={`flex min-w-0 gap-1.5 ${expanded ? "items-start" : "items-center"}`}>
      <span
        className={`inline-flex shrink-0 items-center rounded border px-1 py-0.5 font-mono text-[9px] font-semibold ${levelBadgeClass(
          entry.level,
        )}`}
      >
        {levelLabel(entry.level)}
      </span>
      {entry.namespace !== null && (
        <span className="shrink-0 font-mono text-[10px] font-medium text-accent">
          {entry.namespace}
        </span>
      )}
      <span
        className={`min-w-0 font-mono text-[11px] ${expanded ? "whitespace-pre-wrap break-words" : "truncate"} ${levelTextClass(entry.level)}`}
      >
        {entry.message}
      </span>
    </span>
  );
}

function RequestCell({
  row,
  expanded,
}: {
  row: Extract<TimelineRow, { kind: "request" }>;
  expanded: boolean;
}) {
  const { request } = row;
  return (
    <span className={`flex min-w-0 gap-1.5 ${expanded ? "items-start" : "items-center"}`}>
      <span className="shrink-0 font-mono text-[10px] font-bold text-text-muted">
        {request.method}
      </span>
      <span
        className={`min-w-0 font-mono text-[11px] text-text ${expanded ? "break-all" : "truncate"}`}
      >
        {request.path}
      </span>
      <span
        className={`shrink-0 font-mono text-[10px] font-semibold ${statusColorClass(request)}`}
      >
        {request.status ?? "ERR"}
      </span>
      <span className="shrink-0 font-mono text-[10px] tabular-nums text-text-subtle">
        {formatDuration(request.duration)}
      </span>
    </span>
  );
}

function StorageCell({
  row,
  expanded,
}: {
  row: Extract<TimelineRow, { kind: "storage" }>;
  expanded: boolean;
}) {
  const { item } = row;
  return (
    <span className={`flex min-w-0 gap-1.5 ${expanded ? "items-start" : "items-center"}`}>
      <span className="shrink-0 font-mono text-[10px] font-medium text-text-muted">
        {item.providerLabel}
      </span>
      <span
        className={`min-w-0 font-mono text-[11px] text-text ${expanded ? "break-all" : "truncate"}`}
      >
        {item.key}
      </span>
      <span
        className={`shrink-0 text-[10px] font-medium ${
          item.change === "created"
            ? "text-created"
            : item.change === "removed"
              ? "text-deleted"
              : "text-updated"
        }`}
      >
        {item.change}
      </span>
      {item.coalesced !== undefined && item.coalesced > 1 && (
        <span className="shrink-0 rounded bg-surface-sunken px-1 py-0.5 font-mono text-[9px] tabular-nums text-text-subtle">
          ×{item.coalesced}
        </span>
      )}
    </span>
  );
}
