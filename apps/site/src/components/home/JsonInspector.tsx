"use client";

/**
 * Porta fiel do JSON explorer do Studio (apps/desktop/src/components/ValueEditor.tsx)
 * para a landing. Mesmas classes Tailwind e mesmos tokens (@rnsi/tokens), então o
 * visual é idêntico ao dashboard. A única troca: em vez do WebSocket, o valor vem
 * por props (estado local) — é o produto de verdade rodando no browser.
 */

import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Braces,
  Check,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  Database,
  ListTree,
  Plus,
  Search,
  Table2,
  Trash2,
  X,
} from "lucide-react";

type JsonRoot = Record<string, unknown> | unknown[];
type JsonPath = Array<string | number>;
type JsonNewValueType = "string" | "number" | "boolean" | "object" | "array" | "null";
type JsonChangeAction = "edited" | "row-created" | "field-created" | "deleted" | "duplicated";

export type Pulse = { path: JsonPath; id: number } | null;

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
  "--w-rjv-type-boolean-color": "var(--accent)",
  "--w-rjv-type-null-color": "var(--deleted)",
} as CSSProperties;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isJsonRoot(value: unknown): value is JsonRoot {
  return typeof value === "object" && value !== null;
}
function isCollection(value: unknown): value is JsonRoot {
  return typeof value === "object" && value !== null;
}
function collectionSize(value: unknown): number | null {
  if (Array.isArray(value)) return value.length;
  if (isPlainObject(value)) return Object.keys(value).length;
  return null;
}
function isNavigableCollection(value: unknown): value is JsonRoot {
  const size = collectionSize(value);
  return size !== null && size > 0;
}
function valueKind(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}
function valueType(value: unknown): JsonNewValueType {
  if (Array.isArray(value)) return "array";
  if (isPlainObject(value)) return "object";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (value === null) return "null";
  return "string";
}
function collectionLabel(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} items`;
  if (isPlainObject(value)) return `${Object.keys(value).length} fields`;
  return valueKind(value);
}
function compactValueKind(values: unknown[]): string {
  const kinds = [...new Set(values.map(valueKind).filter((k) => k !== "undefined"))];
  if (kinds.length === 0) return "unknown";
  if (kinds.length === 1) return kinds[0] ?? "unknown";
  return "mixed";
}
function rootLabel(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} items`;
  if (isJsonRoot(value)) return `${Object.keys(value).length} keys`;
  if (value === null) return "null";
  return typeof value;
}
function pathLabel(segment: string | number): string {
  return typeof segment === "number" ? `#${segment + 1}` : segment;
}
function getAtPath(root: unknown, path: JsonPath): unknown {
  return path.reduce<unknown>((current, segment) => {
    if (Array.isArray(current) && typeof segment === "number") return current[segment];
    if (isPlainObject(current) && typeof segment === "string") return current[segment];
    return undefined;
  }, root);
}
export function setAtPath(root: unknown, path: JsonPath, value: unknown): unknown {
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
function duplicateAtPath(root: unknown, path: JsonPath): unknown {
  const parentPath = path.slice(0, -1);
  const leaf = path[path.length - 1];
  const parent = getAtPath(root, parentPath);
  const value = getAtPath(root, path);
  const clone = JSON.parse(JSON.stringify(value));
  if (Array.isArray(parent) && typeof leaf === "number") {
    return setAtPath(root, parentPath, [...parent.slice(0, leaf + 1), clone, ...parent.slice(leaf + 1)]);
  }
  if (isPlainObject(parent) && typeof leaf === "string") {
    let nextKey = `${leaf}Copy`;
    let suffix = 2;
    while (Object.hasOwn(parent, nextKey)) nextKey = `${leaf}Copy${suffix++}`;
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
function defaultValueForType(type: JsonNewValueType): unknown {
  switch (type) {
    case "string": return "";
    case "number": return 0;
    case "boolean": return false;
    case "object": return {};
    case "array": return [];
    case "null": return null;
  }
}
function inferTypeFromValues(values: unknown[]): JsonNewValueType {
  const sample = values.find((v) => v !== undefined && v !== null);
  return sample === undefined ? "string" : valueType(sample);
}
function inferArraySchema(array: unknown[]): { name: string; type: JsonNewValueType }[] {
  const objectRows = array.filter(isPlainObject).slice(0, 300);
  const keys = [...new Set(objectRows.flatMap((row) => Object.keys(row)))].slice(0, 24);
  return keys.map((name) => ({ name, type: inferTypeFromValues(objectRows.map((row) => row[name])) }));
}
function rawDefaultForType(type: JsonNewValueType): string {
  const value = defaultValueForType(type);
  if (type === "object" || type === "array") return stringifyJson(value);
  if (type === "null") return "";
  return String(value);
}
function parseNewValue(type: JsonNewValueType, raw: string): { value: unknown } | { error: string } {
  if (type === "string") return { value: raw };
  if (type === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? { value: n } : { error: "Invalid number" };
  }
  if (type === "boolean") return { value: raw === "true" };
  if (type === "null") return { value: null };
  try {
    const parsed = JSON.parse(raw);
    if (type === "object" && !isPlainObject(parsed)) return { error: "Enter a JSON object" };
    if (type === "array" && !Array.isArray(parsed)) return { error: "Enter a JSON array" };
    return { value: parsed };
  } catch {
    return { error: "Invalid JSON" };
  }
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
      : Object.entries(input).slice(0, 30).flatMap(([k, c]) => [k, c]);
    return values.map(walk).join(" ");
  }
  return walk(value).toLowerCase();
}

type JsonTableRow = { index: number; value: unknown };
type JsonObjectFieldRow = { key: string; value: unknown };
type JsonGridColumn<Row> = { id: string; width: string; header: ReactNode; cell: (row: Row) => ReactNode };
type JsonAddModalState =
  | { kind: "array"; path: JsonPath; array: unknown[] }
  | { kind: "field"; path: JsonPath; keys: string[] };

function JsonPrimitiveEditor({
  value,
  onChange,
  variant = "field",
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  variant?: "field" | "cell";
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value ?? ""));
  const isCell = variant === "cell";
  const inputClass = isCell
    ? "h-7 w-full border-0 bg-transparent px-2.5 font-mono text-[11px] text-text outline-none focus:bg-surface-raised focus-visible:outline-none"
    : "h-7 w-full rounded-sm border border-border bg-surface px-2 font-mono text-[11px] outline-none focus:border-accent";

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
        onClick={() => onChange(!value)}
        className={`w-full text-left font-mono text-[11px] outline-none hover:bg-surface-hover focus-visible:outline-none ${
          isCell ? "h-7 px-2.5" : "h-7 rounded-sm border border-transparent px-2 hover:border-border"
        } ${value ? "text-created" : "text-text-subtle"}`}
      >
        {String(value)}
      </button>
    );
  }
  if (typeof value === "number") {
    return (
      <input
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setDraft(String(value));
        }}
        className={inputClass}
      />
    );
  }
  if (value === null) {
    return <span className={`block font-mono text-[11px] text-deleted ${isCell ? "px-2.5 py-1.5" : ""}`}>null</span>;
  }
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setDraft(value === null ? "" : String(value ?? ""));
      }}
      className={inputClass}
    />
  );
}

