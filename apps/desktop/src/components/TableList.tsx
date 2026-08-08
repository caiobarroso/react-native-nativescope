import { AlertTriangle, Eye, Lock, PanelLeftClose, PanelLeftOpen, Table2 } from "lucide-react";
import type { TableSchema } from "@rnsi/protocol";
import { useStudio, keysId } from "../lib/store.ts";
import { useLayout } from "../lib/layout.ts";
import { tableLockLabel } from "../lib/table-permissions.ts";
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

  function renderEntry(table: TableSchema) {
    if (!selection) return null;
    const active = table.name === selectedTable;
    const changeStamp =
      recentChanges[`${keysId(selection.providerId, selection.instanceId)} ${table.name}`];
    const flash = changeStamp && Date.now() - changeStamp < 950;
    const activityHighlighted =
      activityFocus?.providerId === selection.providerId &&
      activityFocus.instanceId === selection.instanceId &&
      activityFocus.target.kind === "database" &&
      activityFocus.target.table === table.name;
    const isView = table.kind === "view";
    const broken = table.unavailable !== undefined;
    const lock = tableLockLabel(table);
    const Icon = broken ? AlertTriangle : isView ? Eye : Table2;

    return (
      <button
        key={`${table.name}-${changeStamp ?? 0}-${activityHighlighted ? activityFocus.token : 0}`}
        onClick={() => openTableTab(table.name)}
        // `dependsOn` no hover é o que torna a lista legível quando os nomes
        // reais do app são views e as tabelas físicas são encanamento.
        title={
          broken
            ? `Unavailable: ${table.unavailable}`
            : table.dependsOn && table.dependsOn.length > 0
              ? `reads: ${table.dependsOn.join(", ")}`
              : undefined
        }
        className={`flex h-8 w-full shrink-0 items-center gap-2 border-l-2 px-3 text-left ${
          active ? "border-accent bg-accent-wash" : "border-transparent hover:bg-surface-hover"
        } ${activityHighlighted ? "rnsi-activity-focus" : flash ? "rnsi-flash" : ""}`}
      >
        <Icon
          size={13}
          strokeWidth={1.5}
          className={`shrink-0 ${broken ? "text-deleted" : "text-text-subtle"}`}
        />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{table.name}</span>
        {lock !== null && !broken && (
          // Antes o cadeado tinha aria-label e nenhum title, então passar o
          // mouse não dizia nada. E o motivo agora é específico: "sem rowid"
          // mandaria o usuário procurar uma PK que numa view nunca existe.
          <span className="shrink-0" title={lock}>
            <Lock size={11} strokeWidth={1.5} className="text-text-subtle" aria-label={lock} />
          </span>
        )}
        {!broken && (
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
        )}
      </button>
    );
  }

  const plain = (tables ?? []).filter((table) => table.kind !== "view");
  const views = (tables ?? []).filter((table) => table.kind === "view");

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
          Tables
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
        {plain.map(renderEntry)}
        {/* O cabeçalho só existe quando há view. Num app que não usa view a
            lista sai idêntica à de antes — nem um pixel a mais. */}
        {views.length > 0 && (
          <div className="mt-1 flex h-7 items-center border-t border-border px-3 pt-1 text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
            Views
          </div>
        )}
        {views.map(renderEntry)}
      </div>
      <ResizeHandle panelId="tableList" edge="right" />
    </div>
  );
}
