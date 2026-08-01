import { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, Flag, ScrollText } from "lucide-react";
import { useLogs } from "../../lib/logs-store.ts";
import { buildLogRows, highlightSegments, type LogRow } from "../../lib/logs-select.ts";
import { useTimeline } from "../../lib/timeline-store.ts";
import { useStickToBottom } from "../../lib/use-stick-to-bottom.ts";
import { useArrowNav, type ArrowNavItem } from "../../lib/use-arrow-nav.ts";
import { formatDelta, formatLogClock, levelBadgeClass, levelLabel, levelTextClass } from "./format.ts";

const ROW_HEIGHT = 34;
const MARK_ROW_HEIGHT = 36;

/** Lista de logs: cronológica, virtualizada e ancorada no fim. */
export function LogsList() {
  const entries = useLogs((s) => s.entries);
  const filters = useLogs((s) => s.filters);
  const selectedId = useLogs((s) => s.selectedId);
  const select = useLogs((s) => s.select);
  const markedSeq = useLogs((s) => s.markedSeq);
  const markedAt = useLogs((s) => s.markedAt);
  const showEarlier = useLogs((s) => s.showEarlier);
  const setShowEarlier = useLogs((s) => s.setShowEarlier);
  const clearMark = useLogs((s) => s.clearMark);
  const order = useLogs((s) => s.order);
  const toggleOrder = useLogs((s) => s.toggleOrder);
  const openTimeline = useTimeline((s) => s.open);

  const parentRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(
    () => buildLogRows(entries, filters, { markedSeq, markedAt, showEarlier }, order),
    [entries, filters, markedSeq, markedAt, showEarlier, order],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (rows[index]?.kind === "mark" ? MARK_ROW_HEIGHT : ROW_HEIGHT),
    overscan: 16,
  });

  const { pendingCount, scrollToEnd } = useStickToBottom({
    scrollRef: parentRef,
    count: rows.length,
    scrollToIndex: (index) =>
      virtualizer.scrollToIndex(index, { align: order === "asc" ? "end" : "start" }),
    edge: order === "asc" ? "end" : "start",
  });

  const navItems = useMemo<ArrowNavItem[]>(
    () => rows.flatMap((row, index) => (row.kind === "entry" ? [{ id: row.id, index }] : [])),
    [rows],
  );
  useArrowNav({
    enabled: true,
    items: navItems,
    selectedId,
    onSelect: select,
    scrollToIndex: (index) => virtualizer.scrollToIndex(index),
  });

  const selectionContext = `${selectedId ?? ""}|${order}|${filters.search}|${filters.namespace ?? ""}|${filters.levels.join(",")}`;
  const lastScrolledSelection = useRef<string | null>(null);

  useEffect(() => {
    if (selectedId === null) {
      lastScrolledSelection.current = null;
      return;
    }

    const selectedIndex = rows.findIndex((row) => row.kind === "entry" && row.id === selectedId);
    if (selectedIndex < 0 || lastScrolledSelection.current === selectionContext) return;

    lastScrolledSelection.current = selectionContext;
    const frame = requestAnimationFrame(() => {
      virtualizer.scrollToIndex(selectedIndex, { align: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [rows, selectedId, selectionContext, virtualizer]);

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-b-border bg-surface-sunken px-3 text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
        <button
          onClick={toggleOrder}
          title={
            order === "asc"
              ? "Oldest first (terminal order) — click for newest first"
              : "Newest first — click for oldest first"
          }
          className="flex w-[74px] shrink-0 items-center gap-1 text-left uppercase tracking-wide hover:text-text"
        >
          Time
          {order === "asc" ? (
            <ArrowDown size={10} strokeWidth={2.5} />
          ) : (
            <ArrowUp size={10} strokeWidth={2.5} />
          )}
        </button>
        <span className="w-11 shrink-0">Level</span>
        <span className="min-w-0 flex-1">Message</span>
        <span className="w-14 shrink-0 text-right">Δ</span>
      </div>

      <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <EmptyState
            icon
            title="Waiting for logs…"
            subtitle="Every console call, uncaught error and unhandled rejection shows up here, oldest first."
          />
        ) : rows.length === 0 ? (
          <EmptyState title="No logs match the filters." />
        ) : (
          <div
            style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index]!;
              return (
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
                  {row.kind === "mark" ? (
                    <MarkRow
                      row={row}
                      showEarlier={showEarlier}
                      onToggleEarlier={() => setShowEarlier(!showEarlier)}
                      onClearMark={clearMark}
                      onOpenTimeline={() =>
                        openTimeline({
                          id: "mark",
                          kind: "mark",
                          ts: row.at ?? Date.now(),
                          label: "Mark",
                          detail: "everything you did after dropping the marker",
                        }, { module: "logs" })
                      }
                    />
                  ) : (
                    <EntryRow
                      row={row}
                      query={filters.search}
                      active={row.id === selectedId}
                      onSelect={() => select(row.id)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {pendingCount > 0 && (
        <button
          onClick={scrollToEnd}
          className={`absolute left-1/2 inline-flex h-7 -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-surface-raised px-3 text-[11px] font-medium text-text shadow-sm hover:border-accent hover:text-accent ${
            order === "asc" ? "bottom-3" : "top-11"
          }`}
        >
          {order === "asc" ? (
            <ArrowDown size={12} strokeWidth={2} />
          ) : (
            <ArrowUp size={12} strokeWidth={2} />
          )}
          {pendingCount > 999 ? "999+" : pendingCount} new
        </button>
      )}
    </div>
  );
}

function EntryRow({
  row,
  query,
  active,
  onSelect,
}: {
  row: Extract<LogRow, { kind: "entry" }>;
  query: string;
  active: boolean;
  onSelect: () => void;
}) {
  const { entry, repeat, delta } = row;
  return (
    <button
      onClick={onSelect}
      className={`flex h-full w-full items-center gap-2 border-l-2 px-3 text-left transition-colors ${
        active
          ? "border-l-accent bg-accent-wash"
          : "border-l-transparent hover:bg-surface-hover"
      }`}
    >
      <span className="w-[74px] shrink-0 font-mono text-[10px] tabular-nums text-text-subtle">
        {formatLogClock(entry.ts)}
      </span>

      <span
        className={`inline-flex w-11 shrink-0 items-center justify-center rounded border px-1 py-0.5 font-mono text-[9px] font-semibold ${levelBadgeClass(
          entry.level,
        )}`}
      >
        {levelLabel(entry.level)}
      </span>

      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        {entry.namespace !== null && (
          <span className="shrink-0 font-mono text-[10px] font-medium text-accent">
            {entry.namespace}
          </span>
        )}
        <span
          className={`min-w-0 flex-1 truncate font-mono text-[11px] ${levelTextClass(entry.level)}`}
        >
          <Highlighted text={entry.message} query={query} />
        </span>
        {repeat > 1 && (
          <span className="shrink-0 rounded bg-surface-sunken px-1 py-0.5 font-mono text-[9px] font-semibold tabular-nums text-text-subtle">
            ×{repeat > 999 ? "999+" : repeat}
          </span>
        )}
      </span>

      <span className="w-14 shrink-0 text-right font-mono text-[10px] tabular-nums text-text-subtle">
        {formatDelta(delta)}
      </span>
    </button>
  );
}

function Highlighted({ text, query }: { text: string; query: string }) {
  const segments = useMemo(() => highlightSegments(text, query), [text, query]);
  if (segments.length === 1 && !segments[0]!.match) return <>{text}</>;
  return (
    <>
      {segments.map((segment, index) =>
        segment.match ? (
          <mark key={index} className="rounded-[2px] bg-accent-wash px-0.5 text-accent">
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

function MarkRow({
  row,
  showEarlier,
  onToggleEarlier,
  onClearMark,
  onOpenTimeline,
}: {
  row: Extract<LogRow, { kind: "mark" }>;
  showEarlier: boolean;
  onToggleEarlier: () => void;
  onClearMark: () => void;
  onOpenTimeline: () => void;
}) {
  return (
    <div className="flex h-full w-full items-center gap-2 border-y border-dashed border-accent/40 bg-accent-wash/40 px-3">
      <Flag size={11} strokeWidth={2} className="shrink-0 text-accent" />
      <span className="shrink-0 font-mono text-[10px] font-semibold uppercase tracking-wide text-accent">
        Mark
      </span>
      <span className="shrink-0 font-mono text-[10px] tabular-nums text-text-subtle">
        {row.at === null ? "" : formatLogClock(row.at)}
      </span>
      <span className="min-w-0 flex-1" />
      {row.hiddenCount > 0 && (
        <span className="shrink-0 text-[10px] text-text-subtle">
          {row.hiddenCount} earlier hidden
        </span>
      )}
      <button
        onClick={onOpenTimeline}
        title="See logs, requests and storage writes since this mark"
        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-accent hover:bg-accent-wash"
      >
        Timeline
      </button>
      <button
        onClick={onToggleEarlier}
        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-surface-hover hover:text-text"
      >
        {showEarlier ? "Hide earlier" : "Show earlier"}
      </button>
      <button
        onClick={onClearMark}
        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-text-subtle hover:bg-surface-hover hover:text-text"
      >
        Remove
      </button>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon?: boolean;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center px-6 py-12 text-center">
      <div className="flex max-w-[300px] flex-col items-center gap-2">
        {icon && <ScrollText size={22} strokeWidth={1.5} className="text-text-subtle" />}
        <p className="text-[13px] font-medium text-text-muted">{title}</p>
        {subtitle && <p className="text-[11px] leading-relaxed text-text-subtle">{subtitle}</p>}
      </div>
    </div>
  );
}
