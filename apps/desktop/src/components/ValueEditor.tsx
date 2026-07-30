import { Suspense, lazy, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
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
  FileCode2,
  History,
  ListFilter,
  ListTree,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Search,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import type { StorageValue } from "@rnsi/protocol";
import { useStudio, keysId } from "../lib/store.ts";
import { useLayout } from "../lib/layout.ts";
import {
  generateTypeScript,
  isPlainObject,
  typeNameFromKey,
  type TsArrayStyle,
  type TsDeclaration,
} from "../lib/typescript-gen.ts";
import { getFullValue, getValue, setValue, removeKey } from "../lib/studio-client.ts";
import { AppToast, type AppToastState } from "./AppToast.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import {
  JsonFilterDrawer,
  describeJsonFilter,
  inferJsonFilterFields,
  isJsonFilterConditionComplete,
  matchesJsonFilters,
  objectEntryFilterFields,
  type JsonFilterCondition,
  type JsonFilterField,
  type JsonFilterMode,
} from "./JsonFilterBuilder.tsx";
import { ResizeHandle } from "./ResizeHandle.tsx";
import { AutoTextarea } from "./AutoTextarea.tsx";

const HISTORY_LABEL = {
  created: "created",
  updated: "updated",
  removed: "removed",
} as const;

export function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

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
    return { value: null, error: cause instanceof Error ? cause.message : "Invalid JSON" };
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
  if (Array.isArray(value)) return `${value.length} items`;
  if (isJsonRoot(value)) return `${Object.keys(value).length} keys`;
  if (value === null) return "null";
  return typeof value;
}

// generateTypeScript e helpers agora vivem em ../lib/typescript-gen.ts (puro,
// testável e reusado pelo módulo de Network).

type JsonPath = Array<string | number>;
type JsonNewValueType = "string" | "number" | "boolean" | "object" | "array" | "null";
type JsonChangeAction = "edited" | "row-created" | "field-created" | "deleted" | "duplicated";

type JsonTableRow = {
  index: number;
  value: unknown;
};

type JsonObjectFieldRow = {
  key: string;
  value: unknown;
};

type JsonGridColumn<Row> = {
  id: string;
  width: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  className?: string;
};

type JsonSchemaField = {
  name: string;
  type: JsonNewValueType;
};

type JsonAddModalState =
  | { kind: "array"; path: JsonPath; array: unknown[] }
  | { kind: "field"; path: JsonPath; keys: string[] };

interface EditorToastState extends AppToastState {
  id: number;
}

