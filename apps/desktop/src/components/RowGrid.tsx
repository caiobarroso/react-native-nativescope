import { Suspense, lazy, memo, useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Table2, Trash2, X } from "lucide-react";
import type { CellValue, Row, RowRef, TableSchema } from "@rnsi/protocol";
import { useStudio, keysId } from "../lib/store.ts";
import { deleteRow, loadRows, updateCell } from "../lib/studio-client.ts";

const PAGE = 50;
const EMPTY_TABS: string[] = [];
const SqlConsole = lazy(() =>
  import("./SqlConsole.tsx").then((module) => ({ default: module.SqlConsole })),
);

function cellText(value: CellValue): string {
  if (value === null) return "NULL";
  if (typeof value === "object") return "(blob)";
  return String(value);
}

function refKey(ref: RowRef | null): string | null {
  return ref ? JSON.stringify(ref) : null;
}

function TableTabs({
  tabs,
  selectedTable,
  onSelect,
  onClose,
}: {
  tabs: string[];
  selectedTable: string | null;
  onSelect: (table: string | null) => void;
  onClose: (table: string) => void;
}) {
  return (
    <div className="flex h-10 shrink-0 items-end overflow-x-auto border-b border-border bg-surface-sunken px-2">
      {tabs.length === 0 ? (
        <div className="flex h-full items-center gap-2 px-2 text-[12px] text-text-subtle">
          <Table2 size={13} strokeWidth={1.5} />
          Abra uma tabela pela lista lateral
        </div>
      ) : (
        tabs.map((table) => {
          const active = table === selectedTable;
          return (
            <div
              key={table}
              className={`group flex h-9 min-w-32 max-w-52 items-center gap-2 border border-b-0 px-3 ${
                active
                  ? "border-border bg-surface text-text"
                  : "border-transparent text-text-muted hover:bg-surface-hover"
              }`}
            >
              <button
                onClick={() => onSelect(table)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                title={table}
              >
                <Table2 size={13} strokeWidth={1.5} className="shrink-0" />
                <span className="truncate font-mono text-[12px]">{table}</span>
              </button>
              <button
                onClick={() => onClose(table)}
                title="Fechar tab"
                className="rounded p-0.5 text-text-subtle opacity-60 hover:bg-surface-hover hover:text-text group-hover:opacity-100"
              >
                <X size={12} strokeWidth={1.5} />
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}

/**
 * Linha memoizada: marcar um checkbox ou digitar numa célula re-renderiza
 * só as linhas afetadas, não a página inteira. `editingCell` chega null
 * para todas as linhas exceto a em edição — é o que faz o memo funcionar.
 */
const GridRow = memo(function GridRow({
  row,
  columns,
  readOnly,
  checked,
  confirming,
  editingCell,
  onToggle,
  onStartEdit,
  onDraftChange,
  onCommitEdit,
  onCancelEdit,
  onAskDelete,
  onConfirmDelete,
}: {
  row: Row;
  columns: TableSchema["columns"];
  readOnly: boolean;
  checked: boolean;
  confirming: boolean;
  editingCell: { column: string; draft: string } | null;
  onToggle: (ref: RowRef) => void;
  onStartEdit: (ref: RowRef, column: string, draft: string) => void;
  onDraftChange: (draft: string) => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onAskDelete: (key: string) => void;
  onConfirmDelete: (ref: RowRef) => void;
}) {
  const key = refKey(row.ref);
  return (
    <tr className={`group hover:bg-surface-hover ${checked ? "bg-accent-wash/60" : ""}`}>
      {!readOnly && (
        <td className="w-9 border-b border-border px-2 text-center">
          {row.ref !== null && (
            <input
              type="checkbox"
              checked={checked}
              onChange={() => row.ref && onToggle(row.ref)}
              aria-label="Selecionar linha"
              className="h-3.5 w-3.5 rounded border-border accent-accent"
            />
          )}
        </td>
      )}
      {columns.map((column) => {
        const value = row.cells[column.name] ?? null;
        const isEditing = editingCell?.column === column.name;
        return (
          <td
            key={column.name}
            onDoubleClick={() => {
              if (readOnly || row.ref === null) return;
              onStartEdit(row.ref, column.name, value === null ? "" : cellText(value));
            }}
            className="max-w-64 truncate border-b border-border px-3 py-1"
          >
            {isEditing && editingCell ? (
              <input
                autoFocus
                value={editingCell.draft}
                onChange={(e) => onDraftChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onCommitEdit();
                  if (e.key === "Escape") onCancelEdit();
                }}
                onBlur={onCancelEdit}
                className="w-full rounded border border-accent bg-surface-raised px-1 py-0.5 font-mono text-[12px] outline-none"
              />
            ) : value === null ? (
              <span className="text-text-subtle">NULL</span>
            ) : (
              cellText(value)
            )}
          </td>
        );
      })}
      {!readOnly && (
        <td className="border-b border-border px-1">
          {row.ref !== null &&
            key !== null &&
            (confirming ? (
              <button
                onClick={() => row.ref && onConfirmDelete(row.ref)}
                className="rounded bg-deleted px-1.5 py-0.5 text-[10px] font-medium text-white"
              >
                confirmar
              </button>
            ) : (
              <button
                onClick={() => onAskDelete(key)}
                title="Excluir linha"
                className="invisible rounded p-1 text-text-subtle hover:bg-deleted-wash hover:text-deleted group-hover:visible"
              >
                <Trash2 size={12} strokeWidth={1.5} />
              </button>
            ))}
        </td>
      )}
    </tr>
  );
});

export function RowGrid() {
  const selection = useStudio((s) => s.selection);
  const selectedTable = useStudio((s) => s.selectedTable);
  const tableTabsId = selection ? keysId(selection.providerId, selection.instanceId) : null;
  const tableTabs = useStudio((s) =>
    tableTabsId ? (s.tableTabs[tableTabsId] ?? EMPTY_TABS) : EMPTY_TABS,
  );
  const selectTable = useStudio((s) => s.selectTable);
  const closeTableTab = useStudio((s) => s.closeTableTab);
  const schema = useStudio((s) =>
    selection && s.selectedTable
      ? s.tables[keysId(selection.providerId, selection.instanceId)]?.find(
          (t) => t.name === s.selectedTable,
        )
      : undefined,
  );
  const nonce = useStudio((s) => s.dbRefreshNonce);

  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ ref: RowRef; column: string; draft: string } | null>(
    null,
  );
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(() => new Set());
  const limitRef = useRef(PAGE);
  // saveEdit lê o draft daqui para manter identidade estável — sem isso,
  // cada tecla digitada trocaria o callback e re-renderizaria todas as rows.
  const editingRef = useRef(editing);
  editingRef.current = editing;

  const readOnly = schema?.identity === "none";
  const selectableRows = rows.filter((row) => row.ref !== null);
  const selectedVisibleRows = selectableRows.filter((row) => {
    const key = refKey(row.ref);
    return key !== null && selectedRows.has(key);
  });
  const allVisibleSelected =
    selectableRows.length > 0 &&
    selectedVisibleRows.length === selectableRows.length;

  const refresh = useCallback(
    async (limit: number) => {
      if (!selection || !selectedTable) return;
      setLoading(true);
      setError(null);
      try {
        const page = await loadRows(selection.providerId, selection.instanceId, selectedTable, {
          limit,
          offset: 0,
        });
        if (page) {
          setRows(page.rows);
          setTotal(page.total);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setLoading(false);
      }
    },
    [selection, selectedTable],
  );

  useEffect(() => {
    limitRef.current = PAGE;
    setEditing(null);
    setConfirmingDelete(null);
    setSelectedRows(new Set());
    void refresh(PAGE);
  }, [refresh]);

  useEffect(() => {
    setSelectedRows((current) => {
      const visible = new Set(rows.map((row) => refKey(row.ref)).filter(Boolean) as string[]);
      const next = new Set([...current].filter((key) => visible.has(key)));
      const unchanged = next.size === current.size && [...next].every((key) => current.has(key));
      return unchanged ? current : next;
    });
  }, [rows]);

  // Realtime: qualquer database.changed re-consulta a página visível.
  useEffect(() => {
    if (nonce > 0) void refresh(limitRef.current);
  }, [nonce, refresh]);

  const onStartEdit = useCallback((ref: RowRef, column: string, draft: string) => {
    setEditing({ ref, column, draft });
  }, []);
  const onDraftChange = useCallback((draft: string) => {
    setEditing((cur) => (cur ? { ...cur, draft } : cur));
  }, []);
  const onCancelEdit = useCallback(() => setEditing(null), []);
  const onAskDelete = useCallback((key: string) => setConfirmingDelete(key), []);
  const onToggleRow = useCallback((ref: RowRef) => {
    const key = refKey(ref);
    if (!key) return;
    setSelectedRows((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const saveEdit = useCallback(async (): Promise<void> => {
    const current = editingRef.current;
    if (!current || !selection || !selectedTable) return;
    const column = schema?.columns.find((c) => c.name === current.column);
    let value: CellValue = current.draft;
    if (current.draft === "" || current.draft.toUpperCase() === "NULL") {
      value = null;
    } else if (/int|real|num|dec|doub|float/i.test(column?.declaredType ?? "")) {
      const n = Number(current.draft);
      if (Number.isFinite(n)) value = n;
    }
    try {
      await updateCell(
        selection.providerId,
        selection.instanceId,
        selectedTable,
        current.ref,
        current.column,
        value,
      );
      setEditing(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [selection, selectedTable, schema]);
  const onCommitEdit = useCallback(() => void saveEdit(), [saveEdit]);

  const onConfirmDelete = useCallback(
    (ref: RowRef) => {
      void (async () => {
        if (!selection || !selectedTable) return;
        try {
          await deleteRow(selection.providerId, selection.instanceId, selectedTable, ref);
          setConfirmingDelete(null);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })();
    },
    [selection, selectedTable],
  );

  // Early returns SÓ depois de todos os hooks (regras de hooks).
  if (!selection) {
    return null;
  }

  if (!selectedTable || !schema) {
    return (
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TableTabs
          tabs={tableTabs}
          selectedTable={selectedTable}
          onSelect={selectTable}
          onClose={closeTableTab}
        />
        <div className="flex flex-1 items-center justify-center text-text-subtle">
          Selecione uma tabela para abrir em uma tab.
        </div>
      </div>
    );
  }

  async function deleteSelectedRows(): Promise<void> {
    if (!selection || !selectedTable || selectedVisibleRows.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      for (const row of selectedVisibleRows) {
        if (row.ref) {
          await deleteRow(selection.providerId, selection.instanceId, selectedTable, row.ref);
        }
      }
      setSelectedRows(new Set());
      await refresh(limitRef.current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  function toggleVisibleRows(): void {
    setSelectedRows((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        for (const row of selectableRows) {
          const key = refKey(row.ref);
          if (key) next.delete(key);
        }
      } else {
        for (const row of selectableRows) {
          const key = refKey(row.ref);
          if (key) next.add(key);
        }
      }
      return next;
    });
  }

  const sameRef = (a: RowRef | null, b: RowRef | null) =>
    JSON.stringify(a) === JSON.stringify(b);

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <TableTabs
        tabs={tableTabs}
        selectedTable={selectedTable}
        onSelect={selectTable}
        onClose={closeTableTab}
      />
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="font-mono text-[12px] font-semibold">{selectedTable}</span>
        <span className="text-[11px] tabular-nums text-text-subtle">
          {rows.length} de {total}
        </span>
        {selectedVisibleRows.length > 0 && (
          <>
            <span className="ml-2 rounded border border-border bg-surface-sunken px-1.5 py-0.5 text-[11px] text-text-muted">
              {selectedVisibleRows.length} selecionada
              {selectedVisibleRows.length > 1 ? "s" : ""}
            </span>
            <button
              onClick={() => void deleteSelectedRows()}
              disabled={loading || readOnly}
              className="inline-flex items-center gap-1 rounded border border-deleted/30 bg-deleted-wash px-2 py-1 text-[11px] font-medium text-deleted disabled:opacity-40"
            >
              <Trash2 size={12} strokeWidth={1.5} />
              Deletar
            </button>
            <button
              onClick={() => setSelectedRows(new Set())}
              className="rounded px-2 py-1 text-[11px] text-text-subtle hover:bg-surface-hover hover:text-text"
            >
              Limpar seleção
            </button>
          </>
        )}
        <button
          onClick={() => void refresh(limitRef.current)}
          disabled={loading}
          title="Recarregar linhas"
          className="ml-auto rounded p-1 text-text-subtle hover:bg-surface-hover hover:text-text disabled:opacity-40"
        >
          <RefreshCw size={14} strokeWidth={1.5} />
        </button>
      </div>
      {readOnly && (
        <div className="shrink-0 border-b border-border bg-surface-sunken px-4 py-2 text-[12px] text-text-muted">
          Somente leitura: esta tabela não tem rowid nem chave primária — não há
          identidade estável para editar linhas com segurança.
        </div>
      )}
      {error && (
        <div className="shrink-0 border-b border-border px-4 py-2 text-[12px] text-deleted">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse font-mono text-[12px]">
          <thead className="sticky top-0 bg-surface">
            <tr>
              {!readOnly && (
                <th className="w-9 border-b border-border px-2 py-1.5">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleVisibleRows}
                    aria-label="Selecionar linhas visíveis"
                    className="h-3.5 w-3.5 rounded border-border accent-accent"
                  />
                </th>
              )}
              {schema.columns.map((column) => (
                <th
                  key={column.name}
                  className="border-b border-border px-3 py-1.5 text-left font-semibold"
                >
                  {column.name}
                  {column.pkIndex > 0 && (
                    <span className="ml-1 text-[10px] font-normal text-accent">pk</span>
                  )}
                </th>
              ))}
              {!readOnly && <th className="w-8 border-b border-border" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => {
              const key = refKey(row.ref);
              return (
                <GridRow
                  key={key ?? rowIndex}
                  row={row}
                  columns={schema.columns}
                  readOnly={readOnly}
                  checked={key !== null && selectedRows.has(key)}
                  confirming={key !== null && confirmingDelete === key}
                  editingCell={
                    editing !== null && sameRef(editing.ref, row.ref)
                      ? { column: editing.column, draft: editing.draft }
                      : null
                  }
                  onToggle={onToggleRow}
                  onStartEdit={onStartEdit}
                  onDraftChange={onDraftChange}
                  onCommitEdit={onCommitEdit}
                  onCancelEdit={onCancelEdit}
                  onAskDelete={onAskDelete}
                  onConfirmDelete={onConfirmDelete}
                />
              );
            })}
          </tbody>
        </table>

        {rows.length === 0 && !loading && (
          <p className="p-4 text-[12px] text-text-subtle">Tabela vazia.</p>
        )}
        {rows.length < total && (
          <button
            onClick={() => {
              limitRef.current += PAGE;
              void refresh(limitRef.current);
            }}
            className="m-3 rounded-md border border-border px-3 py-1.5 text-[12px] text-text-muted hover:bg-surface-hover"
          >
            Carregar mais ({rows.length} de {total})
          </button>
        )}
      </div>

      <Suspense
        fallback={
          <section className="shrink-0 border-t border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
            SQL
          </section>
        }
      >
        <SqlConsole />
      </Suspense>
    </div>
  );
}
