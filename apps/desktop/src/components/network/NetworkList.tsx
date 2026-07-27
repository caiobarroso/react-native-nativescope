import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight, Radio } from "lucide-react";
import { useNetwork } from "../../lib/network-store.ts";
import { buildDisplayRows, type DisplayRow } from "../../lib/network-select.ts";
import {
  endpointLabel,
  formatBytes,
  formatDuration,
  methodColorClass,
  statusColorClass,
  statusLabel,
} from "./format.ts";

const ROW_HEIGHT = 40;

export function NetworkList() {
  const requests = useNetwork((s) => s.requests);
  const filters = useNetwork((s) => s.filters);
  const expandedGroups = useNetwork((s) => s.expandedGroups);
  const selectedId = useNetwork((s) => s.selectedId);
  const select = useNetwork((s) => s.select);
  const toggleGroup = useNetwork((s) => s.toggleGroup);
  const parentRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(
    () => buildDisplayRows(requests, filters, expandedGroups),
    [requests, filters, expandedGroups],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 14,
  });

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-surface-sunken px-3 text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
        <span className="w-12 shrink-0">Method</span>
        <span className="min-w-0 flex-1">Endpoint</span>
        <span className="w-10 shrink-0 text-right">Status</span>
        <span className="w-16 shrink-0 text-right">Time</span>
        <span className="w-16 shrink-0 text-right">Size</span>
      </div>

      {requests.length === 0 ? (
        <EmptyState
          icon
          title="Waiting for requests…"
          subtitle="Every fetch / XHR the app makes shows up here, newest first."
        />
      ) : rows.length === 0 ? (
        <EmptyState title="No requests match the filters." />
      ) : (
        <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
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
                    height: ROW_HEIGHT,
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  {row.kind === "group" ? (
                    <GroupRow row={row} onToggle={() => toggleGroup(row.key)} />
                  ) : (
                    <RequestRow
                      row={row}
                      active={row.request.id === selectedId}
                      onSelect={() => select(row.request.id)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function GroupRow({
  row,
  onToggle,
}: {
  row: Extract<DisplayRow, { kind: "group" }>;
  onToggle: () => void;
}) {
  const Chevron = row.expanded ? ChevronDown : ChevronRight;
  return (
    <button
      onClick={onToggle}
      className="flex h-full w-full items-center gap-2 border-b border-border/60 bg-surface-sunken px-3 text-left text-[12px] hover:bg-surface-hover"
    >
      <Chevron size={13} strokeWidth={1.5} className="shrink-0 text-text-subtle" />
      <span className={`w-12 shrink-0 font-mono text-[10px] font-bold uppercase ${methodColorClass(row.method)}`}>
        {row.method}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono font-semibold text-text" title={`${row.origin}${row.path}`}>
        {row.path}
      </span>
      {row.hasError && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-deleted" title="Contains failed requests" />}
      <span className="shrink-0 rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-text-muted">
        {row.count}
      </span>
    </button>
  );
}

function RequestRow({
  row,
  active,
  onSelect,
}: {
  row: Extract<DisplayRow, { kind: "request" }>;
  active: boolean;
  onSelect: () => void;
}) {
  const request = row.request;
  return (
    <button
      onClick={onSelect}
      className={`flex h-full w-full items-center gap-2 border-b border-border/60 pr-3 text-left text-[12px] ${
        row.indent ? "pl-8" : "pl-3"
      } ${active ? "bg-accent-wash" : "hover:bg-surface-hover"}`}
    >
      <span className={`w-12 shrink-0 font-mono text-[10px] font-bold uppercase ${methodColorClass(request.method)}`}>
        {request.method}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-text" title={endpointLabel(request)}>
        {endpointLabel(request)}
      </span>
      <span className={`w-10 shrink-0 text-right font-mono text-[11px] font-semibold ${statusColorClass(request)}`}>
        {statusLabel(request)}
      </span>
      <span className="w-16 shrink-0 text-right font-mono text-[11px] text-text-muted">
        {formatDuration(request.duration)}
      </span>
      <span className="w-16 shrink-0 text-right font-mono text-[11px] text-text-subtle">
        {formatBytes(request.responseSize)}
      </span>
    </button>
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
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      {icon && <Radio size={22} strokeWidth={1.5} className="text-text-subtle" />}
      <p className="text-[13px] text-text-muted">{title}</p>
      {subtitle && <p className="max-w-[260px] text-[11px] text-text-subtle">{subtitle}</p>}
    </div>
  );
}