function pathLabel(segment: string | number): string {
  return typeof segment === "number" ? `#${segment + 1}` : segment;
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

function collectionLabel(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} items`;
  if (isPlainObject(value)) return `${Object.keys(value).length} fields`;
  return valueKind(value);
}

function compactValueKind(values: unknown[]): string {
  const kinds = [...new Set(values.map(valueKind).filter((kind) => kind !== "undefined"))];
  if (kinds.length === 0) return "unknown";
  if (kinds.length === 1) return kinds[0] ?? "unknown";
  return "mixed";
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

function storageValueSignature(value: StorageValue): string {
  if (value.type === "json") {
    try {
      return JSON.stringify({ type: value.type, value: JSON.parse(value.value) });
    } catch {
      return JSON.stringify({ type: value.type, value: value.value });
    }
  }
  return JSON.stringify(value);
}

function defaultValueForType(type: JsonNewValueType): unknown {
  switch (type) {
    case "string":
      return "";
    case "number":
      return 0;
    case "boolean":
      return false;
    case "object":
      return {};
    case "array":
      return [];
    case "null":
      return null;
  }
}

function inferTypeFromValues(values: unknown[]): JsonNewValueType {
  const sample = values.find((value) => value !== undefined && value !== null);
  return sample === undefined ? "string" : valueType(sample);
}

function inferArraySchema(array: unknown[]): JsonSchemaField[] {
  const objectRows = array.filter(isPlainObject).slice(0, 300);
  const keys = [...new Set(objectRows.flatMap((row) => Object.keys(row)))].slice(0, 24);
  return keys.map((name) => ({
    name,
    type: inferTypeFromValues(objectRows.map((row) => row[name])),
  }));
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

function jsonActionMessage(action: JsonChangeAction, key: string): string {
  switch (action) {
    case "row-created":
      return `${key}: item added`;
    case "field-created":
      return `${key}: field added`;
    case "deleted":
      return `${key}: selection deleted`;
    case "duplicated":
      return `${key}: selection duplicated`;
    case "edited":
      return `${key}: value saved`;
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
  variant = "field",
  readOnly = false,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  variant?: "field" | "cell";
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value ?? ""));
  const isCell = variant === "cell";
  const inputClass = isCell
    ? "h-8 w-full border-0 bg-transparent px-3 font-mono text-[12px] text-text outline-none focus:bg-surface-raised focus-visible:outline-none"
    : "h-7 w-full rounded-sm border border-border bg-surface px-2 font-mono text-[12px] outline-none focus:border-accent";

  useEffect(() => {
    setDraft(value === null ? "" : String(value ?? ""));
  }, [value]);

  if (readOnly) {
    const displayValue = value === null ? "null" : String(value);
    const displayClass =
      value === null
        ? "text-deleted"
        : typeof value === "boolean"
          ? value
            ? "text-created"
            : "text-text-subtle"
          : "text-text";
    return (
      <span
        className={`block min-w-0 max-w-full whitespace-normal break-all px-3 py-2 font-mono text-[12px] ${displayClass}`}
      >
        {displayValue}
      </span>
    );
  }

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
        className={`w-full text-left font-mono text-[12px] outline-none hover:bg-surface-hover focus-visible:outline-none ${
          isCell ? "h-8 px-3" : "h-7 rounded-sm border border-transparent px-2 hover:border-border"
        } ${
          value ? "text-created" : "text-text-subtle"
        }`}
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
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setDraft(String(value));
        }}
        className={inputClass}
      />
    );
  }
  if (value === null) {
    return (
      <span className={`block font-mono text-[12px] text-deleted ${isCell ? "px-3 py-2" : ""}`}>
        null
      </span>
    );
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
      className={inputClass}
    />
  );
}

function JsonColumnHeader({ label, type }: { label: string; type?: string }) {
  return (
    <div className="flex h-full min-w-0 items-center gap-2 px-3">
      <span className="min-w-0 truncate font-semibold text-text">{label}</span>
      {type && (
        <span className="shrink-0 text-[11px] font-normal uppercase text-text-subtle">
          {type}
        </span>
      )}
    </div>
  );
}

/**
 * Célula de coleção — quando há conteúdo, a própria célula é o alvo de
 * navegação. Coleção vazia é informativa, sem seta/cursor: não há destino útil.
 */
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
    return (
      <div className="flex h-8 w-full items-center gap-2 px-3 text-left text-text-muted">
        {content}
      </div>
    );
  }

  return (
    <button
      onClick={onOpen}
      title="Open"
      className="group flex h-8 w-full cursor-pointer items-center gap-2 px-3 text-left text-text-muted hover:bg-surface-hover hover:text-text"
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
  readOnly = false,
}: {
  columns: Array<JsonGridColumn<Row>>;
  rows: Row[];
  getRowKey: (row: Row) => string;
  emptyLabel: string;
  readOnly?: boolean;
}) {
  const visibleColumns = readOnly ? columns.filter((column) => column.id !== "__select") : columns;
  const templateColumns = visibleColumns.map((column) => column.width).join(" ");
  const minimumGridWidth = visibleColumns.reduce((total, column) => {
    const pixelWidth = column.width.match(/([\d.]+)px/)?.[1];
    return total + (pixelWidth ? Number(pixelWidth) : 180);
  }, 0);
  // Virtualização (plano §C): um array/objeto com dezenas de milhares de
  // itens vira ~30 nós DOM. Spacers em fluxo normal preservam o grid e o
  // scroll horizontal (alinhados ao header sticky).
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
      <div
        className="flex min-h-full flex-col"
        style={{ width: `max(100%, ${minimumGridWidth}px)` }}
      >
        <div
          className="sticky top-0 z-10 grid h-9 shrink-0 border-b border-border bg-surface font-mono text-[12px]"
          style={{ gridTemplateColumns: templateColumns }}
        >
          {visibleColumns.map((column) => (
            <div
              key={column.id}
              className={`min-w-0 border-r border-border ${column.className ?? ""}`}
            >
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
              return (
                <div
                  key={getRowKey(row)}
                  ref={virtualizer.measureElement}
                  data-index={virtualItem.index}
                  className="grid min-h-8 border-b border-border font-mono text-[12px] hover:bg-surface-hover"
                  style={{ gridTemplateColumns: templateColumns }}
                >
                  {visibleColumns.map((column) => (
                    <div
                      key={column.id}
                      className={`min-w-0 ${readOnly ? "overflow-hidden" : ""} border-r border-border ${column.className ?? ""}`}
                    >
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
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-full rounded-md border border-border bg-surface px-2 text-[12px] outline-none focus:border-accent"
      >
        <option value="false">false</option>
        <option value="true">true</option>
      </select>
    );
  }
  if (type === "null") {
    return (
      <div className="flex h-8 items-center rounded-md border border-border bg-surface-sunken px-2 font-mono text-[12px] text-text-subtle">
        null
      </div>
    );
  }
  if (type === "object" || type === "array") {
    return (
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        className="min-h-20 w-full resize-y rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-[12px] leading-relaxed outline-none focus:border-accent"
      />
    );
  }
  return (
    <input
      type={type === "number" ? "number" : "text"}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 w-full rounded-md border border-border bg-surface px-2 font-mono text-[12px] outline-none focus:border-accent"
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
  const schema = useMemo(
    () => (state.kind === "array" ? inferArraySchema(state.array) : []),
    [state],
  );
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
        setRowValues(
          Object.fromEntries(nextSchema.map((field) => [field.name, rawDefaultForType(field.type)])),
        );
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

  function updateFieldType(type: JsonNewValueType): void {
    setFieldType(type);
    setFieldValue(rawDefaultForType(type));
  }

  function updateArrayType(type: JsonNewValueType): void {
    setArrayType(type);
    setArrayValue(rawDefaultForType(type));
  }

  function create(): void {
    setError(null);
    if (state.kind === "array") {
      if (schema.length > 0) {
        const row: Record<string, unknown> = {};
        for (const field of schema) {
          const parsed = parseNewValue(field.type, rowValues[field.name] ?? rawDefaultForType(field.type));
          if ("error" in parsed) {
            setError(`${field.name}: ${parsed.error}`);
            return;
          }
          row[field.name] = parsed.value;
        }
        onCreateArrayItem(state.path, row);
        onClose();
        return;
      }
      const parsed = parseNewValue(arrayType, arrayValue);
      if ("error" in parsed) {
        setError(parsed.error);
        return;
      }
      onCreateArrayItem(state.path, parsed.value);
      onClose();
      return;
    }

    const name = fieldName.trim();
    if (!name) {
      setError("Enter a field name");
      return;
    }
    const parsed = parseNewValue(fieldType, fieldValue);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    const fieldError = onCreateField(state.path, name, parsed.value);
    if (fieldError) {
      setError(fieldError);
      return;
    }
    onClose();
  }

  return (
    <aside className="rnsi-drawer-in absolute inset-y-0 right-0 z-30 flex w-[min(520px,100%)] flex-col border-l border-border bg-surface-raised shadow-xl shadow-black/10">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <Plus size={15} strokeWidth={1.5} className="text-accent" />
        <div className="min-w-0">
          <h2 className="truncate text-[13px] font-semibold">
            {state.kind === "array" ? "New row" : "New field"}
          </h2>
          <p className="truncate text-[11px] text-text-subtle">
            {state.kind === "array" && schema.length > 0
              ? "Fields and types inferred from the current collection"
              : state.kind === "array"
                ? "No schema detected for this collection"
                : "Choose the name, type, and value for the new field"}
          </p>
        </div>
        <button
          onClick={onClose}
          title="Close"
          className="ml-auto rounded p-1 text-text-subtle hover:bg-surface-hover hover:text-text"
        >
          <X size={15} strokeWidth={1.5} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {state.kind === "array" && schema.length > 0 ? (
          <div className="flex flex-col gap-5">
            {schema.map((field) => (
              <div key={field.name} className="grid grid-cols-[170px_1fr] gap-4">
                <div className="min-w-0">
                  <div className="truncate font-mono text-[12px] font-semibold text-text">
                    {field.name}
                  </div>
                  <div className="mt-1 font-mono text-[10px] uppercase text-text-subtle">
                    {field.type}
                  </div>
                </div>
                <div className="min-w-0">
                  <JsonValueDraftInput
                    type={field.type}
                    value={rowValues[field.name] ?? rawDefaultForType(field.type)}
                    onChange={(next) => setRowValues((current) => ({ ...current, [field.name]: next }))}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : state.kind === "array" ? (
          <div className="grid gap-3">
            <label className="grid gap-1.5">
              <span className="text-[11px] font-medium text-text-muted">Type</span>
              <select
                value={arrayType}
                onChange={(event) => updateArrayType(event.target.value as JsonNewValueType)}
                className="h-8 w-44 rounded-md border border-border bg-surface px-2 text-[12px]"
              >
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
                <option value="object">object</option>
                <option value="array">array</option>
                <option value="null">null</option>
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
                onChange={(event) => setFieldName(event.target.value)}
                placeholder="newField"
                className="h-8 rounded-md border border-border bg-surface px-2 font-mono text-[12px] outline-none focus:border-accent"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-[11px] font-medium text-text-muted">Type</span>
              <select
                value={fieldType}
                onChange={(event) => updateFieldType(event.target.value as JsonNewValueType)}
                className="h-8 w-44 rounded-md border border-border bg-surface px-2 text-[12px]"
              >
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
                <option value="object">object</option>
                <option value="array">array</option>
                <option value="null">null</option>
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-[11px] font-medium text-text-muted">Value</span>
              <JsonValueDraftInput type={fieldType} value={fieldValue} onChange={setFieldValue} />
            </label>
          </div>
        )}
      </div>

      <footer className="flex h-12 shrink-0 items-center gap-3 border-t border-border px-4">
        {error && <span className="min-w-0 flex-1 truncate text-[12px] text-deleted">{error}</span>}
        {!error && <span className="min-w-0 flex-1 text-[11px] text-text-subtle">Saved automatically after creation.</span>}
        <button
          onClick={onClose}
          className="h-8 min-w-20 rounded-md border border-border px-3 text-[12px] text-text-muted hover:bg-surface-hover"
        >
          Cancel
        </button>
        <button
          onClick={create}
          className="h-8 min-w-20 rounded-md bg-accent px-3 text-[12px] font-medium text-white hover:bg-accent-hover"
        >
          Create
        </button>
      </footer>
    </aside>
  );
}

function JsonFilterButton({
  activeCount,
  disabled,
  onClick,
}: {
  activeCount: number;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
        activeCount > 0
          ? "border-accent bg-accent-wash text-accent"
          : "border-border text-text-muted hover:bg-surface-hover hover:text-text"
      }`}
    >
      <ListFilter size={12} strokeWidth={1.6} />
      Filters
      {activeCount > 0 && (
        <span className="flex h-4 min-w-4 items-center justify-center rounded bg-accent px-1 font-mono text-[9px] text-white">
          {activeCount}
        </span>
      )}
    </button>
  );
}

