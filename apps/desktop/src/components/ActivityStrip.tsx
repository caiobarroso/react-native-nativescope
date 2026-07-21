import { useMemo, useRef, useState } from "react";
import { ArrowUpRight, ChevronDown, ChevronUp, Pause, Play } from "lucide-react";
import { useStudio, type ActivityItem } from "../lib/store.ts";
import { useLayout } from "../lib/layout.ts";
import { loadKeys, loadTables } from "../lib/studio-client.ts";
import { ResizeHandle } from "./ResizeHandle.tsx";

const CHANGE_LABEL = {
  created: "created",
  updated: "updated",
  removed: "removed",
} as const;

const CHANGE_COLOR = {
  created: "text-created",
  updated: "text-updated",
  removed: "text-deleted",
} as const;

/**
 * A faixa de Atividade: persistente, dockada, atravessa todos os storages
 * (plano §5.1). Nunca um destino de navegação — está sempre aqui embaixo,
 * como o Console do Chrome DevTools.
 */
export function ActivityStrip() {
  const activity = useStudio((s) => s.activity);
  const size = useLayout((s) => s.panels.activity.size);
  const collapsed = useLayout((s) => s.panels.activity.collapsed);
  const toggleCollapsed = useLayout((s) => s.toggleCollapsed);
  const focusActivity = useStudio((s) => s.focusActivity);
  const [filter, setFilter] = useState("");
  const [paused, setPaused] = useState(false);
  /** snapshot congelado enquanto pausado — o feed continua acumulando no store */
  const frozenRef = useRef<ActivityItem[]>([]);

  if (paused && frozenRef.current.length === 0 && activity.length > 0) {
    frozenRef.current = activity;
  }

  const visible = useMemo(() => {
    const base = paused ? frozenRef.current : activity;
    if (filter.trim() === "") return base;
    const q = filter.toLowerCase();
    return base.filter(
      (item) =>
        item.key.toLowerCase().includes(q) ||
        item.providerLabel.toLowerCase().includes(q) ||
        (item.preview ?? "").toLowerCase().includes(q),
    );
  }, [activity, filter, paused]);

  const heldBack = paused ? activity.length - frozenRef.current.length : 0;

  function togglePause(): void {
    setPaused((p) => {
      if (p) frozenRef.current = [];
      else frozenRef.current = activity;
      return !p;
    });
  }

  async function openActivity(item: ActivityItem): Promise<void> {
    focusActivity(item);
    if (item.target.kind === "database") {
      await loadTables(item.providerId, item.instanceId);
    } else {
      await loadKeys(item.providerId, item.instanceId);
    }
  }

  return (
    <section
      style={collapsed ? undefined : { height: size }}
      className="relative flex shrink-0 flex-col border-t border-border bg-surface"
    >
      {!collapsed && <ResizeHandle panelId="activity" edge="top" />}
      <header className="flex h-8 shrink-0 items-center gap-2 px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          Activity
        </span>
        {visible.length > 0 && (
          <span className="text-[11px] text-text-subtle">{visible.length}</span>
        )}
        {!collapsed && (
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="filter…"
            className="ml-2 w-40 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-[11px] outline-none placeholder:text-text-subtle focus:border-border"
          />
        )}
        <button
          onClick={togglePause}
          title={paused ? "Resume" : "Pause"}
          className={`ml-auto inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-md px-1.5 text-[10px] ${
            paused
              ? "bg-accent-wash text-accent"
              : "text-text-subtle hover:bg-surface-hover hover:text-text"
          }`}
        >
          {paused ? <Play size={13} strokeWidth={1.5} /> : <Pause size={13} strokeWidth={1.5} />}
          {paused && heldBack > 0 && <span>+{heldBack}</span>}
        </button>
        <button
          onClick={() => toggleCollapsed("activity")}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-subtle hover:bg-surface-hover hover:text-text"
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? (
            <ChevronUp size={14} strokeWidth={1.5} />
          ) : (
            <ChevronDown size={14} strokeWidth={1.5} />
          )}
        </button>
      </header>

      {!collapsed && (
        <ol className="flex-1 overflow-y-auto px-1 pb-1">
          {visible.length === 0 && (
            <li className="px-2 py-3 text-text-subtle">
              {filter
                ? "Nothing matches the filter."
                : "Changes to your app storage appear here in real time."}
            </li>
          )}
          {visible.map((item) => (
            <li
              key={item.id}
              className="h-7 rounded"
            >
              <button
                type="button"
                onClick={() => void openActivity(item)}
                title={
                  item.target.kind === "database" && item.target.rowId !== null
                    ? `Open ${item.target.table} and reveal rowid ${item.target.rowId}`
                    : item.target.kind === "database"
                      ? `Open ${item.target.table}`
                      : `Open ${item.target.key}`
                }
                className="group flex h-full w-full cursor-pointer items-center gap-3 rounded px-2 text-left font-mono text-[12px] hover:bg-surface-hover focus-visible:bg-surface-hover"
              >
                <time className="shrink-0 tabular-nums text-text-subtle">
                  {new Date(item.timestamp).toLocaleTimeString("en-US")}
                </time>
                <span className="w-24 shrink-0 truncate text-text-muted">
                  {item.providerLabel}
                </span>
                <span className="min-w-0 flex-1 truncate">{item.key}</span>
                {item.coalesced !== undefined && item.coalesced > 1 && (
                  <span
                    title={`${item.coalesced} changes merged into one burst (ADR-0001)`}
                    className="shrink-0 rounded border border-border px-1 text-[10px] tabular-nums text-text-subtle"
                  >
                    ×{item.coalesced}
                  </span>
                )}
                <span
                  className={`shrink-0 ${CHANGE_COLOR[item.change]}`}
                >
                  {CHANGE_LABEL[item.change]}
                </span>
                {/* origem: ponto coral preenchido = Studio; neutro = app (§4.4) */}
                <span
                  title={item.source === "studio" ? "changed by Studio" : "changed by the app"}
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    item.source === "studio" ? "bg-accent" : "bg-text-subtle"
                  }`}
                />
                <ArrowUpRight
                  size={11}
                  strokeWidth={1.5}
                  className="shrink-0 text-text-subtle opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                  aria-hidden="true"
                />
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
