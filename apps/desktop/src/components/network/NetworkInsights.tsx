import { useMemo, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Repeat,
  Timer,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { NetworkRequest } from "@rnsi/protocol";
import { useNetwork } from "../../lib/network-store.ts";
import { matchesFilters } from "../../lib/network-select.ts";
import {
  buildEndpointStats,
  buildOverviewKpis,
  buildTimeline,
  sortEndpoints,
  staticPrefix,
  topEndpointByCalls,
  type EndpointSort,
  type EndpointStat,
  type TimelineBucket,
} from "../../lib/network-overview.ts";
import { formatBytes, formatDuration, methodColorClass } from "./format.ts";

interface NetworkInsightsProps {
  open: boolean;
  onClose: () => void;
}

/** % legível: uma casa quando pequeno, inteiro acima de 10%. */
function formatPct(rate: number): string {
  if (rate <= 0) return "0%";
  const pct = rate * 100;
  return pct < 10 ? `${pct.toFixed(1)}%` : `${Math.round(pct)}%`;
}

/** Hora do relógio (HH:MM:SS) — rótulo do eixo x da timeline. */
function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour12: false });
}

/**
 * Network Insights — o resumo da sessão. Overlay que abre por cima da lista
 * (mesmo padrão do StorageOverview): KPIs no topo, timeline de todos os
 * requests, e uma tabela de endpoints rankeada. Clicar num endpoint entra no
 * detalhe dele. Tudo lê de funções puras (network-overview.ts).
 */