function JsonFilterChipBar({
  conditions,
  fields,
  mode,
  onRemove,
  onClear,
}: {
  conditions: JsonFilterCondition[];
  fields: JsonFilterField[];
  mode: JsonFilterMode;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  const active = conditions.filter(isJsonFilterConditionComplete);
  if (active.length === 0) return null;
  return (
    <div className="flex min-h-9 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border bg-surface-sunken px-3 py-1.5">
      <span className="mr-0.5 shrink-0 font-mono text-[9px] uppercase text-text-subtle">
        {mode === "all" ? "all" : "any"}
      </span>
      {active.map((condition) => (
        <span
          key={condition.id}
          title={describeJsonFilter(condition, fields)}
          className="inline-flex h-6 max-w-72 shrink-0 items-center gap-1 rounded-md border border-border bg-surface-raised pl-2 pr-1 font-mono text-[10px] text-text-muted"
        >
          <span className="truncate">{describeJsonFilter(condition, fields)}</span>
          <button
            onClick={() => onRemove(condition.id)}
            title="Remove filter"
            className="rounded p-0.5 text-text-subtle hover:bg-surface-hover hover:text-text"
          >
            <X size={11} strokeWidth={1.5} />
          </button>
        </span>
      ))}
      <button
        onClick={onClear}
        className="ml-1 h-6 shrink-0 rounded px-1.5 text-[10px] text-text-subtle hover:bg-surface-hover hover:text-text"
      >
        Clear all
      </button>
    </div>
  );
}

function JsonVisualExplorer({
  value,
  sourceName,
  onChange,
  readOnly = false,
}: {
  value: unknown;
  sourceName?: string;
  onChange: (value: unknown, action?: JsonChangeAction) => void;
  readOnly?: boolean;
}) {
  const [path, setPath] = useState<JsonPath>([]);
  const [query, setQuery] = useState("");
  const [filterConditions, setFilterConditions] = useState<JsonFilterCondition[]>([]);
  const [filterMode, setFilterMode] = useState<JsonFilterMode>("all");
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [addModal, setAddModal] = useState<JsonAddModalState | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(() => new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<"array" | "object" | null>(null);
  const current = getAtPath(value, path);
  const deferredQuery = useDeferredValue(query);
  const deferredFilterConditions = useDeferredValue(filterConditions);
  const rawObjectEntries = useMemo<Array<[string, unknown]>>(
    () => (isPlainObject(current) ? Object.entries(current) : []),
    [current],
  );
  const filterFields = useMemo(
    () =>
      Array.isArray(current)
        ? inferJsonFilterFields(current)
        : objectEntryFilterFields(rawObjectEntries),
    [current, rawObjectEntries],
  );
  const activeFilterCount = filterConditions.filter(isJsonFilterConditionComplete).length;
  const deferredActiveFilterCount = deferredFilterConditions.filter(
    isJsonFilterConditionComplete,
  ).length;

  function updatePath(targetPath: JsonPath, nextValue: unknown, action: JsonChangeAction = "edited"): void {
    onChange(setAtPath(value, targetPath, nextValue), action);
  }

  function navigate(nextPath: JsonPath): void {
    setPath(nextPath);
    setQuery("");
    setFilterConditions([]);
    setFilterMode("all");
    setFilterDrawerOpen(false);
    setSelectedItems(new Set());
  }

  function updateFilters(conditions: JsonFilterCondition[]): void {
    setFilterConditions(conditions);
    setSelectedItems(new Set());
  }

  function removeFilter(id: string): void {
    updateFilters(filterConditions.filter((condition) => condition.id !== id));
  }

  // Todas as linhas que casam (sem paginar): a virtualização do grid mantém o
  // DOM em O(viewport), então um scroll único alcança 100% dos itens. A busca
  // ainda varre só os primeiros 5000 (client-side, com aviso) — a busca
  // integral do dataset é a global, no device.
  const arrayView = useMemo(() => {
    if (!Array.isArray(current)) {
      return { rows: [] as JsonTableRow[], limited: false };
    }
    const q = deferredQuery.trim().toLowerCase();
    if (!q && deferredActiveFilterCount === 0) {
      return {
        rows: current.map((item, index) => ({ index, value: item })),
        limited: false,
      };
    }
    const scanLimit = Math.min(current.length, 5000);
    const matchedRows: JsonTableRow[] = [];
    for (let index = 0; index < scanLimit; index += 1) {
      const item = current[index];
      const matchesSearch = !q || searchPreview(item).includes(q);
      const matchesFilters = matchesJsonFilters(
        item,
        { index },
        filterFields,
        deferredFilterConditions,
        filterMode,
      );
      if (matchesSearch && matchesFilters) matchedRows.push({ index, value: item });
    }
    return { rows: matchedRows, limited: scanLimit < current.length };
  }, [
    current,
    deferredActiveFilterCount,
    deferredFilterConditions,
    deferredQuery,
    filterFields,
    filterMode,
  ]);

  const objectEntries = useMemo<Array<[string, unknown]>>(() => {
    const q = deferredQuery.trim().toLowerCase();
    return rawObjectEntries.filter(([key, child]) => {
      const matchesSearch =
        !q || key.toLowerCase().includes(q) || searchPreview(child).includes(q);
      return (
        matchesSearch &&
        matchesJsonFilters(
          child,
          { key },
          filterFields,
          deferredFilterConditions,
          filterMode,
        )
      );
    });
  }, [
    deferredFilterConditions,
    deferredQuery,
    filterFields,
    filterMode,
    rawObjectEntries,
  ]);

  const arrayRows = arrayView.rows;
  const visibleArrayKeys = arrayRows.map((row) => String(row.index));
  const allVisibleArraySelected =
    visibleArrayKeys.length > 0 && visibleArrayKeys.every((key) => selectedItems.has(key));
  const objectKeys = isPlainObject(current) ? Object.keys(current) : [];
  const visibleObjectKeys = objectEntries.map(([key]) => key);
  const allObjectFieldsSelected =
    visibleObjectKeys.length > 0 && visibleObjectKeys.every((key) => selectedItems.has(key));

  function toggleSelected(key: string): void {
    setSelectedItems((currentSelection) => {
      const next = new Set(currentSelection);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleVisibleArrayRows(): void {
    setSelectedItems((currentSelection) => {
      const next = new Set(currentSelection);
      const checked = visibleArrayKeys.length > 0 && visibleArrayKeys.every((key) => next.has(key));
      for (const key of visibleArrayKeys) {
        if (checked) next.delete(key);
        else next.add(key);
      }
      return next;
    });
  }

  function toggleObjectFields(): void {
    setSelectedItems((currentSelection) => {
      const next = new Set(currentSelection);
      const checked = visibleObjectKeys.length > 0 && visibleObjectKeys.every((key) => next.has(key));
      for (const key of visibleObjectKeys) {
        if (checked) next.delete(key);
        else next.add(key);
      }
      return next;
    });
  }

  function clearSelection(): void {
    setSelectedItems(new Set());
    setDeleteConfirm(null);
  }

  function deleteSelectedArrayRows(): void {
    if (!Array.isArray(current) || selectedItems.size === 0) return;
    const selectedIndexes = [...selectedItems]
      .map((key) => Number(key))
      .filter(Number.isInteger)
      .sort((a, b) => a - b);
    if (selectedIndexes.length === 0) return;
    const selected = new Set(selectedIndexes);
    updatePath(
      path,
      current.filter((_, index) => !selected.has(index)),
      "deleted",
    );
    clearSelection();
  }

  function deleteSelectedObjectFields(): void {
    if (!isPlainObject(current) || selectedItems.size === 0) return;
    const next = { ...current };
    for (const key of selectedItems) delete next[key];
    updatePath(path, next, "deleted");
    clearSelection();
  }

  // Duplicar mora na mesma hierarquia do deletar — via seleção. Um por vez:
  // duplicar N itens de uma vez raramente é o que se quer e embaralha a ordem.
  function duplicateSelectedArrayRow(): void {
    if (!Array.isArray(current) || selectedItems.size !== 1) return;
    const [key] = [...selectedItems];
    const index = Number(key);
    if (!Number.isInteger(index)) return;
    onChange(duplicateAtPath(value, [...path, index]), "duplicated");
    clearSelection();
  }

  function duplicateSelectedObjectField(): void {
    if (!isPlainObject(current) || selectedItems.size !== 1) return;
    const [key] = [...selectedItems];
    if (key === undefined) return;
    onChange(duplicateAtPath(value, [...path, key]), "duplicated");
    clearSelection();
  }

  const arrayRowsHaveObjectShape = Array.isArray(current) && current.some(isPlainObject);

  const arrayGridColumns = useMemo<Array<JsonGridColumn<JsonTableRow>>>(() => {
    if (!Array.isArray(current)) return [];
    const objectRows = current
      .slice(0, 300)
      .map((item, index) => ({ index, value: item }))
      .filter((row) => isPlainObject(row.value));
    const keys = [...new Set(objectRows.flatMap((row) => Object.keys(row.value as Record<string, unknown>)))].slice(0, 12);
    if (keys.length === 0) {
      return [
        {
          id: "__select",
          width: "40px",
          header: (
            <div className="flex h-full items-center justify-center px-2">
              <input
                type="checkbox"
                checked={allVisibleArraySelected}
                onChange={toggleVisibleArrayRows}
                aria-label="Select visible rows"
                className="h-3.5 w-3.5 rounded border-border accent-accent"
              />
            </div>
          ),
          cell: (row) => (
            <div className="flex h-8 items-center justify-center px-2">
              <input
                type="checkbox"
                checked={selectedItems.has(String(row.index))}
                onChange={() => toggleSelected(String(row.index))}
                aria-label="Select row"
                className="h-3.5 w-3.5 rounded border-border accent-accent"
              />
            </div>
          ),
        },
        {
          id: "__index",
          width: "96px",
          header: <JsonColumnHeader label="#" type="number" />,
          cell: (row) => (
            <div className="flex h-8 items-center px-3 text-[11px] text-text-subtle">
              #{row.index + 1}
            </div>
          ),
        },
        {
          id: "value",
          width: "minmax(260px,1fr)",
          header: <JsonColumnHeader label="value" type={compactValueKind(current.slice(0, 300))} />,
          cell: (row) => {
            if (isCollection(row.value)) {
              return (
                <CollectionCell
                  label={collectionLabel(row.value)}
                  onOpen={
                    isNavigableCollection(row.value)
                      ? () => navigate([...path, row.index])
                      : undefined
                  }
                />
              );
            }
            return (
              <JsonPrimitiveEditor
                value={row.value}
                onChange={(next) => updatePath([...path, row.index], next)}
                variant="cell"
              readOnly={readOnly}
              />
            );
          },
        },
      ];
    }

    const cols: Array<JsonGridColumn<JsonTableRow>> = [
      {
        id: "__select",
        width: "40px",
        header: (
          <div className="flex h-full items-center justify-center px-2">
            <input
              type="checkbox"
              checked={allVisibleArraySelected}
              onChange={toggleVisibleArrayRows}
              aria-label="Select visible rows"
              className="h-3.5 w-3.5 rounded border-border accent-accent"
            />
          </div>
        ),
        cell: (row) => (
          <div className="flex h-8 items-center justify-center px-2">
            <input
              type="checkbox"
              checked={selectedItems.has(String(row.index))}
              onChange={() => toggleSelected(String(row.index))}
              aria-label="Select row"
              className="h-3.5 w-3.5 rounded border-border accent-accent"
            />
          </div>
        ),
      },
      {
        id: "__index",
        width: "88px",
        header: <JsonColumnHeader label="#" type="row" />,
        cell: (row) => {
          if (!isNavigableCollection(row.value)) {
            return (
              <div className="flex h-8 items-center px-3 text-[11px] text-text-subtle">
                <span className="tabular-nums">#{row.index + 1}</span>
              </div>
            );
          }
          return (
            <button
              onClick={() => navigate([...path, row.index])}
              title="Open row"
              className="group flex h-8 w-full cursor-pointer items-center gap-1 px-3 text-left text-[11px] text-text-subtle hover:bg-surface-hover hover:text-accent"
            >
              <span className="tabular-nums">#{row.index + 1}</span>
              <ChevronRight
                size={12}
                strokeWidth={1.5}
                className="ml-auto text-text-subtle group-hover:text-accent"
              />
            </button>
          );
        },
      },
      ...keys.map<JsonGridColumn<JsonTableRow>>((key) => ({
        id: key,
        width: "minmax(180px,1fr)",
        header: (
          <JsonColumnHeader
            label={key}
            type={compactValueKind(objectRows.map((row) => (row.value as Record<string, unknown>)[key]))}
          />
        ),
        cell: (row) => {
          const cellValue = isPlainObject(row.value) ? row.value[key] : undefined;
          const cellPath = [...path, row.index, key];
          if (isCollection(cellValue)) {
            return (
              <CollectionCell
                label={collectionLabel(cellValue)}
                onOpen={isNavigableCollection(cellValue) ? () => navigate(cellPath) : undefined}
              />
            );
          }
          return (
            <JsonPrimitiveEditor
              value={cellValue}
              onChange={(next) => updatePath(cellPath, next)}
              variant="cell"
            readOnly={readOnly}
            />
          );
        },
      })),
    ];
    return cols;
  }, [allVisibleArraySelected, current, path, readOnly, selectedItems, value]);

  const objectGridRows = useMemo<JsonObjectFieldRow[]>(
    () => objectEntries.map(([key, fieldValue]) => ({ key, value: fieldValue })),
    [objectEntries],
  );

  const objectGridColumns = useMemo<Array<JsonGridColumn<JsonObjectFieldRow>>>(() => {
    const valueTypeLabel = compactValueKind(objectEntries.map(([, fieldValue]) => fieldValue));
    return [
      {
        id: "__select",
        width: "40px",
        header: (
          <div className="flex h-full items-center justify-center px-2">
            <input
              type="checkbox"
              checked={allObjectFieldsSelected}
              onChange={toggleObjectFields}
              aria-label="Select fields"
              className="h-3.5 w-3.5 rounded border-border accent-accent"
            />
          </div>
        ),
        cell: (row) => (
          <div className="flex h-8 items-center justify-center px-2">
            <input
              type="checkbox"
              checked={selectedItems.has(row.key)}
              onChange={() => toggleSelected(row.key)}
              aria-label="Select field"
              className="h-3.5 w-3.5 rounded border-border accent-accent"
            />
          </div>
        ),
      },
      {
        id: "field",
        width: "minmax(190px,0.65fr)",
        header: <JsonColumnHeader label="field" type="string" />,
        cell: (row) => (
          <div className="flex h-8 min-w-0 items-center px-3 font-semibold">
            <span className="truncate">{row.key}</span>
          </div>
        ),
      },
      {
        id: "value",
        width: "minmax(260px,1fr)",
        header: <JsonColumnHeader label="value" type={valueTypeLabel} />,
        cell: (row) => {
          const childPath = [...path, row.key];
          if (isCollection(row.value)) {
            return (
              <CollectionCell
                label={collectionLabel(row.value)}
                onOpen={
                  isNavigableCollection(row.value) ? () => navigate(childPath) : undefined
                }
              />
            );
          }
          return (
            <JsonPrimitiveEditor
              value={row.value}
              onChange={(next) => updatePath(childPath, next)}
              variant="cell"
            readOnly={readOnly}
            />
          );
        },
      },
    ];
  }, [allObjectFieldsSelected, objectEntries, path, readOnly, selectedItems, value]);

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
                    <JsonPrimitiveEditor
            value={current}
            onChange={(next) => updatePath(path, next)}
            readOnly={readOnly}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-72 flex-col overflow-hidden rounded-md border border-border bg-surface-raised">
      <JsonVisualHeader sourceName={sourceName} path={path} onNavigate={navigate} />

      {Array.isArray(current) ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-9 shrink-0 items-center gap-2 overflow-x-auto border-b border-border px-3">
            <div className="relative w-56 shrink-0">
              <Search
                size={13}
                strokeWidth={1.5}
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-subtle"
              />
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelectedItems(new Set());
                }}
                placeholder="Search records..."
                className="h-6 w-full rounded-md border border-border bg-surface px-2 pl-7 text-[12px] outline-none focus:border-accent"
              />
            </div>
            <JsonFilterButton
              activeCount={activeFilterCount}
              disabled={filterFields.length === 0}
              onClick={() => {
                setAddModal(null);
                setFilterDrawerOpen(true);
              }}
            />
            {(query.trim() || activeFilterCount > 0) && (
              <span className="shrink-0 font-mono text-[10px] text-text-subtle">
                {arrayRows.length} {arrayRows.length === 1 ? "result" : "results"}
              </span>
            )}
            {!readOnly && selectedItems.size > 0 && (
              <>
                <span className="ml-2 inline-flex h-6 items-center rounded-md border border-border bg-surface-sunken px-2.5 text-[11px] text-text-muted">
                  {selectedItems.size} selected
                </span>
                {selectedItems.size === 1 && (
                  <button
                    onClick={duplicateSelectedArrayRow}
                    className="inline-flex h-6 items-center gap-1 rounded-md border border-border px-2.5 text-[11px] font-medium text-text-muted hover:bg-surface-hover hover:text-text"
                  >
                    <Copy size={12} strokeWidth={1.5} />
                    Duplicate
                  </button>
                )}
                <button
                  onClick={() => setDeleteConfirm("array")}
                  className="inline-flex h-6 items-center gap-1 rounded-md border border-deleted/30 bg-deleted-wash px-2.5 text-[11px] font-medium text-deleted"
                >
                  <Trash2 size={12} strokeWidth={1.5} />
                  Delete
                </button>
                <button
                  onClick={clearSelection}
                  className="inline-flex h-6 items-center rounded-md border border-transparent px-2.5 text-[11px] text-text-subtle hover:border-border hover:bg-surface-hover hover:text-text"
                >
                  Clear selection
                </button>
              </>
            )}
            {!readOnly && (
              <button
              onClick={() => {
                setFilterDrawerOpen(false);
                setAddModal({ kind: "array", path, array: current });
              }}
              className="ml-auto inline-flex h-6 items-center gap-1 rounded-md border border-border px-2.5 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text"
            >
              <Plus size={12} strokeWidth={1.5} />
              Add
              </button>
            )}
          </div>
          <JsonFilterChipBar
            conditions={filterConditions}
            fields={filterFields}
            mode={filterMode}
            onRemove={removeFilter}
            onClear={() => updateFilters([])}
          />
          <JsonDataGrid
            columns={arrayGridColumns}
            rows={arrayRows}
            readOnly={readOnly}
            getRowKey={(row) => String(row.index)}
            emptyLabel={
              query.trim() || activeFilterCount > 0
                ? "No records match this search and filter set."
                : arrayRowsHaveObjectShape
                  ? "No records found."
                  : "No items found."
            }
          />
          <div className="flex h-9 shrink-0 items-center gap-2 border-t border-border px-3 text-[12px] text-text-muted">
            <span>
              {arrayRows.length} {arrayRows.length === 1 ? "item" : "items"}
              {query.trim() || activeFilterCount > 0 ? " found" : ""}
            </span>
            {arrayView.limited && (
              <span className="ml-auto text-text-subtle">
                {query.trim() && activeFilterCount > 0
                  ? "searching and filtering the first 5,000 items"
                  : activeFilterCount > 0
                    ? "filtering the first 5,000 items"
                    : "searching the first 5,000 items"}
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-9 shrink-0 items-center gap-2 overflow-x-auto border-b border-border px-3">
            <div className="relative w-56 shrink-0">
              <Search
                size={13}
                strokeWidth={1.5}
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-subtle"
              />
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelectedItems(new Set());
                }}
                placeholder="Search fields..."
                className="h-6 w-full rounded-md border border-border bg-surface px-2 pl-7 text-[12px] outline-none focus:border-accent"
              />
            </div>
            <JsonFilterButton
              activeCount={activeFilterCount}
              disabled={filterFields.length === 0}
              onClick={() => {
                setAddModal(null);
                setFilterDrawerOpen(true);
              }}
            />
            <span className="font-mono text-[12px] font-semibold text-text">
              {query.trim() || activeFilterCount > 0
                ? `${objectEntries.length} of ${objectKeys.length}`
                : objectKeys.length} fields
            </span>
            {!readOnly && selectedItems.size > 0 && (
              <>
                <span className="ml-2 inline-flex h-6 items-center rounded-md border border-border bg-surface-sunken px-2.5 text-[11px] text-text-muted">
                  {selectedItems.size} selected
                </span>
                {selectedItems.size === 1 && (
                  <button
                    onClick={duplicateSelectedObjectField}
                    className="inline-flex h-6 items-center gap-1 rounded-md border border-border px-2.5 text-[11px] font-medium text-text-muted hover:bg-surface-hover hover:text-text"
                  >
                    <Copy size={12} strokeWidth={1.5} />
                    Duplicate
                  </button>
                )}
                <button
                  onClick={() => setDeleteConfirm("object")}
                  className="inline-flex h-6 items-center gap-1 rounded-md border border-deleted/30 bg-deleted-wash px-2.5 text-[11px] font-medium text-deleted"
                >
                  <Trash2 size={12} strokeWidth={1.5} />
                  Delete
                </button>
                <button
                  onClick={clearSelection}
                  className="inline-flex h-6 items-center rounded-md border border-transparent px-2.5 text-[11px] text-text-subtle hover:border-border hover:bg-surface-hover hover:text-text"
                >
                  Clear selection
                </button>
              </>
            )}
            {!readOnly && (
              <button
              onClick={() => {
                setFilterDrawerOpen(false);
                setAddModal({ kind: "field", path, keys: objectKeys });
              }}
              className="ml-auto inline-flex h-6 items-center gap-1 rounded-md border border-border px-2.5 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text"
            >
              <Plus size={12} strokeWidth={1.5} />
              Add field
              </button>
            )}
          </div>
          <JsonFilterChipBar
            conditions={filterConditions}
            fields={filterFields}
            mode={filterMode}
            onRemove={removeFilter}
            onClear={() => updateFilters([])}
          />
          <JsonDataGrid
            columns={objectGridColumns}
            rows={objectGridRows}
            readOnly={readOnly}
            getRowKey={(row) => row.key}
            emptyLabel={
              query.trim() || activeFilterCount > 0
                ? "No fields match this search and filter set."
                : "No fields found."
            }
          />
        </div>
      )}
      {addModal && (
        <JsonAddDrawer
          state={addModal}
          onClose={() => setAddModal(null)}
          onCreateArrayItem={createArrayItem}
          onCreateField={createField}
        />
      )}
      {filterDrawerOpen && (
        <JsonFilterDrawer
          fields={filterFields}
          conditions={filterConditions}
          mode={filterMode}
          matchCount={Array.isArray(current) ? arrayRows.length : objectEntries.length}
          totalCount={Array.isArray(current) ? current.length : objectKeys.length}
          onConditionsChange={updateFilters}
          onModeChange={(mode) => {
            setFilterMode(mode);
            setSelectedItems(new Set());
          }}
          onClose={() => setFilterDrawerOpen(false)}
        />
      )}
      {deleteConfirm === "array" && selectedItems.size > 0 && (
        <ConfirmDialog
          title="Delete selected items?"
          description="This permanently removes the selected items from this JSON value."
          onCancel={() => setDeleteConfirm(null)}
          onConfirm={deleteSelectedArrayRows}
          detail={
            <div className="rounded-md border border-border bg-surface-sunken px-2.5 py-2 text-[12px] text-text">
              <span className="font-mono font-semibold">
                {path[path.length - 1] ?? sourceName ?? "root"}
              </span>
              <span className="text-text-muted">
                {" "}
                · {selectedItems.size} item{selectedItems.size > 1 ? "s" : ""}
              </span>
            </div>
          }
        />
      )}
      {deleteConfirm === "object" && selectedItems.size > 0 && (
        <ConfirmDialog
          title="Delete selected fields?"
          description="This permanently removes the selected fields from this JSON value."
          onCancel={() => setDeleteConfirm(null)}
          onConfirm={deleteSelectedObjectFields}
          detail={
            <div className="rounded-md border border-border bg-surface-sunken px-2.5 py-2 text-[12px] text-text">
              <span className="font-mono font-semibold">
                {path[path.length - 1] ?? sourceName ?? "root"}
              </span>
              <span className="text-text-muted">
                {" "}
                · {selectedItems.size} field{selectedItems.size > 1 ? "s" : ""}
              </span>
            </div>
          }
        />
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
  const currentLabel = path.length === 0 ? "Root" : pathLabel(path[path.length - 1] ?? "Root");
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-surface-sunken px-3 text-[12px]">
      {path.length > 0 ? (
        <button
          onClick={() => onNavigate(path.slice(0, -1))}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface-raised px-2.5 font-medium text-text-muted hover:bg-surface-hover hover:text-text"
        >
          <ChevronLeft size={14} strokeWidth={1.5} />
          Back
        </button>
      ) : (
        <span className="inline-flex h-8 items-center rounded-md border border-transparent px-2.5 text-text-subtle">
          Root
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
  readOnly = false,
}: {
  draft: string;
  onDraftChange: (value: string, action?: JsonChangeAction) => void;
  sourceName?: string;
  minHeight?: string;
  readOnly?: boolean;
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
    nodeCount >= JSON_NODE_COUNT_LIMIT ? `${JSON_NODE_COUNT_LIMIT}+ nodes` : `${nodeCount} nodes`;
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
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-surface-sunken px-2">
        <div className="flex rounded-md border border-border bg-surface-raised p-0.5">
          <button
            onClick={() => setMode("visual")}
            disabled={parsed.error !== null}
            className={`flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] ${
              mode === "visual" ? "bg-accent text-white" : "text-text-muted hover:bg-surface-hover"
            } disabled:opacity-40`}
          >
            <Table2 size={12} strokeWidth={1.5} />
            Visual
          </button>
          <button
            onClick={() => setMode("tree")}
            className={`flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] ${
              mode === "tree" ? "bg-accent text-white" : "text-text-muted hover:bg-surface-hover"
            }`}
          >
            <ListTree size={12} strokeWidth={1.5} />
            Tree
          </button>
          <button
            onClick={() => setMode("raw")}
            className={`flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] ${
              mode === "raw" ? "bg-accent text-white" : "text-text-muted hover:bg-surface-hover"
            }`}
          >
            <Code2 size={12} strokeWidth={1.5} />
            Raw
          </button>
          <button
            onClick={() => setMode("ts")}
            disabled={parsed.error !== null}
            className={`flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] ${
              mode === "ts" ? "bg-accent text-white" : "text-text-muted hover:bg-surface-hover"
            } disabled:opacity-40`}
          >
            <FileCode2 size={12} strokeWidth={1.5} />
            TS
          </button>
        </div>

        <span className="ml-1 hidden items-center gap-1.5 text-[11px] text-text-subtle sm:flex">
          <Braces size={12} strokeWidth={1.5} />
          {parsed.error === null ? `${rootLabel(parsed.value)} · ${nodeCountLabel}` : "invalid"}
        </span>

        {/* Expandir/recolher só faz sentido na árvore (o Visual navega por
            drill-in, não por colapso). Fora do modo Tree eram botões mortos. */}
        <div className="ml-auto flex items-center gap-0.5">
          {mode === "tree" && treeValue && (
            <>
              <button
                onClick={() => setCollapse(false)}
                title="Expand all"
                className="rounded p-1 text-text-subtle hover:bg-surface-hover hover:text-text"
              >
                <Maximize2 size={13} strokeWidth={1.5} />
              </button>
              <button
                onClick={() => setCollapse(2)}
                title="Collapse to depth 2"
                className="rounded px-1.5 py-1 font-mono text-[11px] text-text-subtle hover:bg-surface-hover hover:text-text"
              >
                2
              </button>
              <button
                onClick={() => setCollapse(true)}
                title="Collapse all"
                className="rounded p-1 text-text-subtle hover:bg-surface-hover hover:text-text"
              >
                <Minimize2 size={13} strokeWidth={1.5} />
              </button>
            </>
          )}
          <button
            onClick={() => void copyJson()}
            title="Copy JSON"
            className="rounded p-1 text-text-subtle hover:bg-surface-hover hover:text-text"
          >
            {copied ? <Check size={13} strokeWidth={1.5} /> : <Copy size={13} strokeWidth={1.5} />}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {mode === "visual" && parsed.error === null ? (
          <JsonVisualExplorer
            value={parsed.value}
            sourceName={sourceName}
            readOnly={readOnly}
            onChange={(next, action) => onDraftChange(stringifyJson(next), action)}
          />
        ) : mode === "ts" && parsed.error === null ? (
          <div className="flex h-full min-h-72 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={tsRootName}
                readOnly
                className="w-48 rounded border border-border bg-surface-sunken px-2 py-1 font-mono text-[11px] text-text-muted"
                title="Name inferred from the JSON key"
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
                Copy
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
                  Loading JSON tree...
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
            readOnly={readOnly}
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
              readOnly={readOnly}
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
  const size = useLayout((s) => s.panels.history.size);
  const collapsed = useLayout((s) => s.panels.history.collapsed);
  const toggleCollapsed = useLayout((s) => s.toggleCollapsed);

  if (collapsed) {
    return (
      <div className="flex w-9 shrink-0 flex-col items-center border-l border-border py-2">
        <button
          onClick={() => toggleCollapsed("history")}
          title="Expand history"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-subtle hover:bg-surface-hover hover:text-text"
        >
          <PanelRightOpen size={16} strokeWidth={1.5} />
        </button>
      </div>
    );
  }

  return (
    <aside
      style={{ width: size }}
      className="relative flex shrink-0 flex-col border-l border-border"
    >
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-3">
        <History size={13} strokeWidth={1.5} className="text-text-subtle" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          History
        </span>
        {history && history.length > 1 && (
          <span className="text-[11px] text-text-subtle">{history.length}</span>
        )}
        <button
          onClick={() => toggleCollapsed("history")}
          title="Collapse panel"
          className="ml-auto shrink-0 rounded p-1 text-text-subtle hover:bg-surface-hover hover:text-text"
        >
          <PanelRightClose size={14} strokeWidth={1.5} />
        </button>
      </div>
      <ResizeHandle panelId="history" edge="left" />
      <ol className="flex-1 overflow-y-auto p-2">
        {(!history || history.length === 0) && (
          <li className="px-1 py-2 text-[11px] text-text-subtle">
            Changes to this key appear here while Studio is open.
          </li>
        )}
        {history?.map((entry, i) => (
          <li key={i} className="mb-2 rounded-md border border-border p-2">
            <div className="mb-1 flex items-center gap-2 text-[10px] text-text-subtle">
              <time className="tabular-nums">
                {new Date(entry.timestamp).toLocaleTimeString("en-US")}
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
      setError("enter a key name");
      return;
    }
    let value: StorageValue;
    if (type === "string") value = { type: "string", value: draft };
    else if (type === "number") {
      const n = Number(draft);
      if (!Number.isFinite(n)) {
        setError("invalid number");
        return;
      }
      value = { type: "number", value: n };
    } else if (type === "boolean") value = { type: "boolean", value: boolDraft };
    else {
      try {
        JSON.parse(draft);
      } catch {
        setError("Invalid JSON");
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
        <span className="text-[12px] font-semibold">New key</span>
        <button
          onClick={() => setCreating(false)}
          title="Cancel"
          className="ml-auto rounded p-1 text-text-subtle hover:bg-surface-hover hover:text-text"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-text-muted">Key</span>
          <input
            autoFocus
            type="text"
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            placeholder="e.g. feature.newHome"
            className="w-full max-w-md rounded-md border border-border bg-surface-raised px-3 py-1.5 font-mono text-[12px] placeholder:text-text-subtle"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-text-muted">Type</span>
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
          <span className="text-[11px] font-medium text-text-muted">Value</span>
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
          {saving ? "Creating…" : "Create"}
        </button>
        <button
          onClick={() => setCreating(false)}
          className="rounded-md px-2.5 py-1.5 text-[12px] text-text-muted hover:bg-surface-hover"
        >
          Cancel
        </button>
        {error && <span className="text-[12px] text-deleted">{error}</span>}
      </div>
    </div>
  );
}

type ValueType = StorageValue["type"];
const CONVERTIBLE_VALUE_TYPES = ["string", "number", "boolean", "json", "null"] as const;

/** Editor por tipo (plano §5.2). Conversões são ações explícitas e confirmadas. */
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
  const [originalSignature, setOriginalSignature] = useState<string | null>(null);
  const [originalValue, setOriginalValue] = useState<StorageValue | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "saving">("loading");
  const [error, setError] = useState<string | null>(null);
  /** Valor cortado no device (preview): tamanho real + progresso do load-full. */
  const [truncatedInfo, setTruncatedInfo] = useState<{ totalSize: number } | null>(null);
  const [fullLoad, setFullLoad] = useState<{ received: number; total: number } | null>(null);
  const [toast, setToast] = useState<EditorToastState | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [convertTarget, setConvertTarget] = useState<ValueType | null>(null);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const pendingActionRef = useRef<JsonChangeAction>("edited");
  /**
   * Write agendado e ainda não executado. Existe porque o cleanup do debounce
   * cancela o timer, e trocar de chave (ou desmontar) dentro da janela fazia a
   * edição desaparecer em silêncio — o usuário confirmava um delete, via a
   * linha sumir, e o valor voltava intacto depois.
   */
  const pendingSaveRef = useRef<{
    providerId: string;
    instanceId: string;
    key: string;
    value: StorageValue;
  } | null>(null);
  const saveSeqRef = useRef(0);
  const toastIdRef = useRef(1);
  const fullLoadAbortRef = useRef<AbortController | null>(null);

  function applyValue(value: StorageValue): void {
    setDraftType(value.type);
    setOriginalSignature(storageValueSignature(value));
    setOriginalValue(value);
    if (value.type === "boolean") setBoolDraft(value.value);
    else if (value.type === "json") {
      try {
        setDraft(JSON.stringify(JSON.parse(value.value), null, 2));
      } catch {
        // JSON truncado não parseia — mostra cru; o banner explica.
        setDraft(value.value);
      }
    } else setDraft(value.type === "null" ? "" : String(value.value));
  }

  useEffect(() => {
    if (!selection || !selectedKey) return;
    let cancelled = false;
    fullLoadAbortRef.current?.abort();
    fullLoadAbortRef.current = null;
    setState("loading");
    setError(null);
    setOriginalSignature(null);
    setOriginalValue(null);
    setToast(null);
    setActionsOpen(false);
    setConvertTarget(null);
    setRemoveConfirmOpen(false);
    setTruncatedInfo(null);
    setFullLoad(null);
    void getValue(selection.providerId, selection.instanceId, selectedKey)
      .then((preview) => {
        if (cancelled) return;
        if (preview.value) {
          applyValue(preview.value);
          setTruncatedInfo(preview.truncated ? { totalSize: preview.totalSize } : null);
        }
        setState("ready");
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setState("ready");
      });
    return () => {
      cancelled = true;
      fullLoadAbortRef.current?.abort();
      fullLoadAbortRef.current = null;
    };
  }, [selection, selectedKey]);

  async function loadFullValue(): Promise<void> {
    if (!selection || !selectedKey || fullLoad) return;
    const controller = new AbortController();
    fullLoadAbortRef.current?.abort();
    fullLoadAbortRef.current = controller;
    setFullLoad({ received: 0, total: truncatedInfo?.totalSize ?? 0 });
    setError(null);
    try {
      const value = await getFullValue(selection.providerId, selection.instanceId, selectedKey, {
        signal: controller.signal,
        onProgress: (received, total) => {
          if (fullLoadAbortRef.current === controller) setFullLoad({ received, total });
        },
      });
      if (value && fullLoadAbortRef.current === controller) {
        applyValue(value);
        setTruncatedInfo(null);
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (fullLoadAbortRef.current === controller) {
        fullLoadAbortRef.current = null;
        setFullLoad(null);
      }
    }
  }

  function buildValue(): StorageValue | { error: string } {
    switch (draftType) {
      case "string":
        return { type: "string", value: draft };
      case "number": {
        const n = Number(draft);
        return Number.isFinite(n) ? { type: "number", value: n } : { error: "invalid number" };
      }
      case "boolean":
        return { type: "boolean", value: boolDraft };
      case "json":
        try {
          JSON.parse(draft);
          return { type: "json", value: draft };
        } catch {
          return { error: "Invalid JSON" };
        }
      case "null":
        return { type: "null", value: null };
      case "buffer":
        return { error: "Buffer values are read-only." };
    }
  }

  const currentValue = useMemo(() => buildValue(), [boolDraft, draft, draftType]);
  const currentSignature = "error" in currentValue ? null : storageValueSignature(currentValue);
  const isDirty =
    originalSignature !== null &&
    (currentSignature === null || currentSignature !== originalSignature);

  useEffect(() => {
    if (!selection || !selectedKey) return;
    if (creating || state !== "ready" || truncatedInfo !== null) return;
    if (!isDirty || currentSignature === null || "error" in currentValue || originalValue === null) return;

    const providerId = selection.providerId;
    const instanceId = selection.instanceId;
    const key = selectedKey;
    const valueToSave = currentValue;
    const previousValue = originalValue;
    const action = pendingActionRef.current;
    const seq = saveSeqRef.current + 1;
    saveSeqRef.current = seq;
    pendingSaveRef.current = { providerId, instanceId, key, value: valueToSave };

    const timer = window.setTimeout(() => {
      pendingSaveRef.current = null;
      setState("saving");
      setError(null);
      void setValue(providerId, instanceId, key, valueToSave)
        .then(() => {
          if (saveSeqRef.current !== seq) return;
          setOriginalSignature(storageValueSignature(valueToSave));
          setOriginalValue(valueToSave);
          setState("ready");
          setToast({
            id: toastIdRef.current++,
            message: jsonActionMessage(action, key),
            undo: async () => {
              await setValue(providerId, instanceId, key, previousValue);
              applyValue(previousValue);
            },
          });
          pendingActionRef.current = "edited";
        })
        .catch((cause) => {
          if (saveSeqRef.current !== seq) return;
          setError(cause instanceof Error ? cause.message : String(cause));
          setState("ready");
        });
      // Só DIGITAR merece debounce. Deletar, duplicar e adicionar são ações
      // discretas e já confirmadas — segurá-las por 450ms só cria uma janela em
      // que a ação pode ser perdida.
    }, action === "edited" ? (draftType === "json" ? 450 : 650) : 0);

    return () => window.clearTimeout(timer);
  }, [
    creating,
    currentSignature,
    currentValue,
    draftType,
    isDirty,
    originalValue,
    selectedKey,
    selection,
    state,
    truncatedInfo,
  ]);

  /**
   * Rede de segurança: sair da chave (ou desmontar o editor) não pode descartar
   * uma edição que o usuário já fez. O cleanup do debounce acima cancela o
   * timer, então sem isto o write simplesmente nunca aconteceria — em silêncio.
   *
   * Deliberadamente fire-and-forget: já não estamos mais nesta chave, então
   * tocar estado do componente no retorno corromperia o que está na tela agora.
   */
  useEffect(() => {
    return () => {
      const pending = pendingSaveRef.current;
      if (!pending) return;
      pendingSaveRef.current = null;
      void setValue(pending.providerId, pending.instanceId, pending.key, pending.value).catch(
        () => {
          /* o Studio já saiu desta chave; não há onde mostrar o erro */
        },
      );
    };
  }, [selectedKey, selection]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(
      () => setToast((current) => (current?.id === toast.id ? null : current)),
      6000,
    );
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (selection && creating) {
    return <CreateKeyForm providerId={selection.providerId} instanceId={selection.instanceId} />;
  }

  if (!selection || !selectedKey) {
    return (
      <div className="flex flex-1 items-center justify-center text-text-subtle">
        Select a key.
      </div>
    );
  }

  async function remove(): Promise<void> {
    if (!selection || !selectedKey) return;
    setState("saving");
    try {
      await removeKey(selection.providerId, selection.instanceId, selectedKey);
      setRemoveConfirmOpen(false);
      useStudio.getState().selectKey(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setState("ready");
      setRemoveConfirmOpen(false);
    }
  }

  function convertType(target: ValueType): void {
    let source: unknown;
    try {
      if (draftType === "boolean") source = boolDraft;
      else if (draftType === "null") source = null;
      else if (draftType === "number") source = Number(draft);
      else if (draftType === "json") source = JSON.parse(draft);
      else source = draft;

      if (target === "string") {
        setDraft(
          typeof source === "string"
            ? source
            : source === null
              ? ""
              : typeof source === "object"
                ? JSON.stringify(source)
                : String(source),
        );
      } else if (target === "number") {
        const next = Number(source);
        if (!Number.isFinite(next)) throw new Error("This value cannot be converted to a number.");
        setDraft(String(next));
      } else if (target === "boolean") {
        if (typeof source === "boolean") setBoolDraft(source);
        else if (typeof source === "number") setBoolDraft(source !== 0);
        else if (typeof source === "string" && ["true", "1"].includes(source.toLowerCase())) {
          setBoolDraft(true);
        } else if (
          typeof source === "string" &&
          ["false", "0", ""].includes(source.toLowerCase())
        ) {
          setBoolDraft(false);
        } else {
          throw new Error("This value cannot be converted to a boolean.");
        }
      } else if (target === "json") {
        if (typeof source === "string") {
          try {
            JSON.parse(source);
            setDraft(source);
          } catch {
            setDraft(JSON.stringify(source));
          }
        } else {
          setDraft(JSON.stringify(source));
        }
      }

      pendingActionRef.current = "edited";
      setDraftType(target);
      setConvertTarget(null);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <div className="relative flex min-w-0 flex-1">
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {/* faixa de metadata — fina, não uma coluna (plano §5.2) */}
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border px-4">
        <span className="min-w-0 truncate font-mono text-[12px] font-semibold">
          {selectedKey}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-3 text-[11px] text-text-subtle">
          {entry && <span>{formatSize(entry.approxSize)}</span>}
          <span className="rounded border border-border px-1.5 py-0.5 font-mono uppercase text-text-muted">
            {draftType}
          </span>
        </span>
        <div className="relative">
          <button
            onClick={() => setActionsOpen((open) => !open)}
            title="More actions"
            aria-expanded={actionsOpen}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-subtle hover:bg-surface-hover hover:text-text"
          >
            <MoreHorizontal size={14} strokeWidth={1.5} />
          </button>
          {actionsOpen && (
            <>
              <button
                aria-label="Close actions"
                onClick={() => setActionsOpen(false)}
                className="fixed inset-0 z-40 cursor-default"
              />
              <div className="absolute right-0 top-8 z-50 w-44 overflow-hidden rounded-md border border-border-strong bg-surface-raised py-1 text-[12px] shadow-xl shadow-black/15">
                <button
                  onClick={() => {
                    setActionsOpen(false);
                    setConvertTarget(
                      CONVERTIBLE_VALUE_TYPES.find((type) => type !== draftType) ?? "string",
                    );
                  }}
                  disabled={state !== "ready" || truncatedInfo !== null}
                  className="flex h-8 w-full items-center px-2.5 text-left text-text-muted hover:bg-surface-hover hover:text-text disabled:opacity-40"
                >
                  Convert type…
                </button>
              </div>
            </>
          )}
        </div>
        <button
          onClick={() => setRemoveConfirmOpen(true)}
          disabled={state !== "ready"}
          title="Remove key"
          className="inline-flex h-7 items-center gap-1 rounded-md border border-transparent px-2 text-[11px] text-deleted hover:border-deleted/30 hover:bg-deleted-wash disabled:opacity-50"
        >
          <Trash2 size={12} strokeWidth={1.5} />
          Remove
        </button>
      </div>

      {truncatedInfo && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-accent-wash px-4 py-1.5 text-[12px]">
          <span className="text-text-muted">
            Large value — showing a 64 KB preview of{" "}
            {formatSize(truncatedInfo.totalSize)}. Editing is blocked until the full value is loaded.
          </span>
          <button
            onClick={() => void loadFullValue()}
            disabled={fullLoad !== null}
            className="ml-auto shrink-0 rounded-md border border-accent px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent hover:text-white disabled:opacity-60"
          >
            {fullLoad
              ? `Loading… ${
                  fullLoad.total > 0
                    ? `${Math.round((fullLoad.received / fullLoad.total) * 100)}%`
                    : formatSize(fullLoad.received)
                }`
              : `Load all (${formatSize(truncatedInfo.totalSize)})`}
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
        {state === "loading" ? (
          <p className="text-text-subtle">Loading…</p>
        ) : draftType === "boolean" ? (
          <button
            type="button"
            onClick={() => {
              pendingActionRef.current = "edited";
              setBoolDraft((v) => !v);
            }}
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
            onChange={(e) => {
              pendingActionRef.current = "edited";
              setDraft(e.target.value);
            }}
            className="w-64 rounded-md border border-border bg-surface-raised px-3 py-1.5 font-mono text-[12px]"
          />
        ) : draftType === "string" ? (
          // String simples: textarea que cresce e QUEBRA — mostra o valor
          // inteiro (JWT, token) em vez de cortar na horizontal como um input.
          <AutoTextarea
            value={draft}
            ariaLabel={`Value of ${selectedKey}`}
            onChange={(next) => {
              pendingActionRef.current = "edited";
              setDraft(next);
            }}
          />
        ) : (
          <JsonWorkspace
            draft={draft}
            onDraftChange={(next, action = "edited") => {
              pendingActionRef.current = action;
              setDraft(next);
            }}
            sourceName={selectedKey}
          />
        )}
      </div>

      {error && (
        <div className="shrink-0 border-t border-border px-4 py-2 text-[12px] text-deleted">
          {error}
        </div>
      )}
    </div>
    {convertTarget && (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="convert-type-title"
        className="fixed inset-0 z-[70] flex items-start justify-center bg-black/25 px-4 pt-24"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setConvertTarget(null);
        }}
      >
        <div className="w-full max-w-sm rounded-md border border-border-strong bg-surface-raised shadow-2xl shadow-black/20">
          <div className="flex h-11 items-center border-b border-border px-4">
            <div>
              <h2 id="convert-type-title" className="text-[13px] font-semibold">
                Convert value type
              </h2>
              <p className="text-[11px] text-text-subtle">Current type: {draftType}</p>
            </div>
            <button
              onClick={() => setConvertTarget(null)}
              title="Close"
              className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-text-subtle hover:bg-surface-hover hover:text-text"
            >
              <X size={14} strokeWidth={1.5} />
            </button>
          </div>
          <div className="space-y-3 p-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-text-muted">New type</span>
              <select
                autoFocus
                value={convertTarget}
                onChange={(event) => setConvertTarget(event.target.value as ValueType)}
                className="h-8 rounded-md border border-border bg-surface px-2 text-[12px] outline-none focus:border-accent"
              >
                {CONVERTIBLE_VALUE_TYPES.map((type) => (
                  <option key={type} value={type} disabled={type === draftType}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-[11px] leading-5 text-text-subtle">
              Converting may change the value your app reads. The change is saved automatically and can be undone from the confirmation toast.
            </p>
          </div>
          <div className="flex h-12 items-center justify-end gap-2 border-t border-border px-4">
            <button
              onClick={() => setConvertTarget(null)}
              className="h-8 rounded-md px-3 text-[12px] text-text-muted hover:bg-surface-hover"
            >
              Cancel
            </button>
            <button
              onClick={() => convertType(convertTarget)}
              disabled={convertTarget === draftType}
              className="h-8 rounded-md bg-accent px-3 text-[12px] font-medium text-white hover:bg-accent-hover disabled:opacity-40"
            >
              Convert
            </button>
          </div>
        </div>
      </div>
    )}
    {removeConfirmOpen && (
      <ConfirmDialog
        title="Delete key?"
        description="This permanently removes this value from the connected app."
        loading={state === "saving"}
        onCancel={() => setRemoveConfirmOpen(false)}
        onConfirm={() => void remove()}
        detail={
          <code className="block truncate rounded-md border border-border bg-surface-sunken px-2.5 py-2 font-mono text-[12px] text-text">
            {selectedKey}
          </code>
        }
      />
    )}
    {toast && <AppToast toast={toast} onClose={() => setToast(null)} />}
    <KeyHistory
      historyKey={`${keysId(selection.providerId, selection.instanceId)} ${selectedKey}`}
    />
    </div>
  );
}
