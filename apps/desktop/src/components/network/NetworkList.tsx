import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronDown,
  ChevronRight,
  Database,
  Eye,
  EyeOff,
  Flag,
  Radio,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useNetwork } from "../../lib/network-store.ts";
import { useStorageAttribution } from "../../lib/use-storage-impact.ts";
import { buildDisplayRows, type DisplayRow } from "../../lib/network-select.ts";
import { ConfirmDialog } from "../ConfirmDialog.tsx";
import {
  getGraphQLRequestInfo,
  getGraphQLResponseInfo,
} from "../../lib/network-graphql.ts";
import {
  endpointLabel,
  formatClock,
  formatDuration,
  methodColorClass,
  statusColorClass,
  statusLabel,
  requestTypeLabel,
} from "./format.ts";

const ROW_HEIGHT = 40;
const SESSION_ROW_HEIGHT = 36;

type NetworkListRow =
  | DisplayRow
  | {
      kind: "session";
      startedAt: number;
      currentCount: number;
      earlierCount: number;
      showEarlier: boolean;
    };

export function NetworkList() {
  const requests = useNetwork((s) => s.requests);
  const filters = useNetwork((s) => s.filters);
  const expandedGroups = useNetwork((s) => s.expandedGroups);
  const selectedId = useNetwork((s) => s.selectedId);
  const recentRequestIds = useNetwork((s) => s.recentRequestIds);
  const sessionStartedAt = useNetwork((s) => s.sessionStartedAt);
  const sessionEarlierIds = useNetwork((s) => s.sessionEarlierIds);
  const showEarlier = useNetwork((s) => s.showEarlier);
  const select = useNetwork((s) => s.select);
  const toggleGroup = useNetwork((s) => s.toggleGroup);
  const setShowEarlier = useNetwork((s) => s.setShowEarlier);
  const clearEarlier = useNetwork((s) => s.clearEarlier);
  const attribution = useStorageAttribution();
  const parentRef = useRef<HTMLDivElement>(null);
  const [confirmClearEarlier, setConfirmClearEarlier] = useState(false);
  const recentRequests = useMemo(
    () => new Set(recentRequestIds),
    [recentRequestIds],
  );
  const hasGraphQL = useMemo(
    () => requests.some((request) => getGraphQLRequestInfo(request) !== null),
    [requests],
  );

  const rows = useMemo<NetworkListRow[]>(() => {
    if (sessionStartedAt === null) {
      return buildDisplayRows(requests, filters, expandedGroups);
    }

    const earlierIds = new Set(sessionEarlierIds);
    const current = requests.filter((request) => !earlierIds.has(request.id));
    const earlier = requests.filter((request) => earlierIds.has(request.id));
    const currentRows = buildDisplayRows(current, filters, expandedGroups);
    if (earlier.length === 0) return currentRows;
    const earlierRows = showEarlier
      ? buildDisplayRows(earlier, filters, expandedGroups)
      : [];
    return [
      ...currentRows,
      {
        kind: "session",
        startedAt: sessionStartedAt,
        currentCount: current.length,
        earlierCount: earlier.length,
        showEarlier,
      },
      ...earlierRows,
    ];
  }, [
    requests,
    filters,
    expandedGroups,
    sessionStartedAt,
    sessionEarlierIds,
    showEarlier,
  ]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) =>
      rows[index]?.kind === "session" ? SESSION_ROW_HEIGHT : ROW_HEIGHT,
    overscan: 14,
  });

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-b-border border-l-2 border-l-transparent bg-surface-sunken px-3 text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
        <span className="w-12 shrink-0">{hasGraphQL ? "Type" : "Method"}</span>
        <span className="min-w-0 flex-1">Endpoint</span>
        <span className="w-10 shrink-0 text-right">Status</span>
        <span className="w-16 shrink-0 text-right">Duration</span>
        <span className="w-16 shrink-0 text-right">Time</span>
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
          <div
            style={{
              height: virtualizer.getTotalSize(),
              position: "relative",
              width: "100%",
            }}
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
                  {row.kind === "session" ? (
                    <CaptureBoundaryRow
                      row={row}
                      onToggleEarlier={() => setShowEarlier(!row.showEarlier)}
                      onClearEarlier={() => setConfirmClearEarlier(true)}
                    />
                  ) : row.kind === "group" ? (
                    <GroupRow
                      row={row}
                      arrived={recentRequests.has(row.sample.id)}
                      onToggle={() => toggleGroup(row.key)}
                    />
                  ) : (
                    <RequestRow
                      row={row}
                      active={row.request.id === selectedId}
                      arrived={recentRequests.has(row.request.id)}
                      impact={attribution.counts.get(row.request.id) ?? 0}
                      onSelect={() => select(row.request.id)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {confirmClearEarlier && sessionStartedAt !== null && (
        <ConfirmDialog
          title="Clear earlier requests?"
          description="This removes only the requests captured before the current marker. Requests in the active capture stay available."
          confirmLabel="Clear earlier"
          onCancel={() => setConfirmClearEarlier(false)}
          onConfirm={() => {
            clearEarlier();
            setConfirmClearEarlier(false);
          }}
        />
      )}
    </div>
  );
}

function CaptureBoundaryRow({
  row,
  onToggleEarlier,
  onClearEarlier,
}: {
  row: Extract<NetworkListRow, { kind: "session" }>;
  onToggleEarlier: () => void;
  onClearEarlier: () => void;
}) {
  return (
    <div className="flex h-full items-center gap-2 border-b border-t border-l-2 border-accent/30 bg-accent-wash/60 px-3 text-[10px]">
      <Flag size={11} strokeWidth={1.5} className="shrink-0 text-accent" />
      <span className="font-semibold text-accent">New capture</span>
      <time className="text-text-subtle">
        {new Date(row.startedAt).toLocaleTimeString("en-US")}
      </time>
      <span className="text-text-subtle">
        {row.currentCount} new {row.currentCount === 1 ? "request" : "requests"}
      </span>
      {row.earlierCount > 0 && (
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleEarlier}
            className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-text-muted hover:bg-surface-hover hover:text-text"
          >
            {row.showEarlier ? (
              <EyeOff size={11} strokeWidth={1.5} />
            ) : (
              <Eye size={11} strokeWidth={1.5} />
            )}
            {row.showEarlier ? "Hide" : "Show"} {row.earlierCount} earlier
          </button>
          <button
            type="button"
            onClick={onClearEarlier}
            title="Clear requests captured before this marker"
            className="inline-flex h-6 w-6 items-center justify-center rounded text-text-subtle hover:bg-surface-hover hover:text-deleted"
          >
            <Trash2 size={11} strokeWidth={1.5} />
          </button>
        </div>
      )}
    </div>
  );
}

