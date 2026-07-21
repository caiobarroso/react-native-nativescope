import { Lock, PanelLeftClose, PanelLeftOpen, Table2 } from "lucide-react";
import { useStudio, keysId } from "../lib/store.ts";
import { useLayout } from "../lib/layout.ts";
import { ResizeHandle } from "./ResizeHandle.tsx";

export function TableList() {
  const selection = useStudio((s) => s.selection);
  const tables = useStudio((s) =>
    selection ? s.tables[keysId(selection.providerId, selection.instanceId)] : undefined,
  );
  const selectedTable = useStudio((s) => s.selectedTable);
  const openTableTab = useStudio((s) => s.openTableTab);
  const recentChanges = useStudio((s) => s.recentChanges);
  const activityFocus = useStudio((s) => s.activityFocus);
  const size = useLayout((s) => s.panels.tableList.size);
  const collapsed = useLayout((s) => s.panels.tableList.collapsed);
  const toggleCollapsed = useLayout((s) => s.toggleCollapsed);

  if (!selection) return null;

  if (collapsed) {
    return (
      <div className="flex w-9 shrink-0 flex-col items-center border-r border-border py-2">
        <button
          onClick={() => toggleCollapsed("tableList")}
          title="Expand tables"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-subtle hover:bg-surface-hover hover:text-text"
        >
          <PanelLeftOpen size={16} strokeWidth={1.5} />
        </button>
      </div>
    );
  }

  return (
    <div
      style={{ width: size }}
      className="relative flex shrink-0 flex-col border-r border-border"
    >
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-3">
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          Tabelas
        </span>
        <button
          onClick={() => toggleCollapsed("tableList")}
          title="Collapse panel"
          className="shrink-0 rounded p-1 text-text-subtle hover:bg-surface-hover hover:text-text"
        >
          <PanelLeftClose size={14} strokeWidth={1.5} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {tables === undefined && <p className="p-4 text-text-subtle">Loading tables…</p>}
        {tables?.length === 0 && (
          <p className="p-4 text-text-subtle">No tables in this database.</p>
        )}
        {tables?.map((table) => {
          const active = table.name === selectedTable;
          const changeStamp =
            recentChanges[`${keysId(selection.providerId, selection.instanceId)} ${table.name}`];
          const flash = changeStamp && Date.now() - changeStamp < 950;
          const activityHighlighted =
            activityFocus?.providerId === selection.providerId &&
            activityFocus.instanceId === selection.instanceId &&
            activityFocus.target.kind === "database" &&
            activityFocus.target.table === table.name;
          return (
            <button
              key={`${table.name}-${changeStamp ?? 0}-${activityHighlighted ? activityFocus.token : 0}`}
              onClick={() => openTableTab(table.name)}
              className={`flex h-8 w-full shrink-0 items-center gap-2 border-l-2 px-3 text-left ${
                active
                  ? "border-accent bg-accent-wash"
                  : "border-transparent hover:bg-surface-hover"
              } ${activityHighlighted ? "rnsi-activity-focus" : flash ? "rnsi-flash" : ""}`}
            >
              <Table2 size={13} strokeWidth={1.5} className="shrink-0 text-text-subtle" />
              <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{table.name}</span>
              {table.identity === "none" && (
                <Lock
                  size={11}
                  strokeWidth={1.5}
                  className="shrink-0 text-text-subtle"
                  aria-label="read only"
                />
              )}
              <span
                className="shrink-0 text-[10px] tabular-nums text-text-subtle"
                title={
                  table.rowCountIsEstimate
                    ? "Estimated count; the exact value arrives on the next refresh"
                    : "Exact count"
                }
              >
                {table.rowCountIsEstimate ? `≈ ${table.rowCount}` : table.rowCount}
              </span>
            </button>
          );
        })}
      </div>
      <ResizeHandle panelId="tableList" edge="right" />
    </div>
  );
}
