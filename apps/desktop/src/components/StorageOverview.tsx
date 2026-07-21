import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowLeft,
  BarChart3,
  ChevronRight,
  Database,
  Hash,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { keysId, useStudio, type Selection } from "../lib/store.ts";
import {
  runStorageScan,
  type NamespaceStat,
  type StorageReport,
  type TypeStat,
} from "../lib/storage-scan.ts";

type Metric = "bytes" | "count";

interface CachedOverview {
  report: StorageReport;
}

interface StorageOverviewProps {
  open: boolean;
  selection: Selection | null;
  onClose: () => void;
}

const overviewCache = new Map<string, CachedOverview>();
const OVERVIEW_CACHE_LIMIT = 8;

function cacheOverview(id: string, value: CachedOverview): void {
  overviewCache.delete(id);
  overviewCache.set(id, value);
  while (overviewCache.size > OVERVIEW_CACHE_LIMIT) {
    const oldest = overviewCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    overviewCache.delete(oldest);
  }
}

const TYPE_LABEL: Record<string, string> = {
  json: "JSON",
  string: "String",
  number: "Number",
  boolean: "Boolean",
  buffer: "Buffer",
  null: "Null",
};

const TYPE_TONE: Record<string, string> = {
  json: "bg-accent",
  string: "bg-created",
  number: "bg-updated",
  boolean: "bg-created",
  buffer: "bg-text-muted",
  null: "bg-text-subtle",
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 10 || unit === 0 ? 0 : 1;
  return `≈ ${value.toFixed(digits)} ${units[unit]}`;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function percentage(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, (part / total) * 100));
}

function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-surface-raised px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
        {label}
      </div>
      <div className="mt-1 truncate font-mono text-[18px] font-semibold text-text">
        {value}
      </div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-text-subtle">{sub}</div>}
    </div>
  );
}