function GroupRow({
  row,
  arrived,
  onToggle,
}: {
  row: Extract<DisplayRow, { kind: "group" }>;
  arrived: boolean;
  onToggle: () => void;
}) {
  const Chevron = row.expanded ? ChevronDown : ChevronRight;
  return (
    <button
      onClick={onToggle}
      className={`flex h-full w-full items-center gap-2 border-b border-b-border/60 border-l-2 border-l-transparent bg-surface-sunken px-3 text-left text-[12px] hover:bg-surface-hover ${
        arrived ? "rnsi-network-row-arrival" : ""
      }`}
    >
      <Chevron
        size={13}
        strokeWidth={1.5}
        className="shrink-0 text-text-subtle"
      />
      <span
        className={`w-12 shrink-0 font-mono text-[10px] font-bold uppercase ${methodColorClass(requestTypeLabel(row.sample))}`}
      >
        {requestTypeLabel(row.sample)}
      </span>
      <span
        className="min-w-0 flex-1 truncate font-mono font-semibold text-text"
        title={`${row.origin}${row.path}`}
      >
        {endpointLabel(row.sample)}
      </span>
      {row.hasError && (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-deleted"
          title="Contains failed requests"
        />
      )}
      <span className="shrink-0 rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-text-muted">
        {row.count}
      </span>
    </button>
  );
}

