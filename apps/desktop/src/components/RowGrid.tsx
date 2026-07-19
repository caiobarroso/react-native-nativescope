import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Braces,
  Plus,
  RefreshCw,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnSizingState,
  type SortingState,
} from "@tanstack/react-table";
import type { CellValue, Row, RowRef, TableSchema } from "@rnsi/protocol";
import { useStudio, keysId } from "../lib/store.ts";
import { deleteRow, getFullCell, insertRow, loadRows, updateCell } from "../lib/studio-client.ts";
import { JsonWorkspace } from "./ValueEditor.tsx";

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

function sameRef(a: RowRef | null, b: RowRef | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface TableToastState {
  id: number;
  message: string;
  undo?: () => Promise<void>;
}

interface InsertDraft {
  values: Record<string, string>;
  useNull: Set<string>;
}

interface JsonCellState {
  ref: RowRef;
  column: string;
  table: string;
  draft: string;
  original: string;
}

type SqlColumn = TableSchema["columns"][number];

interface GridColumnMeta {
  kind?: "select" | "actions";
  schemaColumn?: SqlColumn;
}

function parseDraftValue(raw: string, columnType: string): CellValue {
  const value = raw.trim();
  if (/int|real|num|dec|doub|float/i.test(columnType)) {
    const n = Number(value);
    return Number.isFinite(n) ? n : raw;
  }
  return raw;
}

function jsonDraft(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function isJsonCell(value: CellValue, column: SqlColumn): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (/json/i.test(column.declaredType)) return true;
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null;
  } catch {
    return false;
  }
}