export function NetworkInsights({ open, onClose }: NetworkInsightsProps) {
  const requests = useNetwork((s) => s.requests);
  const filters = useNetwork((s) => s.filters);
  const setSearch = useNetwork((s) => s.setSearch);
  const select = useNetwork((s) => s.select);

  const hasActiveFilters =
    filters.methods.length > 0 ||
    filters.statusClasses.length > 0 ||
    filters.search.trim() !== "" ||
    filters.slowerThanMs !== null;

  const [scope, setScope] = useState<"filtered" | "all">("filtered");
  const [sort, setSort] = useState<EndpointSort>("calls");
  const [drillKey, setDrillKey] = useState<string | null>(null);

  // Escopo: por padrão respeita o filtro ativo da lista; o usuário pode ver tudo.
  const useFiltered = hasActiveFilters && scope === "filtered";
  const visible = useMemo(
    () => (useFiltered ? requests.filter((r) => matchesFilters(r, filters)) : requests),
    [requests, filters, useFiltered],
  );

  const kpis = useMemo(() => buildOverviewKpis(visible), [visible]);
  const endpoints = useMemo(() => buildEndpointStats(visible), [visible]);
  const timeline = useMemo(() => buildTimeline(visible), [visible]);
  const villain = useMemo(() => topEndpointByCalls(endpoints), [endpoints]);
  const drilled = drillKey ? endpoints.find((e) => e.key === drillKey) ?? null : null;

  if (!open) return null;

  /** Leva o filtro da lista até um endpoint e fecha o overlay. */
  function showInList(route: string): void {
    setSearch(staticPrefix(route));
    onClose();
  }

  return (
    <div className="absolute inset-0 z-40 flex flex-col border-l border-border bg-surface">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        <button
          onClick={drilled ? () => setDrillKey(null) : onClose}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[12px] text-text-muted hover:bg-surface-hover hover:text-text"
        >
          <ArrowLeft size={14} strokeWidth={1.5} />
          {drilled ? "All endpoints" : "Back"}
        </button>
        <Activity size={15} strokeWidth={1.5} className="ml-1 text-accent" />
        <div className="min-w-0">
          <h2 className="truncate text-[13px] font-semibold">Insights</h2>
          <p className="truncate font-mono text-[11px] text-text-subtle">
            {visible.length === requests.length
              ? `${requests.length} requests`
              : `${visible.length} of ${requests.length} requests`}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {hasActiveFilters && (
            <div className="flex rounded-md border border-border bg-surface-raised p-0.5">
              {(["filtered", "all"] as const).map((option) => (
                <button
                  key={option}
                  onClick={() => setScope(option)}
                  title={
                    option === "filtered"
                      ? "Summarize only the requests matching the list filters"
                      : "Summarize every captured request"
                  }
                  className={`h-6 rounded px-2 text-[11px] ${
                    scope === option
                      ? "bg-accent text-white"
                      : "text-text-muted hover:bg-surface-hover"
                  }`}
                >
                  {option === "filtered" ? "Filtered" : "All"}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={onClose}
            title="Close"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-subtle hover:bg-surface-hover hover:text-text"
          >
            <X size={15} strokeWidth={1.5} />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {visible.length === 0 ? (
          <InsightsEmptyState />
        ) : drilled ? (
          <EndpointDetail
            stat={drilled}
            onShowInList={() => showInList(drilled.route)}
            onOpenRequest={(id) => {
              select(id);
              onClose();
            }}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <KpiRow
              kpis={kpis}
              villain={villain}
              onOpenVillain={() => villain && setDrillKey(villain.key)}
            />
            <TimelineCard timeline={timeline} />
            <EndpointTable
              endpoints={endpoints}
              sort={sort}
              onSort={setSort}
              onDrill={setDrillKey}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

function KpiTile({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: "normal" | "bad";
}) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-surface-raised px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
        {icon}
        {label}
      </div>
      <div
        className={`mt-1 truncate font-mono text-[20px] font-semibold ${
          tone === "bad" ? "text-deleted" : "text-text"
        }`}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-text-subtle">{sub}</div>}
    </div>
  );
}

function KpiRow({
  kpis,
  villain,
  onOpenVillain,
}: {
  kpis: ReturnType<typeof buildOverviewKpis>;
  villain: EndpointStat | null;
  onOpenVillain: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiTile
          icon={<Activity size={12} strokeWidth={2} />}
          label="Requests"
          value={kpis.total.toLocaleString("en-US")}
        />
        <KpiTile
          icon={<TriangleAlert size={12} strokeWidth={2} />}
          label="Failed"
          value={kpis.errorCount.toLocaleString("en-US")}
          sub={`${formatPct(kpis.errorRate)} of requests`}
          tone={kpis.errorCount > 0 ? "bad" : "normal"}
        />
        <KpiTile
          icon={<Timer size={12} strokeWidth={2} />}
          label="p95 latency"
          value={formatDuration(kpis.p95)}
          sub="95% were faster"
        />
        <KpiTile
          icon={<ArrowRight size={12} strokeWidth={2} />}
          label="Data"
          value={formatBytes(kpis.totalBytes)}
          sub={`↓ ${formatBytes(kpis.bytesDown)}  ↑ ${formatBytes(kpis.bytesUp)}`}
        />
      </div>

      {villain && villain.count > 1 && (
        <button
          onClick={onOpenVillain}
          className="group flex items-center gap-3 rounded-md border border-border bg-surface-raised px-3 py-2.5 text-left hover:border-border-strong hover:bg-surface-hover"
        >
          <Repeat size={15} strokeWidth={1.5} className="shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
              Most-called endpoint
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-[12px]">
              <span className={`font-bold ${methodColorClass(villain.method)}`}>
                {villain.method}
              </span>
              <span className="truncate text-text">{villain.route}</span>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="font-mono text-[16px] font-semibold text-text">
              {villain.count.toLocaleString("en-US")}
            </div>
            <div className="text-[10px] text-text-subtle">calls · often means over-fetch</div>
          </div>
          <ArrowRight
            size={14}
            strokeWidth={1.5}
            className="shrink-0 text-text-subtle group-hover:text-text"
          />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline (todos os requests no tempo, ok vs erro)
// ---------------------------------------------------------------------------

function TimelineTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: TimelineBucket }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const bucket = payload[0]!.payload;
  return (
    <div className="rounded-md border border-border-strong bg-surface-raised px-2.5 py-1.5 text-[11px] shadow-lg shadow-black/10">
      <div className="mb-1 font-mono text-text-subtle">{formatClock(bucket.start)}</div>
      <div className="flex items-center gap-1.5 text-text">
        <span className="h-2 w-2 rounded-sm bg-created" />
        {bucket.ok} ok
      </div>
      {bucket.error > 0 && (
        <div className="mt-0.5 flex items-center gap-1.5 text-text">
          <span className="h-2 w-2 rounded-sm bg-deleted" />
          {bucket.error} failed
        </div>
      )}
    </div>
  );
}

function TimelineCard({ timeline }: { timeline: ReturnType<typeof buildTimeline> }) {
  return (
    <section className="rounded-md border border-border bg-surface-raised">
      <header className="flex h-9 items-center gap-2 border-b border-border px-3">
        <span className="text-[12px] font-semibold">Requests over time</span>
        <div className="ml-auto flex items-center gap-3 text-[11px] text-text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-created" />
            Success
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-deleted" />
            Failed
          </span>
        </div>
      </header>
      <div className="h-40 p-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={timeline.buckets} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
            <XAxis
              dataKey="start"
              tickFormatter={formatClock}
              tick={{ fontSize: 10, fill: "var(--text-subtle)" }}
              stroke="var(--border-strong)"
              interval="preserveStartEnd"
              minTickGap={44}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 10, fill: "var(--text-subtle)" }}
              stroke="var(--border-strong)"
              width={32}
            />
            <Tooltip
              content={<TimelineTooltip />}
              cursor={{ fill: "var(--surface-hover)" }}
            />
            <Bar dataKey="ok" stackId="s" fill="var(--created)" isAnimationActive={false} />
            <Bar
              dataKey="error"
              stackId="s"
              fill="var(--deleted)"
              radius={[2, 2, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sparkline (tendência de latência de um endpoint)
// ---------------------------------------------------------------------------

function Sparkline({ trend, danger }: { trend: number[]; danger: boolean }) {
  if (trend.length < 2) {
    return <span className="text-[11px] text-text-subtle">—</span>;
  }
  const data = trend.map((v, i) => ({ i, v }));
  const stroke = danger ? "var(--deleted)" : "var(--text-muted)";
  return (
    <LineChart width={84} height={26} data={data} margin={{ top: 3, right: 2, bottom: 3, left: 2 }}>
      <Line
        type="monotone"
        dataKey="v"
        stroke={stroke}
        strokeWidth={1.5}
        dot={false}
        isAnimationActive={false}
      />
    </LineChart>
  );
}

// ---------------------------------------------------------------------------
// Tabela de endpoints
// ---------------------------------------------------------------------------

const COLUMNS: Array<{ key: EndpointSort | null; label: string }> = [
  { key: null, label: "Endpoint" },
  { key: "calls", label: "Calls" },
  { key: "errors", label: "Fail" },
  { key: "p95", label: "p95" },
  { key: "bytes", label: "Data" },
  { key: null, label: "Trend" },
];

const ROW_GRID = "grid grid-cols-[1fr_60px_64px_76px_80px_92px] items-center gap-3";

function EndpointTable({
  endpoints,
  sort,
  onSort,
  onDrill,
}: {
  endpoints: EndpointStat[];
  sort: EndpointSort;
  onSort: (sort: EndpointSort) => void;
  onDrill: (key: string) => void;
}) {
  const rows = useMemo(() => sortEndpoints(endpoints, sort), [endpoints, sort]);

  return (
    <section className="rounded-md border border-border bg-surface-raised">
      <header className="flex h-9 items-center gap-2 border-b border-border px-3">
        <span className="text-[12px] font-semibold">Endpoints</span>
        <span className="rounded border border-border bg-surface-sunken px-1.5 py-0.5 text-[10px] text-text-subtle">
          {rows.length}
        </span>
        <span className="ml-auto text-[11px] text-text-subtle">
          grouped by route · click to inspect
        </span>
      </header>

      <div
        className={`${ROW_GRID} h-8 border-b border-border bg-surface px-3 text-[11px] font-semibold uppercase tracking-wide text-text-subtle`}
      >
        {COLUMNS.map((column, index) => {
          const alignRight = index >= 1 && index <= 4;
          if (!column.key) {
            return (
              <span key={column.label} className={alignRight ? "text-right" : ""}>
                {column.label}
              </span>
            );
          }
          const active = sort === column.key;
          return (
            <button
              key={column.label}
              onClick={() => onSort(column.key!)}
              className={`inline-flex items-center gap-0.5 ${
                alignRight ? "justify-end" : ""
              } ${active ? "text-accent" : "hover:text-text"}`}
            >
              {column.label}
              {active && <ChevronDown size={11} strokeWidth={2} />}
            </button>
          );
        })}
      </div>

      <div>
        {rows.map((stat) => (
          <button
            key={stat.key}
            onClick={() => onDrill(stat.key)}
            className={`${ROW_GRID} w-full border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-surface-hover`}
          >
            <span className="flex min-w-0 items-center gap-1.5 font-mono text-[12px]">
              <span className={`shrink-0 font-bold ${methodColorClass(stat.method)}`}>
                {stat.method}
              </span>
              <span className="truncate text-text">{stat.route}</span>
            </span>
            <span className="text-right font-mono text-[12px] tabular-nums text-text">
              {stat.count.toLocaleString("en-US")}
            </span>
            <span
              className={`text-right font-mono text-[12px] tabular-nums ${
                stat.errorCount > 0 ? "text-deleted" : "text-text-subtle"
              }`}
            >
              {stat.errorCount > 0 ? formatPct(stat.errorRate) : "—"}
            </span>
            <span className="text-right font-mono text-[12px] tabular-nums text-text">
              {formatDuration(stat.p95)}
            </span>
            <span className="text-right font-mono text-[12px] tabular-nums text-text-muted">
              {formatBytes(stat.totalBytes)}
            </span>
            <span className="flex justify-end">
              <Sparkline trend={stat.trend} danger={stat.errorCount > 0} />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Detalhe de um endpoint (drill-in)
// ---------------------------------------------------------------------------

function DetailStat({ label, value, tone }: { label: string; value: string; tone?: "bad" }) {
  return (
    <div className="rounded-md border border-border bg-surface px-2.5 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
        {label}
      </div>
      <div
        className={`mt-0.5 font-mono text-[14px] font-semibold ${
          tone === "bad" ? "text-deleted" : "text-text"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function EndpointDetail({
  stat,
  onShowInList,
  onOpenRequest,
}: {
  stat: EndpointStat;
  onShowInList: () => void;
  onOpenRequest: (id: string) => void;
}) {
  const byId = useNetwork((s) => s.byId);

  const latencyData = useMemo(() => stat.trend.map((v, i) => ({ i, v })), [stat.trend]);
  // As chamadas mais lentas primeiro — é o que você quer investigar.
  const slowest = useMemo(() => {
    const list = stat.requestIds
      .map((id) => byId[id])
      .filter((r): r is NetworkRequest => r !== undefined);
    return [...list].sort((a, b) => b.duration - a.duration).slice(0, 8);
  }, [stat.requestIds, byId]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className={`font-mono text-[13px] font-bold ${methodColorClass(stat.method)}`}>
          {stat.method}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-text">
          {stat.route}
        </span>
        <button
          onClick={onShowInList}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface-raised px-2.5 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text"
        >
          Show in list
          <ArrowRight size={12} strokeWidth={1.5} />
        </button>
      </div>
      <div className="truncate font-mono text-[11px] text-text-subtle">{stat.origin}</div>

      <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
        <DetailStat label="Calls" value={stat.count.toLocaleString("en-US")} />
        <DetailStat
          label="Fail"
          value={formatPct(stat.errorRate)}
          tone={stat.errorCount > 0 ? "bad" : undefined}
        />
        <DetailStat label="p50" value={formatDuration(stat.p50)} />
        <DetailStat label="p95" value={formatDuration(stat.p95)} />
        <DetailStat label="Slowest" value={formatDuration(stat.slowest)} />
        <DetailStat label="Data" value={formatBytes(stat.totalBytes)} />
      </div>

      {latencyData.length >= 2 && (
        <section className="rounded-md border border-border bg-surface-raised">
          <header className="flex h-9 items-center gap-2 border-b border-border px-3">
            <Timer size={13} strokeWidth={1.5} className="text-accent" />
            <span className="text-[12px] font-semibold">Latency over time</span>
            <span className="ml-auto text-[11px] text-text-subtle">
              dashed line = p95 ({formatDuration(stat.p95)})
            </span>
          </header>
          <div className="h-44 p-3">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={latencyData} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                <defs>
                  <linearGradient id="latencyFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
                <XAxis dataKey="i" hide />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 10, fill: "var(--text-subtle)" }}
                  stroke="var(--border-strong)"
                  width={32}
                  tickFormatter={(v: number) => formatDuration(v)}
                />
                <ReferenceLine
                  y={stat.p95}
                  stroke="var(--text-subtle)"
                  strokeDasharray="4 4"
                />
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  fill="url(#latencyFill)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      <section className="rounded-md border border-border bg-surface-raised">
        <header className="flex h-9 items-center gap-2 border-b border-border px-3">
          <span className="text-[12px] font-semibold">Slowest calls</span>
          <span className="ml-auto text-[11px] text-text-subtle">click to open in the list</span>
        </header>
        <div>
          {slowest.map((request) => (
            <button
              key={request.id}
              onClick={() => onOpenRequest(request.id)}
              className="flex w-full items-center gap-3 border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-surface-hover"
            >
              <span
                className={`w-10 shrink-0 font-mono text-[12px] tabular-nums ${
                  request.status === null || request.status >= 400
                    ? "text-deleted"
                    : "text-created"
                }`}
              >
                {request.status ?? "ERR"}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-muted">
                {request.query ? `${request.path}?${request.query}` : request.path}
              </span>
              <span className="shrink-0 font-mono text-[12px] tabular-nums text-text">
                {formatDuration(request.duration)}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function InsightsEmptyState() {
  return (
    <div className="flex h-full items-center justify-center py-12 text-center">
      <div className="flex max-w-[320px] flex-col items-center gap-2">
        <Activity size={22} strokeWidth={1.5} className="text-text-subtle" />
        <p className="text-[13px] font-medium text-text-muted">Nothing to summarize yet</p>
        <p className="text-[11px] leading-relaxed text-text-subtle">
          Capture some requests (or relax the list filters) and the summary will appear here.
        </p>
      </div>
    </div>
  );
}