function JsonColumnHeader({ label, type }: { label: string; type?: string }) {
  return (
    <div className="flex h-full min-w-0 items-center gap-1.5 px-2.5">
      <span className="min-w-0 truncate font-semibold text-text">{label}</span>
      {type && <span className="shrink-0 text-[10px] font-normal uppercase text-text-subtle">{type}</span>}
    </div>
  );
}

function CollectionCell({ label, onOpen }: { label: string; onOpen?: () => void }) {
  const content = (
    <>
      <Database size={12} strokeWidth={1.5} className="shrink-0 text-accent" />
      <span className="min-w-0 truncate">{label}</span>
      {onOpen && (
        <span className="ml-auto flex shrink-0 items-center gap-0.5 text-[11px] text-text-subtle group-hover:text-accent">
          open
          <ChevronRight size={13} strokeWidth={1.5} />
        </span>
      )}
    </>
  );
  if (!onOpen) {
    return <div className="flex h-7 w-full items-center gap-2 px-2.5 text-left text-text-muted">{content}</div>;
  }
  return (
    <button
      onClick={onOpen}
      title="Open"
      className="group flex h-7 w-full cursor-pointer items-center gap-2 px-2.5 text-left text-text-muted hover:bg-surface-hover hover:text-text"
    >
      {content}
    </button>
  );
}