function InsertRowDrawer({
  table,
  columns,
  draft,
  saving,
  error,
  onDraftChange,
  onToggleNull,
  onClose,
  onSave,
}: {
  table: string;
  columns: TableSchema["columns"];
  draft: InsertDraft;
  saving: boolean;
  error: string | null;
  onDraftChange: (column: string, value: string) => void;
  onToggleNull: (column: string) => void;
  onClose: () => void;
  onSave: (createMore: boolean) => void;
}) {
  const [createMore, setCreateMore] = useState(false);

  return (
    <aside className="rnsi-drawer-in absolute inset-y-0 right-0 z-30 flex w-[min(520px,100%)] flex-col border-l border-border bg-surface-raised shadow-xl shadow-black/10">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <span className="text-[13px] font-medium">Adicionar linha em</span>
        <span className="rounded border border-border bg-surface-sunken px-1.5 py-0.5 font-mono text-[12px]">
          {table}
        </span>
        <button
          onClick={onClose}
          className="ml-auto rounded p-1 text-text-subtle hover:bg-surface-hover hover:text-text"
          title="Fechar"
        >
          <X size={15} strokeWidth={1.5} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="flex flex-col gap-5">
          {columns.map((column) => {
            const checkedNull = draft.useNull.has(column.name);
            const required = column.notNull && column.pkIndex === 0;
            return (
              <div key={column.name} className="grid grid-cols-[170px_1fr] gap-4">
                <div className="min-w-0">
                  <div className="truncate font-mono text-[12px] text-text">{column.name}</div>
                  <div className="mt-1 text-[11px] text-text-subtle">
                    {column.declaredType || "sem tipo"}
                    {column.pkIndex > 0 ? " · pk" : ""}
                    {required ? " · obrigatório" : ""}
                  </div>
                </div>
                <div className="min-w-0">
                  <input
                    value={draft.values[column.name] ?? ""}
                    onChange={(event) => onDraftChange(column.name, event.target.value)}
                    disabled={checkedNull}
                    placeholder={checkedNull ? "NULL" : required ? "valor obrigatório" : "deixar vazio usa default"}
                    className="h-9 w-full rounded-md border border-border bg-surface px-3 font-mono text-[12px] outline-none placeholder:text-text-subtle focus:border-accent disabled:text-text-subtle"
                  />
                  <label className="mt-1.5 flex items-center gap-2 text-[11px] text-text-subtle">
                    <input
                      type="checkbox"
                      checked={checkedNull}
                      onChange={() => onToggleNull(column.name)}
                      disabled={column.notNull}
                      className="h-3.5 w-3.5 accent-accent disabled:opacity-40"
                    />
                    Inserir NULL
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="shrink-0 border-t border-border px-4 py-2 text-[12px] text-deleted">
          {error}
        </div>
      )}

      <footer className="flex h-12 shrink-0 items-center gap-3 border-t border-border px-4">
        <button
          onClick={() => setCreateMore((value) => !value)}
          type="button"
          role="switch"
          aria-checked={createMore}
          data-checked={createMore}
          className="rnsi-switch"
        />
        <span className="text-[12px] text-text-muted">Criar mais</span>
        <button
          onClick={onClose}
          className="ml-auto h-8 min-w-20 rounded-md border border-border px-3 text-[12px] text-text-muted hover:bg-surface-hover"
        >
          Cancelar
        </button>
        <button
          onClick={() => onSave(createMore)}
          disabled={saving}
          className="h-8 min-w-20 rounded-md bg-accent px-3 text-[12px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {saving ? "Salvando..." : "Salvar"}
        </button>
      </footer>
    </aside>
  );
}

function TableToast({
  toast,
  onClose,
}: {
  toast: TableToastState;
  onClose: () => void;
}) {
  const [undoing, setUndoing] = useState(false);

  return (
    <div className="rnsi-snackbar pointer-events-auto absolute bottom-3 right-3 z-20 flex min-h-11 w-[min(360px,calc(100%-24px))] items-center gap-2 rounded-md border border-border-strong bg-surface-sunken px-3 py-2 text-[12px] text-text shadow-md shadow-black/5">
      <span className="min-w-0 flex-1 truncate font-medium">{toast.message}</span>
      {toast.undo && (
        <button
          onClick={() => {
            setUndoing(true);
            void toast.undo?.().finally(() => {
              setUndoing(false);
              onClose();
            });
          }}
          disabled={undoing}
          className="shrink-0 font-medium text-accent underline decoration-accent/45 underline-offset-3 hover:text-accent-hover disabled:opacity-50"
        >
          {undoing ? "desfazendo..." : "desfazer"}
        </button>
      )}
      <button
        onClick={onClose}
        title="Fechar"
        className="shrink-0 rounded p-0.5 text-text-muted hover:bg-surface-hover hover:text-text"
      >
        <X size={13} strokeWidth={1.5} />
      </button>
    </div>
  );
}

function JsonCellModal({
  cell,
  saving,
  error,
  onDraftChange,
  onClose,
  onSave,
}: {
  cell: JsonCellState;
  saving: boolean;
  error: string | null;
  onDraftChange: (draft: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 px-4 pt-12"
      onClick={onClose}
    >
      <section
        className="flex h-[min(82vh,840px)] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-border bg-surface-raised shadow-xl shadow-black/15"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
          <Braces size={15} strokeWidth={1.5} className="text-accent" />
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-semibold">JSON da célula</h2>
            <p className="truncate font-mono text-[11px] text-text-subtle">
              {cell.table}.{cell.column}
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-auto rounded p-1 text-text-subtle hover:bg-surface-hover hover:text-text"
            title="Fechar"
          >
            <X size={15} strokeWidth={1.5} />
          </button>
        </header>

        <div className="min-h-0 flex-1 p-4">
          <JsonWorkspace
            draft={cell.draft}
            onDraftChange={onDraftChange}
            sourceName={cell.column}
            minHeight="min-h-0"
          />
        </div>

        <footer className="flex h-12 shrink-0 items-center gap-3 border-t border-border px-4">
          {error && <span className="min-w-0 flex-1 truncate text-[12px] text-deleted">{error}</span>}
          {!error && (
            <span className="min-w-0 flex-1 truncate text-[11px] text-text-subtle">
              Salvar grava o JSON formatado de volta na célula.
            </span>
          )}
          <button
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-[12px] text-text-muted hover:bg-surface-hover"
          >
            Cancelar
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? "Salvando..." : "Salvar JSON"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function SortableTableTab({
  table,
  active,
  onSelect,
  onClose,
}: {
  table: string;
  active: boolean;
  onSelect: (table: string) => void;
  onClose: (table: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: table,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`group flex h-9 min-w-32 max-w-52 touch-none select-none items-center gap-2 border border-b-0 px-3 ${
        active
          ? "border-border bg-surface text-text"
          : "border-transparent text-text-muted hover:bg-surface-hover"
      } ${isDragging ? "scale-[1.02] shadow-lg shadow-black/10" : ""}`}
    >
      <button
        onClick={() => onSelect(table)}
        className="flex min-w-0 flex-1 cursor-grab items-center gap-2 text-left active:cursor-grabbing"
        title={table}
      >
        <Table2 size={13} strokeWidth={1.5} className="shrink-0" />
        <span className="truncate font-mono text-[12px]">{table}</span>
      </button>
      <button
        onClick={(event) => {
          event.stopPropagation();
          onClose(table);
        }}
        title="Fechar tab"
        className="rounded p-0.5 text-text-subtle opacity-60 hover:bg-surface-hover hover:text-text group-hover:opacity-100"
      >
        <X size={12} strokeWidth={1.5} />
      </button>
    </div>
  );
}

function TableTabs({
  tabs,
  selectedTable,
  onSelect,
  onClose,
  onReorder,
}: {
  tabs: string[];
  selectedTable: string | null;
  onSelect: (table: string | null) => void;
  onClose: (table: string) => void;
  onReorder: (tabs: string[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  function handleDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = tabs.indexOf(String(active.id));
    const newIndex = tabs.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(tabs, oldIndex, newIndex));
  }

  return (
    <div className="flex h-10 shrink-0 items-end overflow-x-auto border-b border-border bg-surface-sunken px-2">
      {tabs.length === 0 ? (
        <div className="flex h-full items-center gap-2 px-2 text-[12px] text-text-subtle">
          <Table2 size={13} strokeWidth={1.5} />
          Abra uma tabela pela lista lateral
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={tabs} strategy={horizontalListSortingStrategy}>
            {tabs.map((table) => (
              <SortableTableTab
                key={table}
                table={table}
                active={table === selectedTable}
                onSelect={onSelect}
                onClose={onClose}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

export function RowGrid() {
  const selection = useStudio((s) => s.selection);
  const selectedTable = useStudio((s) => s.selectedTable);
  const tableTabsId = selection ? keysId(selection.providerId, selection.instanceId) : null;
  const tableTabs = useStudio((s) =>
    tableTabsId ? (s.tableTabs[tableTabsId] ?? EMPTY_TABS) : EMPTY_TABS,
  );
  const selectTable = useStudio((s) => s.selectTable);
  const closeTableTab = useStudio((s) => s.closeTableTab);
  const reorderTableTabs = useStudio((s) => s.reorderTableTabs);
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
  const [totalIsEstimate, setTotalIsEstimate] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ ref: RowRef; column: string; draft: string } | null>(
    null,
  );
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(() => new Set());
  const [toast, setToast] = useState<TableToastState | null>(null);
  const [insertOpen, setInsertOpen] = useState(false);
  const [insertDraft, setInsertDraft] = useState<InsertDraft>({
    values: {},
    useNull: new Set(),
  });
  const [insertError, setInsertError] = useState<string | null>(null);
  const [insertSaving, setInsertSaving] = useState(false);
  const [jsonCell, setJsonCell] = useState<JsonCellState | null>(null);
  const [jsonSaving, setJsonSaving] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const limitRef = useRef(PAGE);
  const nextToastId = useRef(1);
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

  const showToast = useCallback((input: Omit<TableToastState, "id">) => {
    setToast({ id: nextToastId.current++, ...input });
  }, []);

  const refresh = useCallback(
    async (limit: number) => {
      if (!selection || !selectedTable) return;
      setLoading(true);
      setError(null);
      try {
        const sort = sorting[0];
        const orderBy = sort
          ? schema?.columns.find((column) => column.name === sort.id)?.name
          : undefined;
        const page = await loadRows(selection.providerId, selection.instanceId, selectedTable, {
          limit,
          offset: 0,
          ...(orderBy ? { orderBy, direction: sort?.desc ? "desc" : "asc" } : {}),
        });
        if (page) {
          setRows(page.rows);
          setTotal(page.total);
          setTotalIsEstimate(page.totalIsEstimate ?? false);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setLoading(false);
      }
    },
    [selection, selectedTable, sorting, schema?.columns],
  );

  /**
   * Próxima página ANEXADA à janela: keyset (rowid > último) quando não há
   * ordenação — página 100k custa igual à página 1 no device. Com ordenação,
   * OFFSET real (nunca o refetch-do-zero com limit crescente).
   */
  const loadMore = useCallback(async () => {
    if (!selection || !selectedTable || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const sort = sorting[0];
      const orderBy = sort
        ? schema?.columns.find((column) => column.name === sort.id)?.name
        : undefined;
      const last = rows[rows.length - 1];
      const keysetCursor =
        !orderBy && last?.ref && "rowid" in last.ref ? last.ref.rowid : undefined;
      const page = await loadRows(selection.providerId, selection.instanceId, selectedTable, {
        limit: PAGE,
        offset: keysetCursor !== undefined ? 0 : rows.length,
        ...(keysetCursor !== undefined ? { afterRowid: keysetCursor } : {}),
        ...(orderBy ? { orderBy, direction: sort?.desc ? "desc" : "asc" } : {}),
      });
      if (page) {
        setRows((current) => [...current, ...page.rows]);
        setTotal(page.total);
        setTotalIsEstimate(page.totalIsEstimate ?? false);
        limitRef.current = rows.length + page.rows.length;
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoadingMore(false);
    }
  }, [selection, selectedTable, sorting, schema?.columns, rows, loadingMore]);

  /** Célula truncada: busca o conteúdo completo via stream antes de usar. */
  const loadFullCellText = useCallback(
    async (ref: RowRef, column: string): Promise<string | null> => {
      if (!selection || !selectedTable) return null;
      const cell = await getFullCell(
        selection.providerId,
        selection.instanceId,
        selectedTable,
        ref,
        column,
      );
      return cell?.data ?? null;
    },
    [selection, selectedTable],
  );

  useEffect(() => {
    limitRef.current = PAGE;
    setEditing(null);
    setConfirmingDelete(null);
    setSelectedRows(new Set());
    setInsertOpen(false);
    setInsertError(null);
    setInsertDraft({ values: {}, useNull: new Set() });
    setJsonCell(null);
    setJsonError(null);
    void refresh(PAGE);
  }, [refresh]);

  useEffect(() => {
    setSorting([]);
    setColumnSizing({});
  }, [selectedTable]);

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

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast((current) => (current?.id === toast.id ? null : current)), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

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
  const toggleVisibleRows = useCallback(() => {
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
  }, [allVisibleSelected, selectableRows]);

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
      const rowBefore = rows.find((row) => sameRef(row.ref, current.ref));
      const previous = rowBefore?.cells[current.column] ?? null;
      showToast({
        message: "Célula atualizada",
        undo: async () => {
          await updateCell(
            selection.providerId,
            selection.instanceId,
            selectedTable,
            current.ref,
            current.column,
            previous,
          );
          await refresh(limitRef.current);
        },
      });
      setEditing(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [selection, selectedTable, schema, rows, showToast, refresh]);
  const onCommitEdit = useCallback(() => void saveEdit(), [saveEdit]);

  const onConfirmDelete = useCallback(
    (ref: RowRef) => {
      void (async () => {
        if (!selection || !selectedTable) return;
        const deleted = rows.find((row) => sameRef(row.ref, ref));
        try {
          await deleteRow(selection.providerId, selection.instanceId, selectedTable, ref);
          setConfirmingDelete(null);
          // Linha com célula truncada: o undo re-inseriria dados cortados.
          const undoSafe = deleted && (deleted.truncatedColumns?.length ?? 0) === 0;
          showToast({
            message: undoSafe
              ? "Linha deletada"
              : "Linha deletada (sem desfazer: célula grande truncada)",
            undo: undoSafe && deleted
              ? async () => {
                  await insertRow(
                    selection.providerId,
                    selection.instanceId,
                    selectedTable,
                    deleted.cells,
                  );
                  await refresh(limitRef.current);
                }
              : undefined,
          });
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })();
    },
    [selection, selectedTable, rows, showToast, refresh],
  );

  const tableColumns = useMemo<ColumnDef<Row>[]>(
    () => {
      const dataColumns: ColumnDef<Row>[] = (schema?.columns ?? []).map((schemaColumn) => ({
        id: schemaColumn.name,
        accessorFn: (row) => row.cells[schemaColumn.name] ?? null,
        enableSorting: true,
        enableResizing: true,
        minSize: 96,
        size: Math.min(260, Math.max(140, schemaColumn.name.length * 11 + 92)),
        maxSize: 560,
        meta: { schemaColumn } satisfies GridColumnMeta,
        cell: ({ getValue, row }) => {
          const value = getValue<CellValue>() ?? null;
          const rowRef = row.original.ref;
          const isTruncated =
            row.original.truncatedColumns?.includes(schemaColumn.name) ?? false;
          const isEditing =
            editing !== null &&
            sameRef(editing.ref, rowRef) &&
            editing.column === schemaColumn.name;

          if (isEditing) {
            return (
              <input
                autoFocus
                value={editing.draft}
                onChange={(event) => onDraftChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onCommitEdit();
                  if (event.key === "Escape") onCancelEdit();
                }}
                onBlur={onCancelEdit}
                className="h-7 w-full rounded-sm border border-accent bg-surface-raised px-2 font-mono text-[12px] outline-none focus-visible:outline-none"
              />
            );
          }

          const canOpenJson = rowRef !== null && !isTruncated && isJsonCell(value, schemaColumn);

          return (
            <div className="flex h-8 min-w-0 items-center">
              <button
                type="button"
                onDoubleClick={() => {
                  if (readOnly || rowRef === null) return;
                  if (isTruncated) {
                    // Editar sobre preview truncado corromperia — carrega o
                    // conteúdo completo (stream) antes de abrir a edição.
                    void loadFullCellText(rowRef, schemaColumn.name).then((full) => {
                      if (full !== null) onStartEdit(rowRef, schemaColumn.name, full);
                    });
                    return;
                  }
                  onStartEdit(rowRef, schemaColumn.name, value === null ? "" : cellText(value));
                }}
                title={value === null ? "NULL" : cellText(value)}
                className={`block h-full min-w-0 flex-1 truncate px-3 text-left ${
                  readOnly || rowRef === null ? "cursor-default" : "cursor-text"
                } ${value === null ? "text-text-subtle" : "text-text"}`}
              >
                {value === null ? "NULL" : cellText(value)}
              </button>
              {canOpenJson && (
                <button
                  type="button"
                  onClick={() => {
                    setJsonError(null);
                    setJsonCell({
                      ref: rowRef,
                      column: schemaColumn.name,
                      table: selectedTable ?? "",
                      original: value,
                      draft: jsonDraft(value),
                    });
                  }}
                  title="Abrir JSON"
                  className="mr-1 shrink-0 rounded p-1 text-text-subtle opacity-70 hover:bg-accent-wash hover:text-accent group-hover:opacity-100"
                >
                  <Braces size={12} strokeWidth={1.5} />
                </button>
              )}
              {isTruncated && rowRef !== null && (
                <button
                  type="button"
                  onClick={() => {
                    void loadFullCellText(rowRef, schemaColumn.name).then((full) => {
                      if (full === null) return;
                      try {
                        JSON.parse(full);
                        setJsonError(null);
                        setJsonCell({
                          ref: rowRef,
                          column: schemaColumn.name,
                          table: selectedTable ?? "",
                          original: full,
                          draft: jsonDraft(full),
                        });
                      } catch {
                        if (!readOnly) onStartEdit(rowRef, schemaColumn.name, full);
                      }
                    });
                  }}
                  title="Célula grande (preview) — carregar conteúdo completo"
                  className="mr-1 shrink-0 rounded px-1 py-0.5 font-mono text-[10px] text-accent opacity-80 hover:bg-accent-wash group-hover:opacity-100"
                >
                  …+
                </button>
              )}
            </div>
          );
        },
      }));

      if (readOnly) return dataColumns;

      return [
        {
          id: "__select",
          enableSorting: false,
          enableResizing: false,
          size: 40,
          minSize: 40,
          maxSize: 40,
          meta: { kind: "select" } satisfies GridColumnMeta,
          header: () => (
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleVisibleRows}
              aria-label="Selecionar linhas visíveis"
              className="h-3.5 w-3.5 rounded border-border accent-accent"
            />
          ),
          cell: ({ row }) => {
            const ref = row.original.ref;
            const key = refKey(ref);
            if (ref === null || key === null) return null;
            return (
              <input
                type="checkbox"
                checked={selectedRows.has(key)}
                onChange={() => onToggleRow(ref)}
                aria-label="Selecionar linha"
                className="h-3.5 w-3.5 rounded border-border accent-accent"
              />
            );
          },
        },
        ...dataColumns,
        {
          id: "__actions",
          enableSorting: false,
          enableResizing: false,
          size: 54,
          minSize: 54,
          maxSize: 54,
          meta: { kind: "actions" } satisfies GridColumnMeta,
          cell: ({ row }) => {
            const ref = row.original.ref;
            const key = refKey(ref);
            if (ref === null || key === null) return null;

            return confirmingDelete === key ? (
              <button
                onClick={() => onConfirmDelete(ref)}
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
            );
          },
        },
      ];
    },
    [
      allVisibleSelected,
      confirmingDelete,
      editing,
      loadFullCellText,
      onAskDelete,
      onCancelEdit,
      onCommitEdit,
      onConfirmDelete,
      onDraftChange,
      onStartEdit,
      onToggleRow,
      readOnly,
      schema?.columns,
      selectedRows,
      selectedTable,
      toggleVisibleRows,
    ],
  );

  const table = useReactTable({
    data: rows,
    columns: tableColumns,
    state: { sorting, columnSizing },
    onSortingChange: setSorting,
    onColumnSizingChange: setColumnSizing,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row, index) => refKey(row.ref) ?? `row-${index}`,
    manualSorting: true,
    columnResizeMode: "onChange",
    defaultColumn: {
      minSize: 96,
      size: 180,
      maxSize: 560,
    },
  });

  // Virtualização do corpo: DOM O(viewport) — 10k linhas carregadas não são
  // 10k <tr> (plano de grandes volumes §C).
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const gridRows = table.getRowModel().rows;
  const rowVirtualizer = useVirtualizer({
    count: gridRows.length,
    getScrollElement: () => tableScrollRef.current,
    estimateSize: () => 32,
    overscan: 16,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualPaddingTop = virtualRows[0]?.start ?? 0;
  const virtualPaddingBottom =
    rowVirtualizer.getTotalSize() - (virtualRows[virtualRows.length - 1]?.end ?? 0);
  const visibleColumnCount = table.getVisibleFlatColumns().length;

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
          onReorder={reorderTableTabs}
        />
        <div className="flex flex-1 items-center justify-center text-text-subtle">
          Selecione uma tabela para abrir em uma tab.
        </div>
      </div>
    );
  }

  async function deleteSelectedRows(): Promise<void> {
    if (!selection || !selectedTable || selectedVisibleRows.length === 0) return;
    const deletedRows = selectedVisibleRows.map((row) => ({ cells: row.cells }));
    // Linhas com células truncadas: o undo re-inseriria dados cortados.
    const undoSafe = selectedVisibleRows.every(
      (row) => (row.truncatedColumns?.length ?? 0) === 0,
    );
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
      showToast({
        message: `${deletedRows.length} linha${deletedRows.length > 1 ? "s" : ""} deletada${
          deletedRows.length > 1 ? "s" : ""
        }${undoSafe ? "" : " (sem desfazer: célula grande truncada)"}`,
        undo: undoSafe
          ? async () => {
              for (const row of deletedRows) {
                await insertRow(selection.providerId, selection.instanceId, selectedTable, row.cells);
              }
              await refresh(limitRef.current);
            }
          : undefined,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  function updateInsertDraft(column: string, value: string): void {
    setInsertDraft((current) => ({
      values: { ...current.values, [column]: value },
      useNull: current.useNull,
    }));
  }

  function toggleInsertNull(column: string): void {
    setInsertDraft((current) => {
      const useNull = new Set(current.useNull);
      if (useNull.has(column)) useNull.delete(column);
      else useNull.add(column);
      return { values: current.values, useNull };
    });
  }

  async function saveInsertedRow(createMore: boolean): Promise<void> {
    if (!selection || !selectedTable || !schema) return;
    const values: Record<string, CellValue> = {};
    for (const column of schema.columns) {
      const raw = insertDraft.values[column.name]?.trim() ?? "";
      if (insertDraft.useNull.has(column.name)) {
        values[column.name] = null;
      } else if (raw !== "") {
        values[column.name] = parseDraftValue(raw, column.declaredType);
      }
    }
    const missingRequired = schema.columns.filter(
      (column) =>
        column.notNull &&
        column.pkIndex === 0 &&
        !insertDraft.useNull.has(column.name) &&
        (insertDraft.values[column.name]?.trim() ?? "") === "",
    );
    if (missingRequired.length > 0) {
      setInsertError(`Preencha: ${missingRequired.map((column) => column.name).join(", ")}`);
      return;
    }

    setInsertSaving(true);
    setInsertError(null);
    try {
      const ref = await insertRow(selection.providerId, selection.instanceId, selectedTable, values);
      await refresh(limitRef.current);
      showToast({
        message: "Linha inserida",
        undo: ref
          ? async () => {
              await deleteRow(selection.providerId, selection.instanceId, selectedTable, ref);
              await refresh(limitRef.current);
            }
          : undefined,
      });
      setInsertDraft({ values: {}, useNull: new Set() });
      if (!createMore) setInsertOpen(false);
    } catch (cause) {
      setInsertError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setInsertSaving(false);
    }
  }

  async function saveJsonCell(): Promise<void> {
    if (!selection || !selectedTable || !jsonCell) return;
    let serialized: string;
    try {
      serialized = JSON.stringify(JSON.parse(jsonCell.draft), null, 2);
    } catch (cause) {
      setJsonError(cause instanceof Error ? cause.message : "JSON inválido");
      return;
    }

    setJsonSaving(true);
    setJsonError(null);
    try {
      await updateCell(
        selection.providerId,
        selection.instanceId,
        selectedTable,
        jsonCell.ref,
        jsonCell.column,
        serialized,
      );
      const previous = jsonCell.original;
      const savedCell = jsonCell;
      setJsonCell(null);
      await refresh(limitRef.current);
      showToast({
        message: "JSON atualizado",
        undo: async () => {
          await updateCell(
            selection.providerId,
            selection.instanceId,
            selectedTable,
            savedCell.ref,
            savedCell.column,
            previous,
          );
          await refresh(limitRef.current);
        },
      });
    } catch (cause) {
      setJsonError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setJsonSaving(false);
    }
  }

  return (
    <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
      <TableTabs
        tabs={tableTabs}
        selectedTable={selectedTable}
        onSelect={selectTable}
        onClose={closeTableTab}
        onReorder={reorderTableTabs}
      />
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="font-mono text-[12px] font-semibold">{selectedTable}</span>
        <span
          className="text-[11px] tabular-nums text-text-subtle"
          title={totalIsEstimate ? "Contagem estimada — o valor exato chega no próximo refresh" : undefined}
        >
          {rows.length} de {totalIsEstimate ? "~" : ""}
          {total}
        </span>
        {selectedVisibleRows.length > 0 && (
          <>
            <span className="ml-2 inline-flex h-7 items-center rounded-md border border-border bg-surface-sunken px-2.5 text-[11px] text-text-muted">
              {selectedVisibleRows.length} selecionada
              {selectedVisibleRows.length > 1 ? "s" : ""}
            </span>
            <button
              onClick={() => void deleteSelectedRows()}
              disabled={loading || readOnly}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-deleted/30 bg-deleted-wash px-2.5 text-[11px] font-medium text-deleted disabled:opacity-40"
            >
              <Trash2 size={12} strokeWidth={1.5} />
              Deletar
            </button>
            <button
              onClick={() => setSelectedRows(new Set())}
              className="inline-flex h-7 items-center rounded-md border border-transparent px-2.5 text-[11px] text-text-subtle hover:border-border hover:bg-surface-hover hover:text-text"
            >
              Limpar seleção
            </button>
          </>
        )}
        {!readOnly && (
          <button
            onClick={() => {
              setInsertError(null);
              setInsertOpen(true);
            }}
            disabled={loading}
            className="ml-auto inline-flex h-7 items-center gap-1 rounded-md border border-border px-2.5 text-[11px] font-medium text-text-muted hover:bg-surface-hover hover:text-text disabled:opacity-40"
          >
            <Plus size={12} strokeWidth={1.5} />
            Inserir
          </button>
        )}
        <button
          onClick={() => void refresh(limitRef.current)}
          disabled={loading}
          title="Recarregar linhas"
          className={`${readOnly ? "ml-auto" : ""} inline-flex h-7 w-7 items-center justify-center rounded-md text-text-subtle hover:bg-surface-hover hover:text-text disabled:opacity-40`}
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

      <div className="relative min-h-0 flex-1">
        <div ref={tableScrollRef} className="h-full overflow-auto border-l border-border">
          <table
            className="border-separate border-spacing-0 font-mono text-[12px]"
            style={{ width: table.getTotalSize(), minWidth: "100%" }}
          >
            <thead className="sticky top-0 z-10 bg-surface">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const meta = header.column.columnDef.meta as GridColumnMeta | undefined;
                    const schemaColumn = meta?.schemaColumn;
                    const sorted = header.column.getIsSorted();
                    const SortIcon =
                      sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ArrowUpDown;

                    return (
                      <th
                        key={header.id}
                        className="relative h-9 border-b border-r border-border bg-surface px-0 text-left align-middle font-normal"
                        style={{ width: header.getSize() }}
                      >
                        {schemaColumn ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className="flex h-full w-full min-w-0 items-center gap-2 px-3 text-left hover:bg-surface-hover"
                            title={`Ordenar por ${schemaColumn.name}`}
                          >
                            <span className="min-w-0 truncate font-semibold text-text">
                              {schemaColumn.name}
                            </span>
                            {schemaColumn.pkIndex > 0 && (
                              <span className="shrink-0 text-[10px] font-medium text-accent">
                                pk
                              </span>
                            )}
                            <span className="shrink-0 text-[11px] font-normal text-text-subtle">
                              {schemaColumn.declaredType || "sem tipo"}
                            </span>
                            <SortIcon
                              size={12}
                              strokeWidth={1.5}
                              className={`ml-auto shrink-0 ${
                                sorted ? "text-accent" : "text-text-subtle"
                              }`}
                            />
                          </button>
                        ) : (
                          <div className="flex h-full items-center justify-center px-2">
                            {header.isPlaceholder
                              ? null
                              : flexRender(header.column.columnDef.header, header.getContext())}
                          </div>
                        )}
                        {header.column.getCanResize() && (
                          <button
                            type="button"
                            aria-label="Redimensionar coluna"
                            onDoubleClick={() => header.column.resetSize()}
                            onMouseDown={header.getResizeHandler()}
                            onTouchStart={header.getResizeHandler()}
                            className={`absolute right-0 top-0 h-full w-1 cursor-col-resize touch-none ${
                              header.column.getIsResizing()
                                ? "bg-accent"
                                : "bg-transparent hover:bg-accent/50"
                            }`}
                          />
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {virtualPaddingTop > 0 && (
                <tr aria-hidden>
                  <td colSpan={visibleColumnCount} style={{ height: virtualPaddingTop, padding: 0, border: 0 }} />
                </tr>
              )}
              {virtualRows.map((virtualRow) => {
                const row = gridRows[virtualRow.index];
                if (!row) return null;
                const key = refKey(row.original.ref);
                const checked = key !== null && selectedRows.has(key);
                return (
                  <tr
                    key={row.id}
                    className={`group hover:bg-surface-hover ${checked ? "bg-accent-wash/60" : ""}`}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const meta = cell.column.columnDef.meta as GridColumnMeta | undefined;
                      const utilityColumn = meta?.kind === "select" || meta?.kind === "actions";
                      return (
                        <td
                          key={cell.id}
                          className={`h-8 border-b border-r border-border align-middle ${
                            utilityColumn ? "px-2 text-center" : "p-0"
                          }`}
                          style={{ width: cell.column.getSize() }}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {virtualPaddingBottom > 0 && (
                <tr aria-hidden>
                  <td colSpan={visibleColumnCount} style={{ height: virtualPaddingBottom, padding: 0, border: 0 }} />
                </tr>
              )}
            </tbody>
          </table>

          {rows.length === 0 && !loading && (
            <p className="p-4 text-[12px] text-text-subtle">Tabela vazia.</p>
          )}
          {rows.length < total && (
            <button
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="m-3 rounded-md border border-border px-3 py-1.5 text-[12px] text-text-muted hover:bg-surface-hover disabled:opacity-50"
            >
              {loadingMore
                ? "Carregando…"
                : `Carregar mais (${rows.length} de ${totalIsEstimate ? "~" : ""}${total})`}
            </button>
          )}
        </div>
        {toast && <TableToast toast={toast} onClose={() => setToast(null)} />}
        {insertOpen && (
          <InsertRowDrawer
            table={selectedTable}
            columns={schema.columns}
            draft={insertDraft}
            saving={insertSaving}
            error={insertError}
            onDraftChange={updateInsertDraft}
            onToggleNull={toggleInsertNull}
            onClose={() => setInsertOpen(false)}
            onSave={(createMore) => void saveInsertedRow(createMore)}
          />
        )}
        {jsonCell && (
          <JsonCellModal
            cell={jsonCell}
            saving={jsonSaving}
            error={jsonError}
            onDraftChange={(draft) => {
              setJsonError(null);
              setJsonCell((current) => (current ? { ...current, draft } : current));
            }}
            onClose={() => {
              setJsonCell(null);
              setJsonError(null);
            }}
            onSave={() => void saveJsonCell()}
          />
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
