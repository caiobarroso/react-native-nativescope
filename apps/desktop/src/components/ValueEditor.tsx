import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  Braces,
  Check,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  Database,
  FileCode2,
  History,
  ListTree,
  Maximize2,
  Minimize2,
  Plus,
  Search,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import type { StorageValue } from "@rnsi/protocol";
import { useStudio, keysId } from "../lib/store.ts";
import { getValue, setValue, removeKey } from "../lib/studio-client.ts";

const HISTORY_LABEL = {
  created: "criado",
  updated: "atualizado",
  removed: "removido",
} as const;

type JsonRoot = Record<string, unknown> | unknown[];

const JsonView = lazy(() => import("@uiw/react-json-view"));

const jsonViewerTheme = {
  "--w-rjv-font-family": "var(--font-mono)",
  "--w-rjv-color": "var(--text)",
  "--w-rjv-background-color": "transparent",
  "--w-rjv-line-color": "var(--border)",
  "--w-rjv-arrow-color": "var(--text-muted)",
  "--w-rjv-edit-color": "var(--accent)",
  "--w-rjv-info-color": "var(--text-subtle)",
  "--w-rjv-update-color": "var(--accent)",
  "--w-rjv-copied-color": "var(--accent)",
  "--w-rjv-copied-success-color": "var(--created)",
  "--w-rjv-key-number": "var(--text-muted)",
  "--w-rjv-key-string": "var(--text)",
  "--w-rjv-curlybraces-color": "var(--text-muted)",
  "--w-rjv-colon-color": "var(--text-subtle)",
  "--w-rjv-brackets-color": "var(--text-muted)",
  "--w-rjv-ellipsis-color": "var(--accent)",
  "--w-rjv-quotes-color": "var(--text-subtle)",
  "--w-rjv-quotes-string-color": "var(--created)",
  "--w-rjv-type-string-color": "var(--created)",
  "--w-rjv-type-int-color": "#8a5a9e",
  "--w-rjv-type-float-color": "#8a5a9e",
  "--w-rjv-type-bigint-color": "#8a5a9e",
  "--w-rjv-type-boolean-color": "var(--accent)",
  "--w-rjv-type-date-color": "var(--created)",
  "--w-rjv-type-url-color": "#476f8f",
  "--w-rjv-type-null-color": "var(--deleted)",
  "--w-rjv-type-nan-color": "var(--deleted)",
  "--w-rjv-type-undefined-color": "var(--text-subtle)",
} as CSSProperties;

function parseJsonDraft(draft: string): { value: unknown; error: null } | { value: null; error: string } {
  try {
    return { value: JSON.parse(draft), error: null };
  } catch (cause) {
    return { value: null, error: cause instanceof Error ? cause.message : "JSON inválido" };
  }
}

function isJsonRoot(value: unknown): value is JsonRoot {
  return typeof value === "object" && value !== null;
}

const JSON_NODE_COUNT_LIMIT = 5000;

function countJsonNodes(value: unknown): number {
  let count = 0;
  const stack: unknown[] = [value];
  while (stack.length > 0 && count < JSON_NODE_COUNT_LIMIT) {
    const current = stack.pop();
    count += 1;
    if (isJsonRoot(current)) {
      stack.push(...Object.values(current));
    }
  }
  return count;
}