function JsonDataGrid<Row>({
  columns,
  rows,
  getRowKey,
  emptyLabel,
  flash,
}: {
  columns: Array<JsonGridColumn<Row>>;
  rows: Row[];
  getRowKey: (row: Row) => string;
  emptyLabel: string;
  flash?: { key: string; id: number } | null;
}) {
  const templateColumns = columns.map((c) => c.width).join(" ");
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 33,
    overscan: 12,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const paddingTop = virtualItems[0]?.start ?? 0;
  const paddingBottom = virtualizer.getTotalSize() - (virtualItems[virtualItems.length - 1]?.end ?? 0);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
      <div className="flex min-h-full min-w-full flex-col">
        <div
          className="sticky top-0 z-10 grid h-8 shrink-0 border-b border-border bg-surface font-mono text-[11px]"
          style={{ gridTemplateColumns: templateColumns }}
        >
          {columns.map((column) => (
            <div key={column.id} className="min-w-0 border-r border-border">
              {column.header}
            </div>
          ))}
        </div>

        {rows.length === 0 ? (
          <div className="flex h-14 shrink-0 items-center border-b border-border px-3 text-[12px] text-text-subtle">
            {emptyLabel}
          </div>
        ) : (
          <div className="shrink-0">
            {paddingTop > 0 && <div style={{ height: paddingTop }} />}
            {virtualItems.map((virtualItem) => {
              const row = rows[virtualItem.index] as Row;
              const rowKey = getRowKey(row);
              const flashing = flash && flash.key === rowKey;
              return (
                <div
                  key={rowKey}
                  className="relative grid min-h-7 border-b border-border font-mono text-[11px] hover:bg-surface-hover"
                  style={{ gridTemplateColumns: templateColumns }}
                >
                  {flashing && <span key={flash.id} data-json-flash aria-hidden />}
                  {columns.map((column) => (
                    <div key={column.id} className="min-w-0 border-r border-border">
                      {column.cell(row)}
                    </div>
                  ))}
                </div>
              );
            })}
            {paddingBottom > 0 && <div style={{ height: paddingBottom }} />}
          </div>
        )}
      </div>
    </div>
  );
}

function JsonValueDraftInput({
  type,
  value,
  onChange,
}: {
  type: JsonNewValueType;
  value: string;
  onChange: (value: string) => void;
}) {
  if (type === "boolean") {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-full rounded border border-border bg-surface px-2 text-[11px] outline-none focus:border-accent"
      >
        <option value="false">false</option>
        <option value="true">true</option>
      </select>
    );
  }
  if (type === "null") {
    return (
      <div className="flex h-7 items-center rounded border border-border bg-surface-sunken px-2 font-mono text-[11px] text-text-subtle">
        null
      </div>
    );
  }
  if (type === "object" || type === "array") {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="min-h-16 w-full resize-y rounded border border-border bg-surface px-2 py-1.5 font-mono text-[11px] leading-relaxed outline-none focus:border-accent"
      />
    );
  }
  return (
    <input
      type={type === "number" ? "number" : "text"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 w-full rounded border border-border bg-surface px-2 font-mono text-[11px] outline-none focus:border-accent"
    />
  );
}