function RequestRow({
  row,
  active,
  arrived,
  impact,
  onSelect,
}: {
  row: Extract<DisplayRow, { kind: "request" }>;
  active: boolean;
  arrived: boolean;
  impact: number;
  onSelect: () => void;
}) {
  const request = row.request;
  const graphQLErrors = getGraphQLResponseInfo(request)?.errors.length ?? 0;
  // GraphQL erra com HTTP 200 (a falha "silenciosa"): na lista só sinalizamos
  // quando o status ESCONDE isso — status 2xx. Em 3xx/4xx/5xx a coluna Status
  // já grita, então o badge seria só redundância/ruído (fica no detalhe).
  const hasSilentGraphQLFailure =
    graphQLErrors > 0 &&
    request.status !== null &&
    request.status >= 200 &&
    request.status < 300;
  return (
    <button
      onClick={onSelect}
      className={`flex h-full w-full items-center gap-2 border-b border-b-border/60 border-l-2 pr-3 text-left text-[12px] ${
        row.indent ? "pl-8" : "pl-3"
      } ${active ? "border-l-accent bg-accent-wash" : "border-l-transparent hover:bg-surface-hover"} ${
        arrived ? "rnsi-network-row-arrival" : ""
      }`}
    >
      <span
        className={`w-12 shrink-0 font-mono text-[10px] font-bold uppercase ${methodColorClass(requestTypeLabel(request))}`}
      >
        {requestTypeLabel(request)}
      </span>
      <span
        className="min-w-0 flex-1 truncate font-mono text-text"
        title={endpointLabel(request)}
      >
        {endpointLabel(request)}
      </span>
      {hasSilentGraphQLFailure ? (
        <span
          className="inline-flex shrink-0 items-center rounded border border-deleted/50 bg-deleted-wash px-1.5 py-0.5 font-mono text-[9px] font-semibold text-deleted"
          title={`${graphQLErrors} GraphQL ${graphQLErrors === 1 ? "error" : "errors"} in an HTTP ${request.status} response — the status looks OK but the response failed`}
        >
          GQL {graphQLErrors}
        </span>
      ) : null}
      {request.replayOf ? (
        <span
          className="inline-flex shrink-0 items-center gap-1 rounded border border-accent/40 bg-accent-wash px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-accent"
          title={`Replay of ${request.replayOf}`}
        >
          <RefreshCw size={9} strokeWidth={2} />
          Replay
        </span>
      ) : null}
      {impact > 0 && (
        <span
          className="inline-flex shrink-0 items-center gap-0.5 rounded border border-accent/40 bg-surface-raised px-1 py-0.5 font-mono text-[9px] font-semibold text-accent"
          title={`Changed ${impact} storage ${impact === 1 ? "entry" : "entries"} right after this response`}
        >
          <Database size={9} strokeWidth={2} />
          {impact}
        </span>
      )}
      <span
        className={`w-10 shrink-0 text-right font-mono text-[11px] font-semibold ${statusColorClass(request)}`}
      >
        {statusLabel(request)}
      </span>
      <span className="w-16 shrink-0 text-right font-mono text-[11px] text-text-muted">
        {formatDuration(request.duration)}
      </span>
      <span
        className="w-16 shrink-0 text-right font-mono text-[11px] text-text-subtle"
        title={new Date(request.startedAt).toLocaleString()}
      >
        {formatClock(request.startedAt)}
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
      {icon && (
        <Radio size={22} strokeWidth={1.5} className="text-text-subtle" />
      )}
      <p className="text-[13px] text-text-muted">{title}</p>
      {subtitle && (
        <p className="max-w-[260px] text-[11px] text-text-subtle">{subtitle}</p>
      )}
    </div>
  );
}
