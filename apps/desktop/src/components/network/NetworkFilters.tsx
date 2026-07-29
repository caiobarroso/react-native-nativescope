import { Layers, Search, X } from "lucide-react";
import { useNetwork, type StatusClass } from "../../lib/network-store.ts";
import {
  METHOD_OPTIONS,
  SLOW_PRESETS,
  STATUS_CLASS_OPTIONS,
} from "../../lib/network-select.ts";
import { NetworkCaptureControls } from "./NetworkCaptureControls.tsx";
import {
  getGraphQLRequestInfo,
  type GraphQLOperationType,
  type NetworkProtocol,
} from "../../lib/network-graphql.ts";

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
  const setProtocol = useNetwork((s) => s.setProtocol);
  const setGraphQLOperation = useNetwork((s) => s.setGraphQLOperation);
  const clearFilters = useNetwork((s) => s.clearFilters);
  const requests = useNetwork((s) => s.requests);
  const hasGraphQL = requests.some(
    (request) => getGraphQLRequestInfo(request) !== null,
  );

  const hasActiveFilters =
    filters.methods.length > 0 ||
    filters.statusClasses.length > 0 ||
    filters.search.trim() !== "" ||
    filters.slowerThanMs !== null ||
    filters.protocol !== "all" ||
    filters.graphQLOperation !== "all";

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-surface-sunken px-3 py-2">
      <label className="relative flex min-w-[160px] flex-1 items-center">
        <Search
          size={13}
          strokeWidth={1.5}
          className="absolute left-2 text-text-subtle"
        />
        <input
          value={filters.search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search url, headers, body…"
          className="h-7 w-full rounded-md border border-border bg-surface-raised pl-7 pr-2 text-[12px] text-text placeholder:text-text-subtle focus:border-accent focus:outline-none"
        />
      </label>

      {hasGraphQL ? (
        <select
          value={trafficFilterValue(
            filters.protocol,
            filters.graphQLOperation,
          )}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "http" || value === "graphql") {
              setProtocol(value);
              if (value === "graphql") setGraphQLOperation("all");
              return;
            }
            if (value.startsWith("graphql:")) {
              setGraphQLOperation(
                value.slice("graphql:".length) as GraphQLOperationType,
              );
              return;
            }
            setProtocol("all");
          }}
          title="Filter HTTP and GraphQL traffic"
          className="h-7 rounded-md border border-border bg-surface-raised px-1.5 text-[11px] text-text-muted focus:border-accent focus:outline-none"
        >
          <option value="all">All traffic</option>
          <option value="http">HTTP</option>
          <option value="graphql">GraphQL</option>
          <option value="graphql:query">GraphQL queries</option>
          <option value="graphql:mutation">GraphQL mutations</option>
          <option value="graphql:subscription">GraphQL subscriptions</option>
        </select>
      ) : null}

      <div className="flex h-7 items-center gap-0.5 rounded-md border border-border bg-surface-raised p-0.5">
        {METHOD_OPTIONS.map((method) => {
          const active = filters.methods.includes(method);
          return (
            <button
              key={method}
              onClick={() => toggleMethod(method)}
              className={`inline-flex h-6 items-center rounded px-1.5 font-mono text-[10px] font-bold ${
                active
                  ? "bg-accent-wash text-accent"
                  : "text-text-subtle hover:text-text"
              }`}
            >
              {method}
            </button>
          );
        })}
      </div>

      <div className="flex h-7 items-center gap-0.5 rounded-md border border-border bg-surface-raised p-0.5">
        {STATUS_CLASS_OPTIONS.map((cls) => {
          const active = filters.statusClasses.includes(cls);
          return (
            <button
              key={cls}
              onClick={() => toggleStatusClass(cls)}
              className={`inline-flex h-6 items-center rounded px-1.5 font-mono text-[10px] font-semibold ${
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
          setSlowerThan(
            event.target.value === "" ? null : Number(event.target.value),
          )
        }
        title="Show only requests slower than…"
        className="h-7 rounded-md border border-border bg-surface-raised px-1.5 text-[11px] text-text-muted focus:border-accent focus:outline-none"
      >
        <option value="">Any speed</option>
        {SLOW_PRESETS.map((preset) => (
          <option
            key={preset.ms}
            value={preset.ms}
          >{`≥ ${preset.label}`}</option>
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

      <NetworkCaptureControls />
    </div>
  );
}

function trafficFilterValue(
  protocol: NetworkProtocol | "all",
  operation: GraphQLOperationType | "all",
): string {
  if (protocol !== "graphql") return protocol;
  return operation === "all" ? "graphql" : `graphql:${operation}`;
}