function rootLabel(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} itens`;
  if (isJsonRoot(value)) return `${Object.keys(value).length} chaves`;
  if (value === null) return "null";
  return typeof value;
}

type TsDeclaration = "interface" | "type";
type TsArrayStyle = "array" | "bracket";

export interface TypeScriptOptions {
  declaration: TsDeclaration;
  arrayStyle: TsArrayStyle;
}

function typeNameFromKey(name: string | undefined): string {
  const words = (name ?? "StorageValue")
    .replace(/\[[^\]]*\]/g, " ")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const candidate = words
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join("");
  if (!candidate) return "StorageValue";
  return /^\d/.test(candidate) ? `Storage${candidate}` : candidate;
}

function safePropertyName(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

export function generateTypeScript(
  value: unknown,
  rootName: string,
  options: TypeScriptOptions,
): string {
  const normalizedRoot = typeNameFromKey(rootName);
  if (options.declaration === "interface" && isPlainObject(value)) {
    return `export interface ${normalizedRoot} ${inferObjectType(value, 0, options)}\n`;
  }
  if (options.declaration === "interface" && Array.isArray(value)) {
    return `export interface ${normalizedRoot} extends Array<${inferArrayItemType(value, 0, options)}> {}\n`;
  }
  return `export type ${normalizedRoot} = ${inferTsType(value, 0, options)};\n`;
}

function inferTsType(value: unknown, level: number, options: TypeScriptOptions): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return inferArrayType(value, level, options);
  if (isPlainObject(value)) return inferObjectType(value, level, options);
  if (typeof value === "string") return "string";
  if (typeof value === "number") return Number.isInteger(value) ? "number" : "number";
  if (typeof value === "boolean") return "boolean";
  return "unknown";
}

function inferArrayType(values: unknown[], level: number, options: TypeScriptOptions): string {
  return arrayOf(inferArrayItemType(values, level, options), options);
}

function inferArrayItemType(values: unknown[], level: number, options: TypeScriptOptions): string {
  if (values.length === 0) return "unknown";

  const objectValues = values.filter(isPlainObject);
  const nonObjectValues = values.filter((value) => !isPlainObject(value));
  const members = new Set<string>();

  if (objectValues.length > 0) {
    members.add(inferMergedObjectType(objectValues, level, options));
  }
  for (const value of nonObjectValues) {
    members.add(Array.isArray(value) ? inferArrayType(value, level, options) : inferTsType(value, level, options));
  }

  return union([...members]);
}

function inferObjectType(
  value: Record<string, unknown>,
  level: number,
  options: TypeScriptOptions,
  optionalKeys = new Set<string>(),
): string {
  const entries = Object.entries(value);
  if (entries.length === 0) return "Record<string, never>";

  const pad = indent(level);
  const childPad = indent(level + 1);
  const lines = entries.map(([key, child]) => {
    const optional = optionalKeys.has(key) ? "?" : "";
    return `${childPad}${safePropertyName(key)}${optional}: ${inferTsType(child, level + 1, options)};`;
  });
  return `{\n${lines.join("\n")}\n${pad}}`;
}

function inferMergedObjectType(
  values: Array<Record<string, unknown>>,
  level: number,
  options: TypeScriptOptions,
): string {
  const keys = [...new Set(values.flatMap((value) => Object.keys(value)))].sort((a, b) =>
    a.localeCompare(b),
  );
  if (keys.length === 0) return "Record<string, never>";

  const pad = indent(level);
  const childPad = indent(level + 1);
  const lines = keys.map((key) => {
    const present = values.filter((value) => Object.hasOwn(value, key));
    const optional = present.length < values.length ? "?" : "";
    const type = inferUnionValues(present.map((value) => value[key]), level + 1, options);
    return `${childPad}${safePropertyName(key)}${optional}: ${type};`;
  });
  return `{\n${lines.join("\n")}\n${pad}}`;
}

function inferUnionValues(values: unknown[], level: number, options: TypeScriptOptions): string {
  const types = new Set(values.map((value) => inferTsType(value, level, options)));
  return union([...types]);
}

function union(types: string[]): string {
  const unique = [...new Set(types)];
  if (unique.length === 0) return "unknown";
  if (unique.length === 1) return unique[0] ?? "unknown";
  return unique.sort().join(" | ");
}

function arrayOf(itemType: string, options: TypeScriptOptions): string {
  const needsParens = itemType.includes(" | ");
  if (options.arrayStyle === "array") return `Array<${itemType}>`;
  return `${needsParens ? `(${itemType})` : itemType}[]`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function indent(level: number): string {
  return "  ".repeat(level);
}

type JsonPath = Array<string | number>;

type JsonTableRow = {
  index: number;
  value: unknown;
};

function pathLabel(segment: string | number): string {
  return typeof segment === "number" ? `#${segment + 1}` : segment;
}

