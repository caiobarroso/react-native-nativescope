import { Lock, Table2 } from "lucide-react";
import { useStudio, keysId } from "../lib/store.ts";

export function TableList() {
  const selection = useStudio((s) => s.selection);
  const tables = useStudio((s) =>
    selection ? s.tables[keysId(selection.providerId, selection.instanceId)] : undefined,
  );
  const selectedTable = useStudio((s) => s.selectedTable);
  const openTableTab = useStudio((s) => s.openTableTab);
  const recentChanges = useStudio((s) => s.recentChanges);

  if (!selection) return null;

  return (
    <div className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-border">
      {tables === undefined && <p className="p-4 text-text-subtle">Carregando tabelas…</p>}
      {tables?.length === 0 && (
        <p className="p-4 text-text-subtle">Nenhuma tabela neste banco.</p>
      )}
      {tables?.map((table) => {
        const active = table.name === selectedTable;
        const changeStamp = recentChanges[`${keysId(selection.providerId, selection.instanceId)} ${table.name}`];
        const flash = changeStamp && Date.now() - changeStamp < 950;
        return (
          <button
            key={`${table.name}-${changeStamp ?? 0}`}
            onClick={() => openTableTab(table.name)}
            className={`flex h-8 shrink-0 items-center gap-2 border-l-2 px-3 text-left ${
              active
                ? "border-accent bg-accent-wash"
                : "border-transparent hover:bg-surface-hover"
            } ${flash ? "rnsi-flash" : ""}`}
          >
            <Table2 size={13} strokeWidth={1.5} className="shrink-0 text-text-subtle" />
            <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{table.name}</span>
            {table.identity === "none" && (
              <Lock
                size={11}
                strokeWidth={1.5}
                className="shrink-0 text-text-subtle"
                aria-label="somente leitura"
              />
            )}
            <span className="shrink-0 text-[10px] tabular-nums text-text-subtle">
              {table.rowCountIsEstimate ? "~" : ""}
              {table.rowCount}
            </span>
          </button>
        );
      })}
    </div>
  );
}
