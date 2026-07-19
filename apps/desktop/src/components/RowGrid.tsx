import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import type { CellValue, Row, RowRef } from "@rnsi/protocol";
import { useStudio, keysId } from "../lib/store.ts";
import { deleteRow, loadRows, updateCell } from "../lib/studio-client.ts";
import { SqlConsole } from "./SqlConsole.tsx";

const PAGE = 50;

function cellText(value: CellValue): string {
  if (value === null) return "NULL";
  if (typeof value === "object") return "(blob)";
  return String(value);
}

export function RowGrid() {
  const selection = useStudio((s) => s.selection);
  const selectedTable = useStudio((s) => s.selectedTable);
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
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null);
  const limitRef = useRef(PAGE);

  const readOnly = schema?.identity === "none";

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
    void refresh(PAGE);
  }, [refresh]);

  // Realtime: qualquer database.changed re-consulta a página visível.
  useEffect(() => {
    if (nonce > 0) void refresh(limitRef.current);
  }, [nonce, refresh]);

  if (!selection || !selectedTable || !schema) {
    return (
      <div className="flex flex-1 items-center justify-center text-text-subtle">
        Selecione uma tabela.
      </div>
    );
  }

  async function saveEdit(): Promise<void> {
    if (!editing || !selection || !selectedTable) return;
    const column = schema?.columns.find((c) => c.name === editing.column);
    let value: CellValue = editing.draft;
    if (editing.draft === "" || editing.draft.toUpperCase() === "NULL") {
      value = null;
    } else if (/int|real|num|dec|doub|float/i.test(column?.declaredType ?? "")) {
      const n = Number(editing.draft);
      if (Number.isFinite(n)) value = n;
    }
    try {
      await updateCell(
        selection.providerId,
        selection.instanceId,
        selectedTable,
        editing.ref,
        editing.column,
        value,
      );
      setEditing(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function removeRow(ref: RowRef): Promise<void> {
    if (!selection || !selectedTable) return;
    try {
      await deleteRow(selection.providerId, selection.instanceId, selectedTable, ref);
      setConfirmingDelete(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  const sameRef = (a: RowRef | null, b: RowRef | null) =>
    JSON.stringify(a) === JSON.stringify(b);

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
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
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="group hover:bg-surface-hover">
                {schema.columns.map((column) => {
                  const value = row.cells[column.name] ?? null;
                  const isEditing =
                    editing !== null &&
                    sameRef(editing.ref, row.ref) &&
                    editing.column === column.name;
                  return (
                    <td
                      key={column.name}
                      onDoubleClick={() => {
                        if (readOnly || row.ref === null) return;
                        setEditing({
                          ref: row.ref,
                          column: column.name,
                          draft: value === null ? "" : cellText(value),
                        });
                      }}
                      className="max-w-64 truncate border-b border-border px-3 py-1"
                    >
                      {isEditing ? (
                        <input
                          autoFocus
                          value={editing.draft}
                          onChange={(e) =>
                            setEditing((cur) => cur && { ...cur, draft: e.target.value })
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void saveEdit();
                            if (e.key === "Escape") setEditing(null);
                          }}
                          onBlur={() => setEditing(null)}
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
                      (confirmingDelete === rowIndex ? (
                        <button
                          onClick={() => row.ref && void removeRow(row.ref)}
                          className="rounded bg-deleted px-1.5 py-0.5 text-[10px] font-medium text-white"
                        >
                          confirmar
                        </button>
                      ) : (
                        <button
                          onClick={() => setConfirmingDelete(rowIndex)}
                          title="Excluir linha"
                          className="invisible rounded p-1 text-text-subtle hover:bg-deleted-wash hover:text-deleted group-hover:visible"
                        >
                          <Trash2 size={12} strokeWidth={1.5} />
                        </button>
                      ))}
                  </td>
                )}
              </tr>
            ))}
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

      <SqlConsole />
    </div>
  );
}