function valueKind(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function isCollection(value: unknown): value is JsonRoot {
  return typeof value === "object" && value !== null;
}

function collectionLabel(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} itens`;
  if (isPlainObject(value)) return `${Object.keys(value).length} campos`;
  return valueKind(value);
}

function getAtPath(root: unknown, path: JsonPath): unknown {
  return path.reduce<unknown>((current, segment) => {
    if (Array.isArray(current) && typeof segment === "number") return current[segment];
    if (isPlainObject(current) && typeof segment === "string") return current[segment];
    return undefined;
  }, root);
}

function setAtPath(root: unknown, path: JsonPath, value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...tail] = path;
  if (Array.isArray(root) && typeof head === "number") {
    return root.map((item, index) => (index === head ? setAtPath(item, tail, value) : item));
  }
  if (isPlainObject(root) && typeof head === "string") {
    return { ...root, [head]: setAtPath(root[head], tail, value) };
  }
  return root;
}

function deleteAtPath(root: unknown, path: JsonPath): unknown {
  if (path.length === 0) return root;
  const parentPath = path.slice(0, -1);
  const leaf = path[path.length - 1];
  const parent = getAtPath(root, parentPath);
  if (Array.isArray(parent) && typeof leaf === "number") {
    return setAtPath(root, parentPath, parent.filter((_, index) => index !== leaf));
  }
  if (isPlainObject(parent) && typeof leaf === "string") {
    const next = { ...parent };
    delete next[leaf];
    return setAtPath(root, parentPath, next);
  }
  return root;
}

function duplicateAtPath(root: unknown, path: JsonPath): unknown {
  const parentPath = path.slice(0, -1);
  const leaf = path[path.length - 1];
  const parent = getAtPath(root, parentPath);
  const value = getAtPath(root, path);
  const clone = JSON.parse(JSON.stringify(value));
  if (Array.isArray(parent) && typeof leaf === "number") {
    return setAtPath(root, parentPath, [
      ...parent.slice(0, leaf + 1),
      clone,
      ...parent.slice(leaf + 1),
    ]);
  }
  if (isPlainObject(parent) && typeof leaf === "string") {
    let nextKey = `${leaf}Copy`;
    let suffix = 2;
    while (Object.hasOwn(parent, nextKey)) {
      nextKey = `${leaf}Copy${suffix++}`;
    }
    return setAtPath(root, parentPath, { ...parent, [nextKey]: clone });
  }
  return root;
}

function parsePrimitiveDraft(raw: string, previous: unknown): unknown {
  if (typeof previous === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : previous;
  }
  if (typeof previous === "boolean") return raw === "true";
  if (previous === null) return raw === "" ? null : raw;
  return raw;
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function defaultValueForArray(array: unknown[]): unknown {
  const sample = array[0];
  if (isPlainObject(sample)) return {};
  if (Array.isArray(sample)) return [];
  if (typeof sample === "number") return 0;
  if (typeof sample === "boolean") return false;
  if (sample === null) return null;
  return "";
}

function searchPreview(value: unknown, budget = 1200): string {
  const seen = new Set<unknown>();
  let remaining = budget;

  function walk(input: unknown): string {
    if (remaining <= 0) return "";
    if (input === null || typeof input !== "object") {
      const text = String(input);
      remaining -= text.length;
      return text;
    }
    if (seen.has(input)) return "";
    seen.add(input);
    const values = Array.isArray(input)
      ? input.slice(0, 20)
      : Object.entries(input)
          .slice(0, 30)
          .flatMap(([key, child]) => [key, child]);
    return values.map(walk).join(" ");
  }

  return walk(value).toLowerCase();
}

function JsonPrimitiveEditor({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value ?? ""));

  useEffect(() => {
    setDraft(value === null ? "" : String(value ?? ""));
  }, [value]);

  function commit(): void {
    const next = parsePrimitiveDraft(draft, value);
    if (Object.is(next, value)) return;
    onChange(next);
  }

  if (typeof value === "boolean") {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={value}
        data-checked={value}
        onClick={() => onChange(!value)}
        className="rnsi-switch"
      />
    );
  }
  if (typeof value === "number") {
    return (
      <input
        type="number"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setDraft(String(value));
        }}
        className="h-7 w-full rounded-sm border border-border bg-surface px-2 font-mono text-[12px] outline-none focus:border-accent"
      />
    );
  }
  if (value === null) {
    return <span className="font-mono text-[12px] text-deleted">null</span>;
  }
  return (
    <input
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") setDraft(value === null ? "" : String(value ?? ""));
      }}
      className="h-7 w-full rounded-sm border border-border bg-surface px-2 font-mono text-[12px] outline-none focus:border-accent"
    />
  );
}

function JsonVisualExplorer({
  value,
  sourceName,
  onChange,
}: {
  value: unknown;
  sourceName?: string;
  onChange: (value: unknown) => void;
}) {
  const [path, setPath] = useState<JsonPath>([]);
  const [query, setQuery] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [newFieldName, setNewFieldName] = useState("");
  const current = getAtPath(value, path);

  function updatePath(targetPath: JsonPath, nextValue: unknown): void {
    onChange(setAtPath(value, targetPath, nextValue));
  }

  function navigate(nextPath: JsonPath): void {
    setPath(nextPath);
    setQuery("");
    setPageIndex(0);
  }

  const page = useMemo(() => {
    if (!Array.isArray(current)) {
      return { rows: [] as JsonTableRow[], total: 0, limited: false };
    }
    const q = query.trim().toLowerCase();
    if (!q) {
      const total = current.length;
      const safePage = Math.min(pageIndex, Math.max(0, Math.ceil(total / pageSize) - 1));
      const start = safePage * pageSize;
      return {
        rows: current
          .slice(start, start + pageSize)
          .map((item, offset) => ({ index: start + offset, value: item })),
        total,
        limited: false,
      };
    }

    const scanLimit = Math.min(current.length, 5000);
    const pageStart = pageIndex * pageSize;
    const pageEnd = pageStart + pageSize;
    const matchedRows: JsonTableRow[] = [];
    let total = 0;
    for (let index = 0; index < scanLimit; index += 1) {
      const item = current[index];
      if (!searchPreview(item).includes(q)) continue;
      if (total >= pageStart && total < pageEnd) matchedRows.push({ index, value: item });
      total += 1;
    }
    return { rows: matchedRows, total, limited: scanLimit < current.length };
  }, [current, query, pageIndex, pageSize]);

  const pageCount = Math.max(1, Math.ceil(page.total / pageSize));
  const safePageIndex = Math.min(pageIndex, pageCount - 1);
  const pagedRows = page.rows;

  const objectColumns = useMemo<ColumnDef<JsonTableRow>[]>(() => {
    if (!Array.isArray(current)) return [];
    const objectRows = current
      .slice(0, 300)
      .map((item, index) => ({ index, value: item }))
      .filter((row) => isPlainObject(row.value));
    const keys = [...new Set(objectRows.flatMap((row) => Object.keys(row.value as Record<string, unknown>)))].slice(0, 12);
    const cols: ColumnDef<JsonTableRow>[] = [
      ...keys.map<ColumnDef<JsonTableRow>>((key) => ({
        id: key,
        header: key,
        accessorFn: (row) => (isPlainObject(row.value) ? row.value[key] : undefined),
        cell: ({ row, getValue }) => {
          const cellValue = getValue();
          const cellPath = [...path, row.original.index, key];
          if (isCollection(cellValue)) {
            return (
              <button
                onClick={() => navigate(cellPath)}
                className="flex h-8 w-full items-center gap-2 px-2 text-left text-text-muted hover:bg-surface-hover hover:text-text"
              >
                <Database size={12} strokeWidth={1.5} className="text-accent" />
                <span className="truncate">{collectionLabel(cellValue)}</span>
              </button>
            );
          }
          return (
            <div className="px-1">
              <JsonPrimitiveEditor value={cellValue} onChange={(next) => updatePath(cellPath, next)} />
            </div>
          );
        },
      })),
      {
        id: "__actions",
        size: 142,
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1 px-1">
            <button
              onClick={() => navigate([...path, row.original.index])}
              title="Abrir detalhe"
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text"
            >
              Abrir
              <ChevronRight size={12} strokeWidth={1.5} />
            </button>
            <button
              onClick={() => onChange(duplicateAtPath(value, [...path, row.original.index]))}
              title="Duplicar"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-subtle hover:bg-surface-hover hover:text-text"
            >
              <Copy size={12} strokeWidth={1.5} />
            </button>
            <button
              onClick={() => onChange(deleteAtPath(value, [...path, row.original.index]))}
              title="Deletar"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-deleted hover:bg-deleted-wash"
            >
              <Trash2 size={12} strokeWidth={1.5} />
            </button>
          </div>
        ),
      },
    ];
    return cols;
  }, [current, path, value]);

  const table = useReactTable({
    data: pagedRows,
    columns: objectColumns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => String(row.index),
  });

  if (!isCollection(current)) {
    return (
      <div className="flex h-full flex-col gap-3">
        <JsonVisualHeader sourceName={sourceName} path={path} onNavigate={navigate} />
        <div className="max-w-xl rounded-md border border-border bg-surface-raised p-4">
          <JsonPrimitiveEditor value={current} onChange={(next) => updatePath(path, next)} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-72 flex-col overflow-hidden rounded-md border border-border bg-surface-raised">
      <JsonVisualHeader sourceName={sourceName} path={path} onNavigate={navigate} />

      {Array.isArray(current) ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
            <Search size={13} strokeWidth={1.5} className="text-text-subtle" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPageIndex(0);
              }}
              placeholder={`Buscar em ${path[path.length - 1] ?? "array"}...`}
              className="h-7 w-56 rounded-md border border-border bg-surface px-2 text-[12px] outline-none focus:border-accent"
            />
            <button
              onClick={() => updatePath(path, [...current, defaultValueForArray(current)])}
              className="ml-auto inline-flex h-7 items-center gap-1 rounded-md border border-border px-2.5 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text"
            >
              <Plus size={12} strokeWidth={1.5} />
              Adicionar
            </button>
          </div>
          {objectColumns.length > 1 ? (
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full border-separate border-spacing-0 font-mono text-[12px]">
                <thead className="sticky top-0 z-10 bg-surface">
                  {table.getHeaderGroups().map((group) => (
                    <tr key={group.id}>
                      {group.headers.map((header) => (
                        <th
                          key={header.id}
                          className="h-8 border-b border-r border-border px-2 text-left font-semibold"
                        >
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.header, header.getContext())}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.map((row) => (
                    <tr
                      key={row.id}
                      onDoubleClick={() => navigate([...path, row.original.index])}
                      className="hover:bg-surface-hover"
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="h-9 border-b border-r border-border align-middle">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <ol className="min-h-0 flex-1 overflow-auto">
              {pagedRows.map((row) => (
                <li key={row.index} className="flex h-9 items-center gap-2 border-b border-border px-3">
                  <span className="w-10 shrink-0 font-mono text-[11px] text-text-subtle">#{row.index + 1}</span>
                  <div className="min-w-0 flex-1">
                    {isCollection(row.value) ? (
                      <button
                        onClick={() => navigate([...path, row.index])}
                        className="flex w-full items-center gap-2 text-left text-text-muted hover:text-text"
                      >
                        <Database size={12} strokeWidth={1.5} className="text-accent" />
                        {collectionLabel(row.value)}
                      </button>
                    ) : (
                      <JsonPrimitiveEditor
                        value={row.value}
                        onChange={(next) => updatePath([...path, row.index], next)}
                      />
                    )}
                  </div>
                  <button
                    onClick={() => onChange(duplicateAtPath(value, [...path, row.index]))}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-subtle hover:bg-surface-hover"
                  >
                    <Copy size={12} strokeWidth={1.5} />
                  </button>
                  <button
                    onClick={() => onChange(deleteAtPath(value, [...path, row.index]))}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-deleted hover:bg-deleted-wash"
                  >
                    <Trash2 size={12} strokeWidth={1.5} />
                  </button>
                </li>
              ))}
            </ol>
          )}
          <div className="flex h-10 shrink-0 items-center gap-2 border-t border-border px-3 text-[12px] text-text-muted">
            <button
              onClick={() => setPageIndex((page) => Math.max(0, page - 1))}
              disabled={safePageIndex === 0}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border disabled:opacity-40"
            >
              <ChevronLeft size={13} strokeWidth={1.5} />
            </button>
            <span>
              Página {safePageIndex + 1} de {pageCount}
            </span>
            <button
              onClick={() => setPageIndex((page) => Math.min(pageCount - 1, page + 1))}
              disabled={safePageIndex >= pageCount - 1}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border disabled:opacity-40"
            >
              <ChevronRight size={13} strokeWidth={1.5} />
            </button>
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPageIndex(0);
              }}
              className="ml-2 h-7 rounded-md border border-border bg-surface px-2 text-[12px]"
            >
              {[25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size} rows
                </option>
              ))}
            </select>
            <span className="ml-auto">
              {page.total} registros{page.limited ? " nos primeiros 5000 itens" : ""}
            </span>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
            <input
              value={newFieldName}
              onChange={(event) => setNewFieldName(event.target.value)}
              placeholder="novoCampo"
              className="h-7 w-48 rounded-md border border-border bg-surface px-2 font-mono text-[12px] outline-none focus:border-accent"
            />
            <button
              onClick={() => {
                const name = newFieldName.trim();
                if (!name || Object.hasOwn(current, name)) return;
                updatePath(path, { ...current, [name]: "" });
                setNewFieldName("");
              }}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2.5 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text"
            >
              <Plus size={12} strokeWidth={1.5} />
              Adicionar campo
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
          <div className="divide-y divide-border rounded-md border border-border">
            {Object.entries(current).map(([key, child]) => {
              const childPath = [...path, key];
              return (
                <div key={key} className="grid min-h-9 grid-cols-[190px_1fr_74px] items-center">
                  <div className="min-w-0 border-r border-border px-3 font-mono text-[12px] font-semibold">
                    <span className="truncate">{key}</span>
                  </div>
                  <div className="min-w-0 px-2">
                    {isCollection(child) ? (
                      <button
                        onClick={() => navigate(childPath)}
                        className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-text-muted hover:bg-surface-hover hover:text-text"
                      >
                        <Database size={12} strokeWidth={1.5} className="text-accent" />
                        <span className="truncate">{collectionLabel(child)}</span>
                        <ChevronRight size={13} strokeWidth={1.5} className="ml-auto" />
                      </button>
                    ) : (
                      <JsonPrimitiveEditor value={child} onChange={(next) => updatePath(childPath, next)} />
                    )}
                  </div>
                  <div className="flex items-center justify-end gap-1 px-2">
                    <span className="rounded border border-border px-1.5 py-px text-[10px] text-text-subtle">
                      {valueKind(child)}
                    </span>
                    <button
                      onClick={() => onChange(deleteAtPath(value, childPath))}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-deleted hover:bg-deleted-wash"
                    >
                      <Trash2 size={12} strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          </div>
        </div>
      )}
    </div>
  );
}

function JsonVisualHeader({
  sourceName,
  path,
  onNavigate,
}: {
  sourceName?: string;
  path: JsonPath;
  onNavigate: (path: JsonPath) => void;
}) {
  const currentLabel = path.length === 0 ? "Raiz" : pathLabel(path[path.length - 1] ?? "Raiz");
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-surface-sunken px-3 text-[12px]">
      {path.length > 0 ? (
        <button
          onClick={() => onNavigate(path.slice(0, -1))}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface-raised px-2.5 font-medium text-text-muted hover:bg-surface-hover hover:text-text"
        >
          <ChevronLeft size={14} strokeWidth={1.5} />
          Voltar
        </button>
      ) : (
        <span className="inline-flex h-8 items-center rounded-md border border-transparent px-2.5 text-text-subtle">
          Raiz
        </span>
      )}

      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        <button
          onClick={() => onNavigate([])}
          className="min-w-0 truncate rounded-md px-2 py-1 font-mono font-semibold text-text hover:bg-surface-hover"
        >
          {sourceName ?? "root"}
        </button>
        {path.map((segment, index) => (
          <span key={`${String(segment)}-${index}`} className="flex min-w-0 items-center gap-1">
            <ChevronRight size={12} strokeWidth={1.5} className="shrink-0 text-text-subtle" />
            <button
              onClick={() => onNavigate(path.slice(0, index + 1))}
              className="max-w-44 truncate rounded-md px-2 py-1 font-mono text-text-muted hover:bg-surface-hover hover:text-text"
            >
              {pathLabel(segment)}
            </button>
          </span>
        ))}
      </div>

      <span className="hidden shrink-0 rounded-md border border-border bg-surface-raised px-2 py-1 font-mono text-[11px] text-text-subtle sm:inline-flex">
        {currentLabel}
      </span>
    </div>
  );
}

export function JsonWorkspace({
  draft,
  onDraftChange,
  sourceName,
  minHeight = "min-h-0",
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  sourceName?: string;
  minHeight?: string;
}) {
  const [mode, setMode] = useState<"visual" | "tree" | "raw" | "ts">("visual");
  const [collapsed, setCollapsed] = useState<boolean | number>(2);
  const [viewerKey, setViewerKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [copiedTs, setCopiedTs] = useState(false);
  const [tsDeclaration, setTsDeclaration] = useState<TsDeclaration>("interface");
  const [tsArrayStyle, setTsArrayStyle] = useState<TsArrayStyle>("array");
  const parsed = useMemo(() => parseJsonDraft(draft), [draft]);
  const tsRootName = typeNameFromKey(sourceName);
  const typeScript = useMemo(
    () =>
      parsed.error === null
        ? generateTypeScript(parsed.value, tsRootName, {
            declaration: tsDeclaration,
            arrayStyle: tsArrayStyle,
          })
        : "",
    [parsed, tsRootName, tsDeclaration, tsArrayStyle],
  );
  const treeValue = parsed.error === null && isJsonRoot(parsed.value) ? parsed.value : null;
  const nodeCount = parsed.error === null ? countJsonNodes(parsed.value) : 0;
  const nodeCountLabel =
    nodeCount >= JSON_NODE_COUNT_LIMIT ? `${JSON_NODE_COUNT_LIMIT}+ nós` : `${nodeCount} nós`;
  const showTree = mode === "tree" && parsed.error === null;

  function setCollapse(next: boolean | number): void {
    setCollapsed(next);
    setViewerKey((key) => key + 1);
  }

  async function copyJson(): Promise<void> {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  async function copyTypeScript(): Promise<void> {
    if (!typeScript) return;
    try {
      await navigator.clipboard.writeText(typeScript);
      setCopiedTs(true);
      window.setTimeout(() => setCopiedTs(false), 1200);
    } catch {
      setCopiedTs(false);
    }
  }

  return (
    <div className={`flex h-full ${minHeight} min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-surface-raised`}>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-surface-sunken px-2">
        <div className="flex rounded-md border border-border bg-surface-raised p-0.5">
          <button
            onClick={() => setMode("visual")}
            disabled={parsed.error !== null}
            className={`flex items-center gap-1.5 rounded px-2 py-1 text-[11px] ${
              mode === "visual" ? "bg-accent text-white" : "text-text-muted hover:bg-surface-hover"
            } disabled:opacity-40`}
          >
            <Table2 size={12} strokeWidth={1.5} />
            Visual
          </button>
          <button
            onClick={() => setMode("tree")}
            className={`flex items-center gap-1.5 rounded px-2 py-1 text-[11px] ${
              mode === "tree" ? "bg-accent text-white" : "text-text-muted hover:bg-surface-hover"
            }`}
          >
            <ListTree size={12} strokeWidth={1.5} />
            Árvore
          </button>
          <button
            onClick={() => setMode("raw")}
            className={`flex items-center gap-1.5 rounded px-2 py-1 text-[11px] ${
              mode === "raw" ? "bg-accent text-white" : "text-text-muted hover:bg-surface-hover"
            }`}
          >
            <Code2 size={12} strokeWidth={1.5} />
            Raw
          </button>
          <button
            onClick={() => setMode("ts")}
            disabled={parsed.error !== null}
            className={`flex items-center gap-1.5 rounded px-2 py-1 text-[11px] ${
              mode === "ts" ? "bg-accent text-white" : "text-text-muted hover:bg-surface-hover"
            } disabled:opacity-40`}
          >
            <FileCode2 size={12} strokeWidth={1.5} />
            TS
          </button>
        </div>

        <span className="ml-1 hidden items-center gap-1.5 text-[11px] text-text-subtle sm:flex">
          <Braces size={12} strokeWidth={1.5} />
          {parsed.error === null ? `${rootLabel(parsed.value)} · ${nodeCountLabel}` : "inválido"}
        </span>

        <button
          onClick={() => setCollapse(false)}
          disabled={!treeValue}
          title="Expandir tudo"
          className="ml-auto rounded p-1 text-text-subtle hover:bg-surface-hover hover:text-text disabled:opacity-40"
        >
          <Maximize2 size={13} strokeWidth={1.5} />
        </button>
        <button
          onClick={() => setCollapse(2)}
          disabled={!treeValue}
          title="Profundidade 2"
          className="rounded px-1.5 py-1 font-mono text-[11px] text-text-subtle hover:bg-surface-hover hover:text-text disabled:opacity-40"
        >
          2
        </button>
        <button
          onClick={() => setCollapse(true)}
          disabled={!treeValue}
          title="Colapsar tudo"
          className="rounded p-1 text-text-subtle hover:bg-surface-hover hover:text-text disabled:opacity-40"
        >
          <Minimize2 size={13} strokeWidth={1.5} />
        </button>
        <button
          onClick={() => void copyJson()}
          title="Copiar JSON"
          className="rounded p-1 text-text-subtle hover:bg-surface-hover hover:text-text"
        >
          {copied ? <Check size={13} strokeWidth={1.5} /> : <Copy size={13} strokeWidth={1.5} />}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {mode === "visual" && parsed.error === null ? (
          <JsonVisualExplorer
            value={parsed.value}
            sourceName={sourceName}
            onChange={(next) => onDraftChange(stringifyJson(next))}
          />
        ) : mode === "ts" && parsed.error === null ? (
          <div className="flex h-full min-h-72 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={tsRootName}
                readOnly
                className="w-48 rounded border border-border bg-surface-sunken px-2 py-1 font-mono text-[11px] text-text-muted"
                title="Nome inferido pela chave JSON"
              />
              <div className="flex rounded-md border border-border bg-surface p-0.5">
                {(["interface", "type"] as const).map((option) => (
                  <button
                    key={option}
                    onClick={() => setTsDeclaration(option)}
                    className={`rounded px-2 py-1 text-[11px] ${
                      tsDeclaration === option
                        ? "bg-accent text-white"
                        : "text-text-muted hover:bg-surface-hover"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <div className="flex rounded-md border border-border bg-surface p-0.5">
                <button
                  onClick={() => setTsArrayStyle("array")}
                  className={`rounded px-2 py-1 font-mono text-[11px] ${
                    tsArrayStyle === "array"
                      ? "bg-accent text-white"
                      : "text-text-muted hover:bg-surface-hover"
                  }`}
                >
                  Array&lt;T&gt;
                </button>
                <button
                  onClick={() => setTsArrayStyle("bracket")}
                  className={`rounded px-2 py-1 font-mono text-[11px] ${
                    tsArrayStyle === "bracket"
                      ? "bg-accent text-white"
                      : "text-text-muted hover:bg-surface-hover"
                  }`}
                >
                  T[]
                </button>
              </div>
              <button
                onClick={() => void copyTypeScript()}
                className="ml-auto flex items-center gap-1.5 rounded border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-surface-hover"
              >
                {copiedTs ? <Check size={12} strokeWidth={1.5} /> : <Copy size={12} strokeWidth={1.5} />}
                Copiar
              </button>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-surface p-3 font-mono text-[12px] leading-relaxed text-text">
              <code>{typeScript}</code>
            </pre>
          </div>
        ) : showTree ? (
          treeValue ? (
            <Suspense
              fallback={
                <div className="rounded-md border border-border bg-surface-sunken px-3 py-2 text-[12px] text-text-subtle">
                  Carregando árvore JSON...
                </div>
              }
            >
              <JsonView
                key={viewerKey}
                value={treeValue}
                keyName="root"
                collapsed={collapsed}
                displayDataTypes={false}
                displayObjectSize
                enableClipboard
                shortenTextAfterLength={96}
                indentWidth={18}
                style={jsonViewerTheme}
                className="text-[12px] leading-relaxed"
              />
            </Suspense>
          ) : (
            <div className="rounded-md border border-border bg-surface-sunken px-3 py-2 font-mono text-[12px] text-text">
              {String(parsed.value)}
            </div>
          )
        ) : (
          <textarea
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            spellCheck={false}
            className="h-full min-h-72 w-full resize-none rounded-md border border-border bg-surface p-3 font-mono text-[12px] leading-relaxed text-text outline-none focus:border-accent"
          />
        )}
        {mode === "tree" && parsed.error !== null && (
          <div className="flex h-full min-h-72 flex-col gap-2">
            <p className="text-[12px] text-deleted">{parsed.error}</p>
            <textarea
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              spellCheck={false}
              className="min-h-0 flex-1 resize-none rounded-md border border-border bg-surface p-3 font-mono text-[12px] leading-relaxed text-text outline-none focus:border-accent"
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Histórico da chave selecionada — a terceira coluna (plano §5.2).
 * Não é metadata: é o diferencial do produto no nível da chave.
 */
function KeyHistory({ historyKey }: { historyKey: string }) {
  const history = useStudio((s) => s.keyHistory[historyKey]);

  return (
    <aside className="flex w-60 shrink-0 flex-col border-l border-border">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-3">
        <History size={13} strokeWidth={1.5} className="text-text-subtle" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          Histórico
        </span>
        {history && history.length > 1 && (
          <span className="text-[11px] text-text-subtle">{history.length}</span>
        )}
      </div>
      <ol className="flex-1 overflow-y-auto p-2">
        {(!history || history.length === 0) && (
          <li className="px-1 py-2 text-[11px] text-text-subtle">
            Mudanças nesta chave aparecem aqui enquanto o Studio estiver aberto.
          </li>
        )}
        {history?.map((entry, i) => (
          <li key={i} className="mb-2 rounded-md border border-border p-2">
            <div className="mb-1 flex items-center gap-2 text-[10px] text-text-subtle">
              <time className="tabular-nums">
                {new Date(entry.timestamp).toLocaleTimeString("pt-BR")}
              </time>
              <span
                className={
                  entry.change === "created"
                    ? "text-created"
                    : entry.change === "removed"
                      ? "text-deleted"
                      : "text-updated"
                }
              >
                {HISTORY_LABEL[entry.change]}
              </span>
              <span
                title={entry.source === "studio" ? "pelo Studio" : "pelo app"}
                className={`ml-auto h-1.5 w-1.5 rounded-full ${
                  entry.source === "studio" ? "bg-accent" : "bg-text-subtle"
                }`}
              />
            </div>
            {entry.preview !== null && (
              <p className="truncate font-mono text-[11px] text-text-muted">{entry.preview}</p>
            )}
          </li>
        ))}
      </ol>
    </aside>
  );
}

function CreateKeyForm({
  providerId,
  instanceId,
}: {
  providerId: string;
  instanceId: string;
}) {
  const setCreating = useStudio((s) => s.setCreating);
  const selectKey = useStudio((s) => s.selectKey);
  const [keyName, setKeyName] = useState("");
  const [type, setType] = useState<"string" | "number" | "boolean" | "json">("string");
  const [draft, setDraft] = useState("");
  const [boolDraft, setBoolDraft] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(): Promise<void> {
    const name = keyName.trim();
    if (!name) {
      setError("dê um nome à chave");
      return;
    }
    let value: StorageValue;
    if (type === "string") value = { type: "string", value: draft };
    else if (type === "number") {
      const n = Number(draft);
      if (!Number.isFinite(n)) {
        setError("número inválido");
        return;
      }
      value = { type: "number", value: n };
    } else if (type === "boolean") value = { type: "boolean", value: boolDraft };
    else {
      try {
        JSON.parse(draft);
      } catch {
        setError("JSON inválido");
        return;
      }
      value = { type: "json", value: draft };
    }

    setSaving(true);
    setError(null);
    try {
      await setValue(providerId, instanceId, name, value);
      selectKey(name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border px-4">
        <span className="text-[12px] font-semibold">Nova chave</span>
        <button
          onClick={() => setCreating(false)}
          title="Cancelar"
          className="ml-auto rounded p-1 text-text-subtle hover:bg-surface-hover hover:text-text"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-text-muted">Chave</span>
          <input
            autoFocus
            type="text"
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            placeholder="ex.: feature.novaHome"
            className="w-full max-w-md rounded-md border border-border bg-surface-raised px-3 py-1.5 font-mono text-[12px] placeholder:text-text-subtle"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-text-muted">Tipo</span>
          <select
            value={type}
            onChange={(e) => {
              const next = e.target.value as typeof type;
              setType(next);
              if (next === "json" && draft.trim() === "") setDraft("{}");
            }}
            className="w-40 rounded-md border border-border bg-surface-raised px-2 py-1.5 text-[12px]"
          >
            <option value="string">string</option>
            <option value="number">number</option>
            <option value="boolean">boolean</option>
            <option value="json">json</option>
          </select>
        </label>

        <label className="flex min-h-0 flex-1 flex-col gap-1.5">
          <span className="text-[11px] font-medium text-text-muted">Valor</span>
          {type === "boolean" ? (
            <button
              type="button"
              onClick={() => setBoolDraft((v) => !v)}
              role="switch"
              aria-checked={boolDraft}
              data-checked={boolDraft}
              className="rnsi-switch rnsi-switch-lg"
            />
          ) : type === "json" ? (
            <JsonWorkspace
              draft={draft}
              onDraftChange={setDraft}
              sourceName={keyName}
              minHeight="min-h-0"
            />
          ) : (
            <input
              type={type === "number" ? "number" : "text"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full max-w-md rounded-md border border-border bg-surface-raised px-3 py-1.5 font-mono text-[12px]"
            />
          )}
        </label>
      </div>

      <div className="flex h-11 shrink-0 items-center gap-2 border-t border-border px-4">
        <button
          onClick={() => void create()}
          disabled={saving}
          className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {saving ? "Criando…" : "Criar"}
        </button>
        <button
          onClick={() => setCreating(false)}
          className="rounded-md px-2.5 py-1.5 text-[12px] text-text-muted hover:bg-surface-hover"
        >
          Cancelar
        </button>
        {error && <span className="text-[12px] text-deleted">{error}</span>}
      </div>
    </div>
  );
}

type ValueType = StorageValue["type"];

/**
 * Editor por tipo (plano §5.2). O seletor de tipo é sempre visível: nem todo
 * provider tem introspecção (MMKV não distingue `123` de `"123"`), então
 * mudar o tipo é sempre uma decisão explícita do usuário — nunca um efeito
 * colateral silencioso da edição.
 */
export function ValueEditor() {
  const selection = useStudio((s) => s.selection);
  const selectedKey = useStudio((s) => s.selectedKey);
  const creating = useStudio((s) => s.creating);
  const entry = useStudio((s) =>
    selection && selectedKey
      ? s.keys[keysId(selection.providerId, selection.instanceId)]?.find(
          (e) => e.key === selectedKey,
        )
      : undefined,
  );

  const [draftType, setDraftType] = useState<ValueType>("string");
  const [draft, setDraft] = useState("");
  const [boolDraft, setBoolDraft] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "saving">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selection || !selectedKey) return;
    let cancelled = false;
    setState("loading");
    setError(null);
    void getValue(selection.providerId, selection.instanceId, selectedKey).then((value) => {
      if (cancelled) return;
      if (value) {
        setDraftType(value.type);
        if (value.type === "boolean") setBoolDraft(value.value);
        else if (value.type === "json") {
          try {
            setDraft(JSON.stringify(JSON.parse(value.value), null, 2));
          } catch {
            setDraft(value.value);
          }
        } else setDraft(value.type === "null" ? "" : String(value.value));
      }
      setState("ready");
    });
    return () => {
      cancelled = true;
    };
  }, [selection, selectedKey]);

  if (selection && creating) {
    return <CreateKeyForm providerId={selection.providerId} instanceId={selection.instanceId} />;
  }

  if (!selection || !selectedKey) {
    return (
      <div className="flex flex-1 items-center justify-center text-text-subtle">
        Selecione uma chave.
      </div>
    );
  }

  function buildValue(): StorageValue | { error: string } {
    switch (draftType) {
      case "string":
        return { type: "string", value: draft };
      case "number": {
        const n = Number(draft);
        return Number.isFinite(n) ? { type: "number", value: n } : { error: "número inválido" };
      }
      case "boolean":
        return { type: "boolean", value: boolDraft };
      case "json":
        try {
          JSON.parse(draft);
          return { type: "json", value: draft };
        } catch {
          return { error: "JSON inválido" };
        }
      case "null":
        return { type: "null", value: null };
      case "buffer":
        return { error: "buffers são somente leitura no MVP" };
    }
  }

  async function save(): Promise<void> {
    if (!selection || !selectedKey) return;
    const value = buildValue();
    if ("error" in value) {
      setError(value.error);
      return;
    }
    setState("saving");
    setError(null);
    try {
      // A UI não confirma antes do runtime responder (regra do protocolo).
      await setValue(selection.providerId, selection.instanceId, selectedKey, value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setState("ready");
    }
  }

  async function remove(): Promise<void> {
    if (!selection || !selectedKey) return;
    setState("saving");
    try {
      await removeKey(selection.providerId, selection.instanceId, selectedKey);
      useStudio.getState().selectKey(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setState("ready");
    }
  }

  return (
    <div className="flex min-w-0 flex-1">
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {/* faixa de metadata — fina, não uma coluna (plano §5.2) */}
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border px-4">
        <span className="min-w-0 truncate font-mono text-[12px] font-semibold">
          {selectedKey}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-3 text-[11px] text-text-subtle">
          {entry && <span>{entry.approxSize} B</span>}
          <select
            value={draftType}
            onChange={(e) => {
              const next = e.target.value as ValueType;
              setDraftType(next);
              if (next === "json" && draft.trim() === "") setDraft("{}");
            }}
            className="rounded border border-border bg-surface-raised px-1.5 py-0.5 text-[11px] text-text-muted"
          >
            {(["string", "number", "boolean", "json", "null"] as const).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
        {state === "loading" ? (
          <p className="text-text-subtle">Carregando…</p>
        ) : draftType === "boolean" ? (
          <button
            type="button"
            onClick={() => setBoolDraft((v) => !v)}
            role="switch"
            aria-checked={boolDraft}
            data-checked={boolDraft}
            className="rnsi-switch rnsi-switch-lg"
          />
        ) : draftType === "null" ? (
          <p className="font-mono text-text-subtle">null</p>
        ) : draftType === "number" ? (
          <input
            type="number"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-64 rounded-md border border-border bg-surface-raised px-3 py-1.5 font-mono text-[12px]"
          />
        ) : draftType === "string" ? (
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full rounded-md border border-border bg-surface-raised px-3 py-1.5 font-mono text-[12px]"
          />
        ) : (
          <JsonWorkspace draft={draft} onDraftChange={setDraft} sourceName={selectedKey} />
        )}
      </div>

      <div className="flex h-11 shrink-0 items-center gap-2 border-t border-border px-4">
        <button
          onClick={() => void save()}
          disabled={state !== "ready"}
          className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {state === "saving" ? "Salvando…" : "Salvar"}
        </button>
        <button
          onClick={() => void remove()}
          disabled={state !== "ready"}
          title="Remover chave"
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] text-deleted hover:bg-deleted-wash disabled:opacity-50"
        >
          <Trash2 size={13} strokeWidth={1.5} />
          Remover
        </button>
        {error && <span className="text-[12px] text-deleted">{error}</span>}
      </div>
    </div>
    <KeyHistory
      historyKey={`${keysId(selection.providerId, selection.instanceId)} ${selectedKey}`}
    />
    </div>
  );
}
