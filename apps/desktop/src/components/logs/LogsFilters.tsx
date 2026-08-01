import { useMemo } from "react";
import { AlertTriangle, Search, X } from "lucide-react";
import { useLogs } from "../../lib/logs-store.ts";
import {
  LEVEL_OPTIONS,
  collectNamespaces,
  countByLevel,
  matchesFilters,
  scopeToMark,
} from "../../lib/logs-select.ts";
import { levelLabel, levelTextClass } from "./format.ts";
import { LogsCaptureControls } from "./LogsCaptureControls.tsx";

export function LogsFilters() {
  const entries = useLogs((s) => s.entries);
  const filters = useLogs((s) => s.filters);
  const toggleLevel = useLogs((s) => s.toggleLevel);
  const setSearch = useLogs((s) => s.setSearch);
  const setNamespace = useLogs((s) => s.setNamespace);
  const clearFilters = useLogs((s) => s.clearFilters);
  const dropped = useLogs((s) => s.dropped);
  const markedSeq = useLogs((s) => s.markedSeq);
  const markedAt = useLogs((s) => s.markedAt);
  const showEarlier = useLogs((s) => s.showEarlier);

  const scoped = useMemo(
    () => scopeToMark(entries, { markedSeq, markedAt, showEarlier }),
    [entries, markedSeq, markedAt, showEarlier],
  );

  // Contagem ignora o próprio filtro de nível: desligar "error" não pode zerar
  // o contador de error — é justamente quando você quer saber que existem 3.
  const counts = useMemo(
    () => countByLevel(scoped.filter((entry) => matchesFilters(entry, { ...filters, levels: [] }))),
    [scoped, filters],
  );

  const namespaces = useMemo(() => collectNamespaces(scoped), [scoped]);

  const hasActiveFilters =
    filters.levels.length > 0 || filters.search.trim() !== "" || filters.namespace !== null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-surface-sunken px-3 py-2">
      <label className="relative flex min-w-[160px] flex-1 items-center">
        <Search size={13} strokeWidth={1.5} className="absolute left-2 text-text-subtle" />
        <input
          value={filters.search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search message, namespace, data…"
          className="h-7 w-full rounded-md border border-border bg-surface-raised pl-7 pr-2 text-[12px] text-text placeholder:text-text-subtle focus:border-accent focus:outline-none"
        />
      </label>

      <div className="flex h-7 items-center gap-0.5 rounded-md border border-border bg-surface-raised p-0.5">
        {LEVEL_OPTIONS.map((level) => {
          const active = filters.levels.includes(level);
          const count = counts[level];
          return (
            <button
              key={level}
              onClick={() => toggleLevel(level)}
              title={`Show only ${level}`}
              className={`inline-flex h-6 items-center gap-1 rounded px-1.5 font-mono text-[10px] font-semibold ${
                active ? "bg-accent-wash" : "hover:bg-surface-hover"
              } ${active || count > 0 ? levelTextClass(level) : "text-text-subtle"}`}
            >
              {levelLabel(level)}
              {count > 0 && (
                <span className="tabular-nums opacity-70">{count > 999 ? "999+" : count}</span>
              )}
            </button>
          );
        })}
      </div>

      {namespaces.length > 0 && (
        <select
          value={filters.namespace ?? ""}
          onChange={(event) => setNamespace(event.target.value === "" ? null : event.target.value)}
          title="Filter by namespace"
          className="h-7 max-w-[160px] rounded-md border border-border bg-surface-raised px-1.5 text-[11px] text-text-muted focus:border-accent focus:outline-none"
        >
          <option value="">All namespaces</option>
          {namespaces.map((namespace) => (
            <option key={namespace} value={namespace}>
              {namespace}
            </option>
          ))}
        </select>
      )}

      {hasActiveFilters && (
        <button
          onClick={clearFilters}
          title="Clear filters"
          className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] text-text-subtle hover:text-text"
        >
          <X size={12} strokeWidth={1.5} />
          Clear
        </button>
      )}

      {dropped > 0 && (
        <span
          title="The device hit its per-second log ceiling and discarded these to protect your app."
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-updated/40 px-2 text-[11px] text-updated"
        >
          <AlertTriangle size={12} strokeWidth={1.5} />
          {dropped > 9999 ? "9999+" : dropped} dropped
        </span>
      )}

      <LogsCaptureControls />
    </div>
  );
}