function TypeDistribution({ types, totalBytes, totalKeys, metric }: {
  types: TypeStat[];
  totalBytes: number;
  totalKeys: number;
  metric: Metric;
}) {
  const sorted = [...types].sort((a, b) =>
    metric === "bytes" ? b.bytes - a.bytes : b.count - a.count,
  );
  const total = metric === "bytes" ? totalBytes : totalKeys;

  return (
    <section className="rounded-md border border-border bg-surface-raised">
      <header className="flex h-9 items-center gap-2 border-b border-border px-3">
        <BarChart3 size={14} strokeWidth={1.5} className="text-accent" />
        <span className="text-[12px] font-semibold">Type distribution</span>
      </header>
      <div className="p-3">
        <div className="flex h-3 overflow-hidden rounded-sm bg-surface-sunken">
          {sorted.map((type) => {
            const size = metric === "bytes" ? type.bytes : type.count;
            const width = percentage(size, total);
            if (width <= 0) return null;
            return (
              <div
                key={type.type}
                className={TYPE_TONE[type.type] ?? "bg-border-strong"}
                style={{ width: `${width}%` }}
                title={`${TYPE_LABEL[type.type] ?? type.type}: ${width.toFixed(1)}%`}
              />
            );
          })}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
          {sorted.map((type) => (
            <div key={type.type} className="flex min-w-0 items-center gap-2 text-[12px]">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  TYPE_TONE[type.type] ?? "bg-border-strong"
                }`}
              />
              <span className="min-w-0 flex-1 truncate text-text-muted">
                {TYPE_LABEL[type.type] ?? type.type}
              </span>
              <span className="shrink-0 font-mono text-text-subtle">
                {metric === "bytes" ? formatBytes(type.bytes) : formatCount(type.count)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TopKeys({ report, onOpenKey }: { report: StorageReport; onOpenKey: (key: string) => void }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-md border border-border bg-surface-raised">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <Hash size={14} strokeWidth={1.5} className="text-accent" />
        <span className="text-[12px] font-semibold">Largest keys</span>
      </header>
      <ol className="min-h-0 flex-1 overflow-auto p-1">
        {report.topKeys.length === 0 && (
          <li className="px-2 py-3 text-[12px] text-text-subtle">No keys found.</li>
        )}
        {report.topKeys.map((entry) => (
          <li
            key={entry.key}
          >
            <button
              type="button"
              onClick={() => onOpenKey(entry.key)}
              title={`Open ${entry.key}`}
              className="group grid h-8 w-full cursor-pointer grid-cols-[1fr_auto_auto_14px] items-center gap-3 rounded px-2 text-left font-mono text-[12px] hover:bg-surface-hover"
            >
              <span className="min-w-0 truncate text-text">{entry.key}</span>
              <span className="rounded border border-border px-1 py-px text-[10px] uppercase text-text-subtle">
                {entry.valueType}
              </span>
              <span className="text-text-muted">{formatBytes(entry.bytes)}</span>
              <ChevronRight
                size={14}
                strokeWidth={1.5}
                className="text-text-subtle opacity-0 group-hover:opacity-100"
              />
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function NamespaceRows({
  namespaces,
  metric,
  totalBytes,
  totalKeys,
  onDrill,
  onOpenKey,
}: {
  namespaces: NamespaceStat[];
  metric: Metric;
  totalBytes: number;
  totalKeys: number;
  onDrill: (prefix: string) => void;
  onOpenKey: (key: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const total = metric === "bytes" ? totalBytes : totalKeys;
  const virtualizer = useVirtualizer({
    count: namespaces.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 42,
    overscan: 10,
  });

  return (
    <div ref={parentRef} className="min-h-0 flex-1 overflow-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((item) => {
          const namespace = namespaces[item.index];
          if (!namespace) return null;
          const value = metric === "bytes" ? namespace.bytes : namespace.count;
          const width = percentage(value, total);
          const isSingleKey = namespace.count === 1;
          const canDrill = namespace.prefix !== "";
          const canAct = isSingleKey || canDrill;
          return (
            <button
              key={namespace.label}
              type="button"
              disabled={!canAct}
              onClick={() => {
                if (isSingleKey) onOpenKey(namespace.sampleKey);
                else if (canDrill) onDrill(namespace.prefix);
              }}
              title={
                isSingleKey
                  ? `Open ${namespace.sampleKey}`
                  : canDrill
                    ? `Filter by ${namespace.prefix}`
                    : "No stable prefix"
              }
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${item.start}px)`,
              }}
              className="group h-10 border-b border-border px-3 text-left hover:bg-surface-hover enabled:cursor-pointer disabled:cursor-default"
            >
              <div className="flex h-full min-w-0 items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate font-mono text-[12px] font-semibold text-text">
                      {namespace.label}
                    </span>
                    <span className="shrink-0 text-[11px] text-text-subtle">
                      {width.toFixed(width >= 10 ? 0 : 1)}%
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-sm bg-surface-sunken">
                    <div className="h-full bg-accent" style={{ width: `${width}%` }} />
                  </div>
                </div>
                <span className="w-20 shrink-0 text-right font-mono text-[12px] text-text-muted">
                  {formatCount(namespace.count)}
                </span>
                <span className="w-24 shrink-0 text-right font-mono text-[12px] text-text-muted">
                  {formatBytes(namespace.bytes)}
                </span>
                <ChevronRight
                  size={14}
                  strokeWidth={1.5}
                  className={`shrink-0 ${
                    canAct
                      ? "text-text-subtle opacity-0 group-hover:opacity-100"
                      : "text-transparent"
                  }`}
                />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function StorageOverview({ open, selection, onClose }: StorageOverviewProps) {
  const setKeyFilter = useStudio((s) => s.setKeyFilter);
  const selectKey = useStudio((s) => s.selectKey);
  const [metric, setMetric] = useState<Metric>("bytes");
  const [cacheVersion, setCacheVersion] = useState(0);
  const [progress, setProgress] = useState<{ scanned: number; total: number } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastProgressAtRef = useRef(0);

  const id = selection ? keysId(selection.providerId, selection.instanceId) : null;
  const cached = id ? overviewCache.get(id) : undefined;

  const sortedNamespaces = useMemo(() => {
    if (!cached) return [];
    return [...cached.report.namespaces].sort((a, b) =>
      metric === "bytes" ? b.bytes - a.bytes : b.count - a.count,
    );
  }, [cached, cacheVersion, metric]);

  const startScan = useCallback(() => {
    if (!selection) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setScanning(true);
    setError(null);
    setProgress({ scanned: 0, total: 0 });
    lastProgressAtRef.current = 0;
    void runStorageScan(selection.providerId, selection.instanceId, {
      signal: controller.signal,
      onProgress: (next) => {
        const now = performance.now();
        if (now - lastProgressAtRef.current < 250 && next.scanned !== next.total) return;
        lastProgressAtRef.current = now;
        setProgress(next);
      },
    })
      .then((report) => {
        if (controller.signal.aborted) return;
        cacheOverview(keysId(selection.providerId, selection.instanceId), {
          report,
        });
        setCacheVersion((v) => v + 1);
        setProgress({ scanned: report.totalKeys, total: report.total });
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Could not calculate the overview.");
      })
      .finally(() => {
        if (abortRef.current === controller) abortRef.current = null;
        if (!controller.signal.aborted) setScanning(false);
      });
  }, [selection]);

  useEffect(() => {
    if (!open || !selection) return;
    const cachedReport = overviewCache.get(keysId(selection.providerId, selection.instanceId));
    if (!cachedReport) startScan();
    return () => abortRef.current?.abort();
  }, [open, selection, startScan]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open || !selection) return null;

  const report = cached?.report;
  const progressTotal = progress?.total ?? report?.total ?? 0;
  const progressScanned = progress?.scanned ?? report?.totalKeys ?? 0;
  const progressPct = progressTotal > 0 ? percentage(progressScanned, progressTotal) : 0;

  function cancelScan(): void {
    abortRef.current?.abort();
    abortRef.current = null;
    setScanning(false);
  }

  function drill(prefix: string): void {
    setKeyFilter(prefix);
    selectKey(null);
    onClose();
  }

  function openKey(key: string): void {
    setKeyFilter(key);
    selectKey(key);
    onClose();
  }

  return (
    <div className="absolute inset-0 z-40 flex flex-col border-l border-border bg-surface">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        <button
          onClick={onClose}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[12px] text-text-muted hover:bg-surface-hover hover:text-text"
        >
          <ArrowLeft size={14} strokeWidth={1.5} />
          Back
        </button>
        <Database size={15} strokeWidth={1.5} className="ml-1 text-accent" />
        <div className="min-w-0">
          <h2 className="truncate text-[13px] font-semibold">Overview</h2>
          <p className="truncate font-mono text-[11px] text-text-subtle">
            {selection.providerId} · {selection.instanceId}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={startScan}
            disabled={scanning}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text disabled:opacity-50"
          >
            <RefreshCw size={13} strokeWidth={1.5} className={scanning ? "animate-spin" : ""} />
            Recalculate
          </button>
          <button
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-subtle hover:bg-surface-hover hover:text-text"
            title="Close"
          >
            <X size={15} strokeWidth={1.5} />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden p-4">
        {scanning && !report ? (
          <div className="flex h-full items-center justify-center">
            <div className="w-[min(520px,100%)] rounded-lg border border-border bg-surface-raised p-5 shadow-sm shadow-black/5">
              <div className="flex items-center gap-3">
                <Loader2 size={18} strokeWidth={1.5} className="animate-spin text-accent" />
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold">Scanning metadata</div>
                  <div className="mt-0.5 text-[12px] text-text-muted">
                    {formatCount(progressScanned)} / {formatCount(progressTotal)} keys
                  </div>
                </div>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-sm bg-surface-sunken">
                <div className="h-full bg-accent" style={{ width: `${progressPct}%` }} />
              </div>
              <button
                onClick={cancelScan}
                className="mt-4 h-8 rounded-md border border-border px-3 text-[12px] text-text-muted hover:bg-surface-hover hover:text-text"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : error ? (
          <div className="rounded-md border border-deleted/30 bg-deleted-wash px-3 py-2 text-[12px] text-deleted">
            {error}
          </div>
        ) : report ? (
          <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_340px] gap-4">
            <section className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-surface-raised">
              <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
                <Search size={14} strokeWidth={1.5} className="text-accent" />
                <span className="text-[12px] font-semibold">Namespaces</span>
                {report.truncatedNamespaces && (
                  <span className="rounded border border-border bg-surface-sunken px-1.5 py-0.5 text-[10px] text-text-subtle">
                    grouped
                  </span>
                )}
                <span className="ml-auto text-[11px] text-text-subtle">Sort by</span>
                <div className="flex rounded-md border border-border bg-surface p-0.5">
                  {(["bytes", "count"] as const).map((next) => (
                    <button
                      key={next}
                      onClick={() => setMetric(next)}
                      title={
                        next === "bytes"
                          ? "Prioritize groups that use more space"
                          : "Prioritize groups with more keys"
                      }
                      className={`h-6 rounded px-2 text-[11px] ${
                        metric === next
                          ? "bg-accent text-white"
                          : "text-text-muted hover:bg-surface-hover"
                        }`}
                    >
                      {next === "bytes" ? "Size" : "Count"}
                    </button>
                  ))}
                </div>
              </header>
              <div className="grid h-8 shrink-0 grid-cols-[1fr_80px_96px_24px] items-center gap-3 border-b border-border bg-surface px-3 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
                <span>Group</span>
                <span className="text-right">Keys</span>
                <span className="text-right">Size</span>
                <span />
              </div>
              <NamespaceRows
                namespaces={sortedNamespaces}
                metric={metric}
                totalBytes={report.totalBytes}
                totalKeys={report.totalKeys}
                onDrill={drill}
                onOpenKey={openKey}
              />
            </section>

            <aside className="flex min-h-0 flex-col gap-3 overflow-hidden">
              <div className="grid grid-cols-2 gap-3">
                <StatTile label="Keys" value={formatCount(report.totalKeys)} />
                <StatTile label="Size" value={formatBytes(report.totalBytes)} />
                <StatTile label="Namespaces" value={formatCount(report.namespaces.length)} />
                <StatTile label="Types" value={formatCount(report.types.length)} />
              </div>
              {scanning && (
                <div className="rounded-md border border-border bg-surface-raised p-3">
                  <div className="flex items-center gap-2 text-[12px] text-text-muted">
                    <Loader2 size={14} strokeWidth={1.5} className="animate-spin text-accent" />
                    Recalculating {formatCount(progressScanned)} / {formatCount(progressTotal)}
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-sm bg-surface-sunken">
                    <div className="h-full bg-accent" style={{ width: `${progressPct}%` }} />
                  </div>
                </div>
              )}
              <TypeDistribution
                types={report.types}
                totalBytes={report.totalBytes}
                totalKeys={report.totalKeys}
                metric={metric}
              />
              <TopKeys report={report} onOpenKey={openKey} />
            </aside>
          </div>
        ) : null}
      </div>
    </div>
  );
}