function JsonAddDrawer({
  state,
  onClose,
  onCreateArrayItem,
  onCreateField,
}: {
  state: JsonAddModalState;
  onClose: () => void;
  onCreateArrayItem: (path: JsonPath, value: unknown) => void;
  onCreateField: (path: JsonPath, name: string, value: unknown) => string | null;
}) {
  const schema = useMemo(() => (state.kind === "array" ? inferArraySchema(state.array) : []), [state]);
  const [arrayType, setArrayType] = useState<JsonNewValueType>("string");
  const [arrayValue, setArrayValue] = useState("");
  const [rowValues, setRowValues] = useState<Record<string, string>>({});
  const [fieldName, setFieldName] = useState("");
  const [fieldType, setFieldType] = useState<JsonNewValueType>("string");
  const [fieldValue, setFieldValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    if (state.kind === "array") {
      const nextSchema = inferArraySchema(state.array);
      if (nextSchema.length > 0) {
        setRowValues(Object.fromEntries(nextSchema.map((f) => [f.name, rawDefaultForType(f.type)])));
      } else {
        const inferred = inferTypeFromValues(state.array);
        setArrayType(inferred);
        setArrayValue(rawDefaultForType(inferred));
      }
    } else {
      setFieldName("");
      setFieldType("string");
      setFieldValue(rawDefaultForType("string"));
    }
  }, [state]);

  function create(): void {
    setError(null);
    if (state.kind === "array") {
      if (schema.length > 0) {
        const row: Record<string, unknown> = {};
        for (const field of schema) {
          const parsed = parseNewValue(field.type, rowValues[field.name] ?? rawDefaultForType(field.type));
          if ("error" in parsed) return setError(`${field.name}: ${parsed.error}`);
          row[field.name] = parsed.value;
        }
        onCreateArrayItem(state.path, row);
        return onClose();
      }
      const parsed = parseNewValue(arrayType, arrayValue);
      if ("error" in parsed) return setError(parsed.error);
      onCreateArrayItem(state.path, parsed.value);
      return onClose();
    }
    const name = fieldName.trim();
    if (!name) return setError("Enter a field name");
    const parsed = parseNewValue(fieldType, fieldValue);
    if ("error" in parsed) return setError(parsed.error);
    const fieldError = onCreateField(state.path, name, parsed.value);
    if (fieldError) return setError(fieldError);
    onClose();
  }

  return (
    <aside data-json-add-drawer className="absolute inset-y-0 right-0 z-30 flex w-[min(360px,100%)] flex-col border-l border-border bg-surface-raised shadow-xl shadow-black/10">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <Plus size={13} strokeWidth={1.5} className="text-accent" />
        <div className="min-w-0">
          <h3 className="truncate text-[12px] font-semibold">{state.kind === "array" ? "New row" : "New field"}</h3>
          <p className="truncate text-[10px] text-text-subtle">
            {state.kind === "array" && schema.length > 0
              ? "Fields and types inferred from the collection"
              : state.kind === "array"
                ? "No schema detected for this collection"
                : "Name, type, and value for the new field"}
          </p>
        </div>
        <button onClick={onClose} title="Close" className="ml-auto rounded p-1 text-text-subtle hover:bg-surface-hover hover:text-text">
          <X size={13} strokeWidth={1.5} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {state.kind === "array" && schema.length > 0 ? (
          <div className="flex flex-col gap-4">
            {schema.map((field) => (
              <div key={field.name} className="grid grid-cols-[110px_1fr] gap-3">
                <div className="min-w-0">
                  <div className="truncate font-mono text-[11px] font-semibold text-text">{field.name}</div>
                  <div className="mt-0.5 font-mono text-[9px] uppercase text-text-subtle">{field.type}</div>
                </div>
                <JsonValueDraftInput
                  type={field.type}
                  value={rowValues[field.name] ?? rawDefaultForType(field.type)}
                  onChange={(next) => setRowValues((c) => ({ ...c, [field.name]: next }))}
                />
              </div>
            ))}
          </div>
        ) : state.kind === "array" ? (
          <div className="grid gap-3">
            <label className="grid gap-1.5">
              <span className="text-[11px] font-medium text-text-muted">Type</span>
              <select
                value={arrayType}
                onChange={(e) => {
                  const t = e.target.value as JsonNewValueType;
                  setArrayType(t);
                  setArrayValue(rawDefaultForType(t));
                }}
                className="h-7 w-40 rounded border border-border bg-surface px-2 text-[11px]"
              >
                {["string", "number", "boolean", "object", "array", "null"].map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-[11px] font-medium text-text-muted">Value</span>
              <JsonValueDraftInput type={arrayType} value={arrayValue} onChange={setArrayValue} />
            </label>
          </div>
        ) : (
          <div className="grid gap-3">
            <label className="grid gap-1.5">
              <span className="text-[11px] font-medium text-text-muted">Name</span>
              <input
                autoFocus
                value={fieldName}
                onChange={(e) => setFieldName(e.target.value)}
                placeholder="newField"
                className="h-7 rounded border border-border bg-surface px-2 font-mono text-[11px] outline-none focus:border-accent"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-[11px] font-medium text-text-muted">Type</span>
              <select
                value={fieldType}
                onChange={(e) => {
                  const t = e.target.value as JsonNewValueType;
                  setFieldType(t);
                  setFieldValue(rawDefaultForType(t));
                }}
                className="h-7 w-40 rounded border border-border bg-surface px-2 text-[11px]"
              >
                {["string", "number", "boolean", "object", "array", "null"].map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-[11px] font-medium text-text-muted">Value</span>
              <JsonValueDraftInput type={fieldType} value={fieldValue} onChange={setFieldValue} />
            </label>
          </div>
        )}
      </div>
      <footer data-json-drawer-actions className="flex h-11 shrink-0 items-center gap-2 border-t border-border px-3">
        {error ? (
          <span className="min-w-0 flex-1 truncate text-[10px] text-deleted">{error}</span>
        ) : (
          <span className="min-w-0 flex-1 text-[10px] text-text-subtle">Saved automatically after creation.</span>
        )}
        <button onClick={onClose} className="h-7 min-w-16 rounded border border-border px-2.5 text-[10px] text-text-muted hover:bg-surface-hover">
          Cancel
        </button>
        <button onClick={create} className="h-7 min-w-16 rounded bg-accent px-2.5 text-[10px] font-medium text-white hover:bg-accent-hover">
          Create
        </button>
      </footer>
    </aside>
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
  const currentLabel = path.length === 0 ? "Root" : pathLabel(path[path.length - 1] ?? "Root");
  return (
    <div data-json-breadcrumb className="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-surface-sunken px-2 text-[10px]">
      {path.length > 0 ? (
        <button
          onClick={() => onNavigate(path.slice(0, -1))}
          className="inline-flex h-[22px] items-center gap-1 rounded border border-border bg-surface-raised px-1.5 font-medium text-text-muted hover:bg-surface-hover hover:text-text"
        >
          <ChevronLeft size={12} strokeWidth={1.5} />
          Back
        </button>
      ) : (
        <span className="inline-flex h-[22px] items-center rounded border border-transparent px-1.5 text-text-subtle">Root</span>
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

function JsonVisualExplorer({
  value,
  sourceName,
  onChange,
  path,
  setPath,
  pulse,
}: {
  value: unknown;
  sourceName?: string;
  onChange: (value: unknown, action: JsonChangeAction, changedPath: JsonPath) => void;
  path: JsonPath;
  setPath: (path: JsonPath) => void;
  pulse: Pulse;
}) {
  const [query, setQuery] = useState("");
  const [addModal, setAddModal] = useState<JsonAddModalState | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(() => new Set());
  const current = getAtPath(value, path);

  const flash = useMemo(() => {
    if (!pulse || pulse.path.length <= path.length) return null;
    for (let i = 0; i < path.length; i++) if (String(pulse.path[i]) !== String(path[i])) return null;
    return { key: String(pulse.path[path.length]), id: pulse.id };
  }, [pulse, path]);

  function updatePath(targetPath: JsonPath, nextValue: unknown, action: JsonChangeAction = "edited"): void {
    onChange(setAtPath(value, targetPath, nextValue), action, targetPath);
  }
  function navigate(nextPath: JsonPath): void {
    setPath(nextPath);
    setQuery("");
    setSelectedItems(new Set());
  }

  const arrayView = useMemo(() => {
    if (!Array.isArray(current)) return { rows: [] as JsonTableRow[], limited: false };
    const q = query.trim().toLowerCase();
    if (!q) return { rows: current.map((item, index) => ({ index, value: item })), limited: false };
    const scanLimit = Math.min(current.length, 5000);
    const matched: JsonTableRow[] = [];
    for (let index = 0; index < scanLimit; index += 1) {
      if (searchPreview(current[index]).includes(q)) matched.push({ index, value: current[index] });
    }
    return { rows: matched, limited: scanLimit < current.length };
  }, [current, query]);

  const objectEntries = useMemo<Array<[string, unknown]>>(() => {
    if (!isPlainObject(current)) return [];
    const entries = Object.entries(current);
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(([key, child]) => key.toLowerCase().includes(q) || searchPreview(child).includes(q));
  }, [current, query]);

  const arrayRows = arrayView.rows;
  const visibleArrayKeys = arrayRows.map((r) => String(r.index));
  const allVisibleArraySelected = visibleArrayKeys.length > 0 && visibleArrayKeys.every((k) => selectedItems.has(k));
  const objectKeys = isPlainObject(current) ? Object.keys(current) : [];
  const visibleObjectKeys = objectEntries.map(([k]) => k);
  const allObjectFieldsSelected = visibleObjectKeys.length > 0 && visibleObjectKeys.every((k) => selectedItems.has(k));

  function toggleSelected(key: string): void {
    setSelectedItems((c) => {
      const next = new Set(c);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function toggleVisibleArrayRows(): void {
    setSelectedItems((c) => {
      const next = new Set(c);
      const checked = visibleArrayKeys.length > 0 && visibleArrayKeys.every((k) => next.has(k));
      for (const k of visibleArrayKeys) {
        if (checked) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  }
  function toggleObjectFields(): void {
    setSelectedItems((c) => {
      const next = new Set(c);
      const checked = visibleObjectKeys.length > 0 && visibleObjectKeys.every((k) => next.has(k));
      for (const k of visibleObjectKeys) {
        if (checked) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  }
  const clearSelection = () => setSelectedItems(new Set());

  function deleteSelectedArrayRows(): void {
    if (!Array.isArray(current) || selectedItems.size === 0) return;
    const selected = new Set([...selectedItems].map(Number).filter(Number.isInteger));
    updatePath(path, current.filter((_, i) => !selected.has(i)), "deleted");
    clearSelection();
  }
  function deleteSelectedObjectFields(): void {
    if (!isPlainObject(current) || selectedItems.size === 0) return;
    const next = { ...current };
    for (const key of selectedItems) delete next[key];
    updatePath(path, next, "deleted");
    clearSelection();
  }
  function duplicateSelectedArrayRow(): void {
    if (!Array.isArray(current) || selectedItems.size !== 1) return;
    const index = Number([...selectedItems][0]);
    if (!Number.isInteger(index)) return;
    onChange(duplicateAtPath(value, [...path, index]), "duplicated", path);
    clearSelection();
  }
  function duplicateSelectedObjectField(): void {
    if (!isPlainObject(current) || selectedItems.size !== 1) return;
    const key = [...selectedItems][0];
    if (key === undefined) return;
    onChange(duplicateAtPath(value, [...path, key]), "duplicated", path);
    clearSelection();
  }

  const arrayRowsHaveObjectShape = Array.isArray(current) && current.some(isPlainObject);

  const arrayGridColumns = useMemo<Array<JsonGridColumn<JsonTableRow>>>(() => {
    if (!Array.isArray(current)) return [];
    const objectRows = current.slice(0, 300).map((item, index) => ({ index, value: item })).filter((r) => isPlainObject(r.value));
    const keys = [...new Set(objectRows.flatMap((r) => Object.keys(r.value as Record<string, unknown>)))].slice(0, 12);
    const selectCol: JsonGridColumn<JsonTableRow> = {
      id: "__select",
      width: "40px",
      header: (
        <div className="flex h-full items-center justify-center px-2">
          <input type="checkbox" checked={allVisibleArraySelected} onChange={toggleVisibleArrayRows} aria-label="Select rows" className="h-3.5 w-3.5 rounded border-border accent-accent" />
        </div>
      ),
      cell: (row) => (
        <div className="flex h-8 items-center justify-center px-2">
          <input type="checkbox" checked={selectedItems.has(String(row.index))} onChange={() => toggleSelected(String(row.index))} aria-label="Select row" className="h-3.5 w-3.5 rounded border-border accent-accent" />
        </div>
      ),
    };
    if (keys.length === 0) {
      return [
        selectCol,
        { id: "__index", width: "96px", header: <JsonColumnHeader label="#" type="number" />, cell: (row) => <div className="flex h-8 items-center px-3 text-[11px] text-text-subtle">#{row.index + 1}</div> },
        {
          id: "value",
          width: "minmax(260px,1fr)",
          header: <JsonColumnHeader label="value" type={compactValueKind(current.slice(0, 300))} />,
          cell: (row) =>
            isCollection(row.value) ? (
              <CollectionCell label={collectionLabel(row.value)} onOpen={isNavigableCollection(row.value) ? () => navigate([...path, row.index]) : undefined} />
            ) : (
              <JsonPrimitiveEditor value={row.value} onChange={(next) => updatePath([...path, row.index], next)} variant="cell" />
            ),
        },
      ];
    }
    return [
      selectCol,
      {
        id: "__index",
        width: "88px",
        header: <JsonColumnHeader label="#" type="row" />,
        cell: (row) =>
          !isNavigableCollection(row.value) ? (
            <div className="flex h-8 items-center px-3 text-[11px] text-text-subtle"><span className="tabular-nums">#{row.index + 1}</span></div>
          ) : (
            <button onClick={() => navigate([...path, row.index])} title="Open row" className="group flex h-8 w-full cursor-pointer items-center gap-1 px-3 text-left text-[11px] text-text-subtle hover:bg-surface-hover hover:text-accent">
              <span className="tabular-nums">#{row.index + 1}</span>
              <ChevronRight size={12} strokeWidth={1.5} className="ml-auto text-text-subtle group-hover:text-accent" />
            </button>
          ),
      },
      ...keys.map<JsonGridColumn<JsonTableRow>>((key) => ({
        id: key,
        width: "minmax(180px,1fr)",
        header: <JsonColumnHeader label={key} type={compactValueKind(objectRows.map((r) => (r.value as Record<string, unknown>)[key]))} />,
        cell: (row) => {
          const cellValue = isPlainObject(row.value) ? row.value[key] : undefined;
          const cellPath = [...path, row.index, key];
          return isCollection(cellValue) ? (
            <CollectionCell label={collectionLabel(cellValue)} onOpen={isNavigableCollection(cellValue) ? () => navigate(cellPath) : undefined} />
          ) : (
            <JsonPrimitiveEditor value={cellValue} onChange={(next) => updatePath(cellPath, next)} variant="cell" />
          );
        },
      })),
    ];
  }, [allVisibleArraySelected, current, path, selectedItems, value]);

  const objectGridRows = useMemo<JsonObjectFieldRow[]>(() => objectEntries.map(([key, v]) => ({ key, value: v })), [objectEntries]);

  const objectGridColumns = useMemo<Array<JsonGridColumn<JsonObjectFieldRow>>>(() => {
    const valueTypeLabel = compactValueKind(objectEntries.map(([, v]) => v));
    return [
      {
        id: "__select",
        width: "40px",
        header: (
          <div className="flex h-full items-center justify-center px-2">
            <input type="checkbox" checked={allObjectFieldsSelected} onChange={toggleObjectFields} aria-label="Select fields" className="h-3.5 w-3.5 rounded border-border accent-accent" />
          </div>
        ),
        cell: (row) => (
          <div className="flex h-8 items-center justify-center px-2">
            <input type="checkbox" checked={selectedItems.has(row.key)} onChange={() => toggleSelected(row.key)} aria-label="Select field" className="h-3.5 w-3.5 rounded border-border accent-accent" />
          </div>
        ),
      },
      {
        id: "field",
        width: "minmax(190px,0.65fr)",
        header: <JsonColumnHeader label="field" type="string" />,
        cell: (row) => (
          <div className="flex h-8 min-w-0 items-center px-3 font-semibold"><span className="truncate">{row.key}</span></div>
        ),
      },
      {
        id: "value",
        width: "minmax(260px,1fr)",
        header: <JsonColumnHeader label="value" type={valueTypeLabel} />,
        cell: (row) => {
          const childPath = [...path, row.key];
          return isCollection(row.value) ? (
            <CollectionCell label={collectionLabel(row.value)} onOpen={isNavigableCollection(row.value) ? () => navigate(childPath) : undefined} />
          ) : (
            <JsonPrimitiveEditor value={row.value} onChange={(next) => updatePath(childPath, next)} variant="cell" />
          );
        },
      },
    ];
  }, [allObjectFieldsSelected, objectEntries, path, selectedItems, value]);

  function createArrayItem(targetPath: JsonPath, item: unknown): void {
    const target = getAtPath(value, targetPath);
    if (!Array.isArray(target)) return;
    updatePath(targetPath, [...target, item], "row-created");
  }
  function createField(targetPath: JsonPath, name: string, fieldValue: unknown): string | null {
    const target = getAtPath(value, targetPath);
    if (!isPlainObject(target)) return "Object not found";
    if (Object.hasOwn(target, name)) return "A field with this name already exists";
    updatePath(targetPath, { ...target, [name]: fieldValue }, "field-created");
    return null;
  }

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

  const selectionBar = (onDuplicate: () => void, onDelete: () => void) =>
    selectedItems.size > 0 ? (
      <div data-json-selection className="flex min-w-0 items-center gap-1 whitespace-nowrap">
        <span className="inline-flex h-[22px] items-center rounded border border-border bg-surface-sunken px-1.5 text-[9px] text-text-muted">
          {selectedItems.size} selected
        </span>
        {selectedItems.size === 1 && (
          <button onClick={onDuplicate} className="inline-flex h-[22px] items-center gap-1 rounded border border-border px-1.5 text-[9px] font-medium text-text-muted hover:bg-surface-hover hover:text-text">
            <Copy size={10} strokeWidth={1.5} />Duplicate
          </button>
        )}
        <button onClick={onDelete} className="inline-flex h-[22px] items-center gap-1 rounded border border-deleted/30 bg-deleted-wash px-1.5 text-[9px] font-medium text-deleted">
          <Trash2 size={10} strokeWidth={1.5} />Delete
        </button>
        <button onClick={clearSelection} className="inline-flex h-[22px] items-center rounded border border-transparent px-1 text-[9px] text-text-subtle hover:border-border hover:bg-surface-hover hover:text-text">
          Clear
        </button>
      </div>
    ) : null;

  return (
    <div className="relative flex h-full min-h-72 flex-col overflow-hidden rounded-md border border-border bg-surface-raised">
      <JsonVisualHeader sourceName={sourceName} path={path} onNavigate={navigate} />

      {Array.isArray(current) ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div data-json-tablebar className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border px-2">
            <div className="relative w-40 shrink-0 xl:w-44">
              <Search size={11} strokeWidth={1.5} className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-text-subtle" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${path[path.length - 1] ?? "array"}...`} className="h-[22px] w-full rounded border border-border bg-surface px-1.5 pl-5 text-[10px] outline-none focus:border-accent" />
            </div>
            {selectionBar(duplicateSelectedArrayRow, deleteSelectedArrayRows)}
            <button onClick={() => setAddModal({ kind: "array", path, array: current })} className="ml-auto inline-flex h-[22px] shrink-0 items-center gap-1 rounded border border-border px-1.5 text-[9px] text-text-muted hover:bg-surface-hover hover:text-text">
              <Plus size={10} strokeWidth={1.5} />Add
            </button>
          </div>
          <JsonDataGrid columns={arrayGridColumns} rows={arrayRows} getRowKey={(r) => String(r.index)} emptyLabel={arrayRowsHaveObjectShape ? "No records found." : "No items found."} flash={flash} />
          <div className="flex h-10 shrink-0 items-center gap-2 border-t border-border px-3 text-[12px] text-text-muted">
            <span>{arrayRows.length} {arrayRows.length === 1 ? "item" : "items"}{query.trim() ? " found" : ""}</span>
            {arrayView.limited && <span className="ml-auto text-text-subtle">searching the first 5,000 items</span>}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div data-json-tablebar className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border px-2">
            <div className="relative w-40 shrink-0 xl:w-44">
              <Search size={11} strokeWidth={1.5} className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-text-subtle" />
              <input value={query} onChange={(e) => { setQuery(e.target.value); setSelectedItems(new Set()); }} placeholder="Search fields..." className="h-[22px] w-full rounded border border-border bg-surface px-1.5 pl-5 text-[10px] outline-none focus:border-accent" />
            </div>
            <span className="shrink-0 whitespace-nowrap font-mono text-[10px] font-semibold text-text">
              {query.trim() ? `${objectEntries.length} of ${objectKeys.length}` : objectKeys.length} fields
            </span>
            {selectionBar(duplicateSelectedObjectField, deleteSelectedObjectFields)}
            <button onClick={() => setAddModal({ kind: "field", path, keys: objectKeys })} className="ml-auto inline-flex h-[22px] shrink-0 items-center gap-1 rounded border border-border px-1.5 text-[9px] text-text-muted hover:bg-surface-hover hover:text-text">
              <Plus size={10} strokeWidth={1.5} />Add field
            </button>
          </div>
          <JsonDataGrid columns={objectGridColumns} rows={objectGridRows} getRowKey={(r) => r.key} emptyLabel="No fields found." flash={flash} />
        </div>
      )}

      {addModal && (
        <JsonAddDrawer state={addModal} onClose={() => setAddModal(null)} onCreateArrayItem={createArrayItem} onCreateField={createField} />
      )}
    </div>
  );
}

export function JsonInspector({
  value,
  sourceName,
  onChange,
  pulse,
}: {
  value: JsonRoot;
  sourceName?: string;
  onChange: (value: unknown, changedPath: JsonPath) => void;
  pulse: Pulse;
}) {
  const [mode, setMode] = useState<"visual" | "tree" | "raw">("visual");
  const [path, setPath] = useState<JsonPath>([]);
  const [copied, setCopied] = useState(false);

  async function copyJson(): Promise<void> {
    try {
      await navigator.clipboard.writeText(stringifyJson(value));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  const modes = [
    { id: "visual" as const, label: "Visual", Icon: Table2 },
    { id: "tree" as const, label: "Tree", Icon: ListTree },
    { id: "raw" as const, label: "Raw", Icon: Code2 },
  ];

  return (
    <div data-json-inspector className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-surface-raised">
      <div data-json-modebar className="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-surface-sunken px-1.5">
        <div className="flex rounded border border-border bg-surface-raised p-0.5">
          {modes.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              className={`flex h-[22px] items-center gap-1 rounded-sm px-1.5 text-[9px] ${mode === id ? "bg-accent text-white" : "text-text-muted hover:bg-surface-hover"}`}
            >
              <Icon size={10} strokeWidth={1.5} />
              {label}
            </button>
          ))}
        </div>
        <span className="ml-1 hidden items-center gap-1 text-[9px] text-text-subtle sm:flex">
          <Braces size={10} strokeWidth={1.5} />
          {rootLabel(value)}
        </span>
        <button onClick={() => void copyJson()} title="Copy JSON" className="ml-auto grid h-[22px] w-[22px] place-items-center rounded-sm text-text-subtle hover:bg-surface-hover hover:text-text">
          {copied ? <Check size={11} strokeWidth={1.5} /> : <Copy size={11} strokeWidth={1.5} />}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {mode === "visual" ? (
          <JsonVisualExplorer value={value} sourceName={sourceName} onChange={(next, _action, changedPath) => onChange(next, changedPath)} path={path} setPath={setPath} pulse={pulse} />
        ) : mode === "tree" ? (
          <Suspense fallback={<div className="rounded-md border border-border bg-surface-sunken px-3 py-2 text-[12px] text-text-subtle">Loading JSON tree...</div>}>
            <JsonView value={value} keyName={sourceName ?? "root"} collapsed={2} displayDataTypes={false} displayObjectSize enableClipboard shortenTextAfterLength={96} indentWidth={18} style={jsonViewerTheme} className="text-[12px] leading-relaxed" />
          </Suspense>
        ) : (
          <pre className="min-h-full rounded-md border border-border bg-surface p-3 font-mono text-[12px] leading-relaxed text-text">
            <code>{stringifyJson(value)}</code>
          </pre>
        )}
      </div>
    </div>
  );
}
