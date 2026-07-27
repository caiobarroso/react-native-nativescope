import { Layers, Search, X } from "lucide-react";
import { useNetwork, type StatusClass } from "../../lib/network-store.ts";
import { METHOD_OPTIONS, SLOW_PRESETS, STATUS_CLASS_OPTIONS } from "../../lib/network-select.ts";

const STATUS_COLOR: Record<StatusClass, string> = {
  "2xx": "text-created",
  "3xx": "text-updated",
  "4xx": "text-deleted",
  "5xx": "text-deleted",
  err: "text-deleted",
};

export function NetworkFilters() {
  const filters = useNetwork((s) => s.filters);
  const toggleMethod = useNetwork((s) => s.toggleMethod);
  const toggleStatusClass = useNetwork((s) => s.toggleStatusClass);
  const setSearch = useNetwork((s) => s.setSearch);
  const setSlowerThan = useNetwork((s) => s.setSlowerThan);
  const setGrouped = useNetwork((s) => s.setGrouped);
  const clearFilters = useNetwork((s) => s.clearFilters);

  const hasActiveFilters =
    filters.methods.length > 0 ||
    filters.statusClasses.length > 0 ||
    filters.search.trim() !== "" ||
    filters.slowerThanMs !== null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-surface-sunken px-2 py-1.5">
      <label className="relative flex min-w-[160px] flex-1 items-center">
        <Search size={13} strokeWidth={1.5} className="absolute left-2 text-text-subtle" />
        <input
          value={filters.search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search url, headers, body…"
          className="h-7 w-full rounded-md border border-border bg-surface-raised pl-7 pr-2 text-[12px] text-text placeholder:text-text-subtle focus:border-accent focus:outline-none"
        />
      </label>

      <div className="flex items-center gap-0.5 rounded-md border border-border bg-surface-raised p-0.5">
        {METHOD_OPTIONS.map((method) => {
          const active = filters.methods.includes(method);
          return (
            <button
              key={method}
              onClick={() => toggleMethod(method)}
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                active ? "bg-accent-wash text-accent" : "text-text-subtle hover:text-text"
              }`}
            >
              {method}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-0.5 rounded-md border border-border bg-surface-raised p-0.5">
        {STATUS_CLASS_OPTIONS.map((cls) => {
          const active = filters.statusClasses.includes(cls);
          return (
            <button
              key={cls}
              onClick={() => toggleStatusClass(cls)}
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                active ? "bg-accent-wash" : "hover:bg-surface-hover"
              } ${active ? STATUS_COLOR[cls] : "text-text-subtle"}`}
            >
              {cls}
            </button>
          );
        })}
      </div>

      <select
        value={filters.slowerThanMs ?? ""}
        onChange={(event) =>
          setSlowerThan(event.target.value === "" ? null : Number(event.target.value))
        }
        title="Show only requests slower than…"
        className="h-7 rounded-md border border-border bg-surface-raised px-1.5 text-[11px] text-text-muted focus:border-accent focus:outline-none"
      >
        <option value="">Any speed</option>
        {SLOW_PRESETS.map((preset) => (
          <option key={preset.ms} value={preset.ms}>{`≥ ${preset.label}`}</option>
        ))}
      </select>

      <button
        onClick={() => setGrouped(!filters.grouped)}
        title="Group by endpoint (method + path)"
        className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] ${
          filters.grouped
            ? "border-accent bg-accent-wash text-accent"
            : "border-border bg-surface-raised text-text-muted hover:text-text"
        }`}
      >
        <Layers size={12} strokeWidth={1.5} />
        Group
      </button>

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
    </div>
  );
}
