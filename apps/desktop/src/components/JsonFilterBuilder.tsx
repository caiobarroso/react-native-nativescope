import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ListFilter,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";

export type JsonFilterMode = "all" | "any";
export type JsonFilterKind =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "null"
  | "array"
  | "object"
  | "mixed";

export type JsonFilterAccessor =
  | { kind: "path"; path: string[] }
  | { kind: "value" }
  | { kind: "index" }
  | { kind: "key" }
  | { kind: "type" };

export interface JsonFilterField {
  id: string;
  label: string;
  kind: JsonFilterKind;
  accessor: JsonFilterAccessor;
  samples: string[];
}

export type JsonFilterOperator =
  | "equals"
  | "notEquals"
  | "contains"
  | "notContains"
  | "startsWith"
  | "endsWith"
  | "greaterThan"
  | "greaterOrEqual"
  | "lessThan"
  | "lessOrEqual"
  | "between"
  | "isTrue"
  | "isFalse"
  | "isNull"
  | "isNotNull"
  | "isEmpty"
  | "isNotEmpty"
  | "exists"
  | "notExists"
  | "arrayContains"
  | "hasKey"
  | "lengthEquals"
  | "lengthGreaterThan"
  | "lengthLessThan";

export interface JsonFilterCondition {
  id: string;
  fieldId: string;
  operator: JsonFilterOperator;
  value: string;
  valueTo: string;
}

export interface JsonFilterRecordMeta {
  index?: number;
  key?: string;
}

type OperatorOption = {
  value: JsonFilterOperator;
  label: string;
};

const VALUELESS_OPERATORS = new Set<JsonFilterOperator>([
  "isTrue",
  "isFalse",
  "isNull",
  "isNotNull",
  "isEmpty",
  "isNotEmpty",
  "exists",
  "notExists",
]);

const COMMON_PRESENCE_OPERATORS: OperatorOption[] = [
  { value: "exists", label: "exists" },
  { value: "notExists", label: "does not exist" },
  { value: "isNull", label: "is null" },
  { value: "isNotNull", label: "is not null" },
];

const STRING_OPERATORS: OperatorOption[] = [
  { value: "contains", label: "contains" },
  { value: "notContains", label: "does not contain" },
  { value: "equals", label: "equals" },
  { value: "notEquals", label: "does not equal" },
  { value: "startsWith", label: "starts with" },
  { value: "endsWith", label: "ends with" },
  { value: "isEmpty", label: "is empty" },
  { value: "isNotEmpty", label: "is not empty" },
  ...COMMON_PRESENCE_OPERATORS,
];

const ORDERED_OPERATORS: OperatorOption[] = [
  { value: "equals", label: "equals" },
  { value: "notEquals", label: "does not equal" },
  { value: "greaterThan", label: "is greater than" },
  { value: "greaterOrEqual", label: "is at least" },
  { value: "lessThan", label: "is less than" },
  { value: "lessOrEqual", label: "is at most" },
  { value: "between", label: "is between" },
  ...COMMON_PRESENCE_OPERATORS,
];

const BOOLEAN_OPERATORS: OperatorOption[] = [
  { value: "isTrue", label: "is true" },
  { value: "isFalse", label: "is false" },
  ...COMMON_PRESENCE_OPERATORS,
];

const ARRAY_OPERATORS: OperatorOption[] = [
  { value: "arrayContains", label: "contains value" },
  { value: "lengthEquals", label: "length equals" },
  { value: "lengthGreaterThan", label: "length is greater than" },
  { value: "lengthLessThan", label: "length is less than" },
  { value: "isEmpty", label: "is empty" },
  { value: "isNotEmpty", label: "is not empty" },
  ...COMMON_PRESENCE_OPERATORS,
];

const OBJECT_OPERATORS: OperatorOption[] = [
  { value: "hasKey", label: "has key" },
  { value: "isEmpty", label: "is empty" },
  { value: "isNotEmpty", label: "is not empty" },
  ...COMMON_PRESENCE_OPERATORS,
];

const MIXED_OPERATORS: OperatorOption[] = [
  { value: "equals", label: "equals" },
  { value: "notEquals", label: "does not equal" },
  { value: "contains", label: "contains" },
  { value: "greaterThan", label: "is greater than" },
  { value: "greaterOrEqual", label: "is at least" },
  { value: "lessThan", label: "is less than" },
  { value: "lessOrEqual", label: "is at most" },
  { value: "between", label: "is between" },
  ...COMMON_PRESENCE_OPERATORS,
];

let conditionSequence = 0;

export function createJsonFilterCondition(field?: JsonFilterField): JsonFilterCondition {
  conditionSequence += 1;
  return {
    id: `json-filter-${conditionSequence}`,
    fieldId: field?.id ?? "",
    operator: defaultOperatorForKind(field?.kind ?? "string"),
    value: "",
    valueTo: "",
  };
}

export function defaultOperatorForKind(kind: JsonFilterKind): JsonFilterOperator {
  if (kind === "boolean") return "isTrue";
  if (kind === "array") return "arrayContains";
  if (kind === "object") return "hasKey";
  if (kind === "string") return "contains";
  return "equals";
}

export function operatorsForKind(kind: JsonFilterKind): OperatorOption[] {
  if (kind === "string") return STRING_OPERATORS;
  if (kind === "number" || kind === "date") return ORDERED_OPERATORS;
  if (kind === "boolean") return BOOLEAN_OPERATORS;
  if (kind === "array") return ARRAY_OPERATORS;
  if (kind === "object") return OBJECT_OPERATORS;
  if (kind === "null") return COMMON_PRESENCE_OPERATORS;
  return MIXED_OPERATORS;
}

export function isJsonFilterConditionComplete(condition: JsonFilterCondition): boolean {
  if (!condition.fieldId) return false;
  if (VALUELESS_OPERATORS.has(condition.operator)) return true;
  if (!condition.value.trim()) return false;
  if (condition.operator === "between") return condition.valueTo.trim().length > 0;
  return true;
}

export function resolveJsonFilterValue(
  field: JsonFilterField,
  record: unknown,
  meta: JsonFilterRecordMeta = {},
): unknown {
  if (field.accessor.kind === "value") return record;
  if (field.accessor.kind === "index") {
    return meta.index === undefined ? undefined : meta.index + 1;
  }
  if (field.accessor.kind === "key") return meta.key;
  if (field.accessor.kind === "type") return jsonValueKind(record);

  let current = record;
  for (const segment of field.accessor.path) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

export function matchesJsonFilters(
  record: unknown,
  meta: JsonFilterRecordMeta,
  fields: JsonFilterField[],
  conditions: JsonFilterCondition[],
  mode: JsonFilterMode,
): boolean {
  const active = conditions.filter(isJsonFilterConditionComplete);
  if (active.length === 0) return true;
  const evaluate = (condition: JsonFilterCondition): boolean => {
    const field = fields.find((candidate) => candidate.id === condition.fieldId);
    if (!field) return true;
    return evaluateCondition(
      resolveJsonFilterValue(field, record, meta),
      field.kind,
      condition,
    );
  };
  return mode === "all" ? active.every(evaluate) : active.some(evaluate);
}

export function describeJsonFilter(
  condition: JsonFilterCondition,
  fields: JsonFilterField[],
): string {
  const field = fields.find((candidate) => candidate.id === condition.fieldId);
  if (!field) return "Incomplete filter";
  const operator = operatorsForKind(field.kind).find(
    (candidate) => candidate.value === condition.operator,
  );
  if (VALUELESS_OPERATORS.has(condition.operator)) {
    return `${field.label} ${operator?.label ?? condition.operator}`;
  }
  if (condition.operator === "between") {
    return `${field.label} ${operator?.label ?? "is between"} ${condition.value} and ${condition.valueTo}`;
  }
  return `${field.label} ${operator?.label ?? condition.operator} ${condition.value}`;
}

export function inferJsonFilterFields(values: unknown[]): JsonFilterField[] {
  const sample = values.slice(0, 500);
  const hasObjectRows = sample.some(isRecord);
  if (!hasObjectRows) {
    return [
      inferSpecialField("value", "Value", { kind: "value" }, sample),
      inferSpecialField(
        "index",
        "Row number",
        { kind: "index" },
        sample.map((_, index) => index + 1),
      ),
      {
        id: "meta:type",
        label: "Type",
        kind: "string",
        accessor: { kind: "type" },
        samples: uniqueSamples(sample.map(jsonValueKind)),
      },
    ];
  }

  const accumulators = new Map<
    string,
    { path: string[]; values: unknown[]; kinds: Map<JsonFilterKind, number> }
  >();

  function visit(value: unknown, path: string[], depth: number): void {
    if (depth > 4 || !isRecord(value) || accumulators.size >= 80) return;
    for (const [key, child] of Object.entries(value)) {
      const nextPath = [...path, key];
      const id = pathFieldId(nextPath);
      const kind = inferJsonFilterKind(child);
      const accumulator = accumulators.get(id) ?? {
        path: nextPath,
        values: [],
        kinds: new Map<JsonFilterKind, number>(),
      };
      accumulator.kinds.set(kind, (accumulator.kinds.get(kind) ?? 0) + 1);
      if (accumulator.values.length < 12) accumulator.values.push(child);
      accumulators.set(id, accumulator);
      if (isRecord(child)) visit(child, nextPath, depth + 1);
    }
  }

  for (const value of sample) visit(value, [], 0);

  const fields = [...accumulators.entries()].map<JsonFilterField>(([id, accumulator]) => ({
    id,
    label: accumulator.path.join("."),
    kind: dominantKind(accumulator.kinds),
    accessor: { kind: "path", path: accumulator.path },
    samples: uniqueSamples(accumulator.values),
  }));

  fields.sort((left, right) => {
    const depth = (left.accessor.kind === "path" ? left.accessor.path.length : 0) -
      (right.accessor.kind === "path" ? right.accessor.path.length : 0);
    return depth || left.label.localeCompare(right.label);
  });
  return fields;
}

export function objectEntryFilterFields(entries: Array<[string, unknown]>): JsonFilterField[] {
  const values = entries.slice(0, 500).map(([, value]) => value);
  return [
    inferSpecialField(
      "field",
      "Field name",
      { kind: "key" },
      entries.slice(0, 500).map(([key]) => key),
    ),
    inferSpecialField("value", "Value", { kind: "value" }, values),
    {
      id: "meta:type",
      label: "Type",
      kind: "string",
      accessor: { kind: "type" },
      samples: uniqueSamples(values.map(jsonValueKind)),
    },
  ];
}

function inferSpecialField(
  id: string,
  label: string,
  accessor: JsonFilterAccessor,
  values: unknown[],
): JsonFilterField {
  const kinds = new Map<JsonFilterKind, number>();
  for (const value of values) {
    const kind = inferJsonFilterKind(value);
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }
  return {
    id: `meta:${id}`,
    label,
    kind: dominantKind(kinds),
    accessor,
    samples: uniqueSamples(values),
  };
}

function pathFieldId(path: string[]): string {
  return `path:${JSON.stringify(path)}`;
}

function dominantKind(kinds: Map<JsonFilterKind, number>): JsonFilterKind {
  const populated = [...kinds.entries()].filter(([kind]) => kind !== "null");
  if (populated.length === 0) return "null";
  if (populated.length > 1) {
    const ordered = populated.sort((left, right) => right[1] - left[1]);
    const total = ordered.reduce((sum, [, count]) => sum + count, 0);
    if ((ordered[0]?.[1] ?? 0) / total < 0.8) return "mixed";
    return ordered[0]?.[0] ?? "mixed";
  }
  return populated[0]?.[0] ?? "mixed";
}

function inferJsonFilterKind(value: unknown): JsonFilterKind {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  if (isRecord(value)) return "object";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string" && looksLikeDate(value)) return "date";
  return "string";
}

function looksLikeDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.+-Z]+)?$/.test(value) && !Number.isNaN(Date.parse(value));
}

function uniqueSamples(values: unknown[]): string[] {
  const samples: string[] = [];
  for (const value of values) {
    if (value === undefined || value === null || typeof value === "object") continue;
    const sample = String(value);
    if (!samples.includes(sample)) samples.push(sample);
    if (samples.length >= 8) break;
  }
  return samples;
}

function jsonValueKind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function evaluateCondition(
  actual: unknown,
  kind: JsonFilterKind,
  condition: JsonFilterCondition,
): boolean {
  const operator = condition.operator;
  if (operator === "exists") return actual !== undefined;
  if (operator === "notExists") return actual === undefined;
  if (operator === "isNull") return actual === null;
  if (operator === "isNotNull") return actual !== null && actual !== undefined;
  if (operator === "isTrue") return actual === true;
  if (operator === "isFalse") return actual === false;
  if (operator === "isEmpty") return collectionLength(actual) === 0;
  if (operator === "isNotEmpty") {
    const length = collectionLength(actual);
    return length !== null && length > 0;
  }
  if (operator === "hasKey") return isRecord(actual) && Object.hasOwn(actual, condition.value);
  if (operator === "arrayContains") {
    return Array.isArray(actual) && actual.some((item) => valuesEqual(item, condition.value, "mixed"));
  }
  if (operator.startsWith("length")) {
    const length = collectionLength(actual);
    const expected = Number(condition.value);
    if (length === null || !Number.isFinite(expected)) return false;
    if (operator === "lengthEquals") return length === expected;
    if (operator === "lengthGreaterThan") return length > expected;
    return length < expected;
  }
  if (operator === "contains" || operator === "notContains") {
    const found = String(actual ?? "").toLowerCase().includes(condition.value.toLowerCase());
    return operator === "contains" ? found : !found;
  }
  if (operator === "startsWith") {
    return String(actual ?? "").toLowerCase().startsWith(condition.value.toLowerCase());
  }
  if (operator === "endsWith") {
    return String(actual ?? "").toLowerCase().endsWith(condition.value.toLowerCase());
  }
  if (operator === "equals" || operator === "notEquals") {
    const equal = valuesEqual(actual, condition.value, kind);
    return operator === "equals" ? equal : !equal;
  }

  const actualOrder = orderedValue(actual, kind);
  const expectedOrder = orderedValue(condition.value, kind);
  if (actualOrder === null || expectedOrder === null) return false;
  if (operator === "greaterThan") return actualOrder > expectedOrder;
  if (operator === "greaterOrEqual") return actualOrder >= expectedOrder;
  if (operator === "lessThan") return actualOrder < expectedOrder;
  if (operator === "lessOrEqual") return actualOrder <= expectedOrder;
  if (operator === "between") {
    const upper = orderedValue(condition.valueTo, kind);
    return upper !== null && actualOrder >= Math.min(expectedOrder, upper) && actualOrder <= Math.max(expectedOrder, upper);
  }
  return true;
}

function valuesEqual(actual: unknown, expected: string, kind: JsonFilterKind): boolean {
  if (kind === "number") return typeof actual === "number" && actual === Number(expected);
  if (kind === "boolean") return actual === (expected === "true");
  if (kind === "date") {
    return typeof actual === "string" && Date.parse(actual) === Date.parse(expected);
  }
  if (kind === "mixed") {
    try {
      return Object.is(actual, JSON.parse(expected));
    } catch {
      return String(actual ?? "") === expected;
    }
  }
  return String(actual ?? "") === expected;
}

function orderedValue(value: unknown, kind: JsonFilterKind): number | null {
  if (kind === "date") {
    const parsed = Date.parse(String(value));
    return Number.isNaN(parsed) ? null : parsed;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function collectionLength(value: unknown): number | null {
  if (typeof value === "string" || Array.isArray(value)) return value.length;
  if (isRecord(value)) return Object.keys(value).length;
  return null;
}

export function JsonFilterDrawer({
  fields,
  conditions,
  mode,
  matchCount,
  totalCount,
  onConditionsChange,
  onModeChange,
  onClose,
}: {
  fields: JsonFilterField[];
  conditions: JsonFilterCondition[];
  mode: JsonFilterMode;
  matchCount: number;
  totalCount: number;
  onConditionsChange: (conditions: JsonFilterCondition[]) => void;
  onModeChange: (mode: JsonFilterMode) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (conditions.length === 0 && fields[0]) {
      onConditionsChange([createJsonFilterCondition(fields[0])]);
    }
  }, [conditions.length, fields, onConditionsChange]);

  function updateCondition(id: string, patch: Partial<JsonFilterCondition>): void {
    onConditionsChange(
      conditions.map((condition) => (condition.id === id ? { ...condition, ...patch } : condition)),
    );
  }

  function selectField(condition: JsonFilterCondition, fieldId: string): void {
    const field = fields.find((candidate) => candidate.id === fieldId);
    updateCondition(condition.id, {
      fieldId,
      operator: defaultOperatorForKind(field?.kind ?? "string"),
      value: "",
      valueTo: "",
    });
  }

  function removeCondition(id: string): void {
    onConditionsChange(conditions.filter((condition) => condition.id !== id));
  }

  const activeCount = conditions.filter(isJsonFilterConditionComplete).length;

  return (
    <aside className="rnsi-drawer-in absolute inset-y-0 right-0 z-30 flex w-[min(540px,100%)] flex-col border-l border-border bg-surface-raised shadow-xl shadow-black/10">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-wash text-accent">
          <ListFilter size={15} strokeWidth={1.7} />
        </span>
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold text-text">Filter this collection</h2>
          <p className="truncate text-[11px] text-text-subtle">
            Typed conditions update the table as you build them
          </p>
        </div>
        <button
          onClick={onClose}
          title="Close filters"
          className="ml-auto rounded p-1.5 text-text-subtle hover:bg-surface-hover hover:text-text"
        >
          <X size={15} strokeWidth={1.5} />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <span className="text-[11px] font-medium text-text-muted">Match</span>
          <div className="flex rounded-md border border-border bg-surface-sunken p-0.5">
            {(["all", "any"] as const).map((option) => (
              <button
                key={option}
                onClick={() => onModeChange(option)}
                className={`h-7 rounded px-3 text-[11px] font-medium ${
                  mode === option
                    ? "bg-surface-raised text-text shadow-sm"
                    : "text-text-subtle hover:text-text"
                }`}
              >
                {option === "all" ? "All conditions" : "Any condition"}
              </button>
            ))}
          </div>
          <span className="ml-auto font-mono text-[11px] text-text-subtle">
            {matchCount} / {totalCount}
          </span>
        </div>

        <div className="divide-y divide-border">
          {conditions.map((condition, index) => {
            const field = fields.find((candidate) => candidate.id === condition.fieldId);
            const operators = operatorsForKind(field?.kind ?? "mixed");
            return (
              <div key={condition.id} className="px-4 py-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-mono text-[10px] uppercase text-text-subtle">
                    Condition {index + 1}
                  </span>
                  {isJsonFilterConditionComplete(condition) && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-created">
                      <Check size={11} strokeWidth={1.7} /> active
                    </span>
                  )}
                  <button
                    onClick={() => removeCondition(condition.id)}
                    title="Remove condition"
                    className="ml-auto rounded p-1 text-text-subtle hover:bg-deleted-wash hover:text-deleted"
                  >
                    <Trash2 size={13} strokeWidth={1.5} />
                  </button>
                </div>

                <div className="grid grid-cols-[minmax(0,1fr)_180px] gap-2">
                  <JsonFilterFieldCombobox
                    fields={fields}
                    value={condition.fieldId}
                    onChange={(fieldId) => selectField(condition, fieldId)}
                  />
                  <label className="relative min-w-0">
                    <span className="sr-only">Operator</span>
                    <select
                      value={condition.operator}
                      onChange={(event) =>
                        updateCondition(condition.id, {
                          operator: event.target.value as JsonFilterOperator,
                          valueTo: "",
                        })
                      }
                      className="h-9 w-full appearance-none rounded-md border border-border bg-surface px-2.5 pr-7 text-[12px] text-text outline-none focus:border-accent"
                    >
                      {operators.map((operator) => (
                        <option key={operator.value} value={operator.value}>
                          {operator.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={13}
                      strokeWidth={1.5}
                      className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-text-subtle"
                    />
                  </label>
                </div>

                {!VALUELESS_OPERATORS.has(condition.operator) && (
                  <div className={`mt-2 grid gap-2 ${condition.operator === "between" ? "grid-cols-2" : "grid-cols-1"}`}>
                    <JsonFilterValueInput
                      condition={condition}
                      field={field}
                      value={condition.value}
                      onChange={(value) => updateCondition(condition.id, { value })}
                      label={condition.operator === "between" ? "From" : "Value"}
                    />
                    {condition.operator === "between" && (
                      <JsonFilterValueInput
                        condition={condition}
                        field={field}
                        value={condition.valueTo}
                        onChange={(valueTo) => updateCondition(condition.id, { valueTo })}
                        label="To"
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="px-4 py-3">
          <button
            onClick={() => onConditionsChange([...conditions, createJsonFilterCondition(fields[0])])}
            disabled={fields.length === 0}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[11px] font-medium text-text-muted hover:bg-surface-hover hover:text-text disabled:opacity-40"
          >
            <Plus size={13} strokeWidth={1.5} />
            Add condition
          </button>
        </div>
      </div>

      <footer className="flex h-12 shrink-0 items-center gap-3 border-t border-border px-4">
        <span className="min-w-0 flex-1 truncate text-[11px] text-text-subtle">
          {activeCount === 0
            ? "Complete a condition to filter the table."
            : `${matchCount} matching ${matchCount === 1 ? "record" : "records"}`}
        </span>
        {conditions.length > 0 && (
          <button
            onClick={() => onConditionsChange([])}
            className="h-8 rounded-md px-3 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text"
          >
            Clear all
          </button>
        )}
        <button
          onClick={onClose}
          className="h-8 min-w-20 rounded-md bg-accent px-3 text-[11px] font-medium text-white hover:bg-accent-hover"
        >
          Done
        </button>
      </footer>
    </aside>
  );
}

function JsonFilterFieldCombobox({
  fields,
  value,
  onChange,
}: {
  fields: JsonFilterField[];
  value: string;
  onChange: (value: string) => void;
}) {
  const selected = fields.find((field) => field.id === value);
  const [query, setQuery] = useState(selected?.label ?? "");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    setQuery(selected?.label ?? "");
  }, [selected?.label]);

  const suggestions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized || selected?.label.toLowerCase() === normalized) return fields.slice(0, 12);
    return fields
      .filter((field) => field.label.toLowerCase().includes(normalized))
      .slice(0, 12);
  }, [fields, query, selected?.label]);

  function choose(field: JsonFilterField): void {
    onChange(field.id);
    setQuery(field.label);
    setOpen(false);
    setCursor(0);
  }

  return (
    <div className="relative min-w-0">
      <Search
        size={13}
        strokeWidth={1.5}
        className="pointer-events-none absolute left-2.5 top-[18px] z-10 -translate-y-1/2 text-text-subtle"
      />
      <input
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setCursor(0);
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 100)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setCursor((current) => Math.min(current + 1, suggestions.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setCursor((current) => Math.max(current - 1, 0));
          } else if (event.key === "Enter" && suggestions[cursor]) {
            event.preventDefault();
            choose(suggestions[cursor]);
          } else if (event.key === "Escape") {
            setOpen(false);
            setQuery(selected?.label ?? "");
          }
        }}
        placeholder="Choose or type a field..."
        role="combobox"
        aria-expanded={open}
        className="h-9 w-full rounded-md border border-border bg-surface pl-8 pr-2 font-mono text-[12px] text-text outline-none placeholder:font-sans placeholder:text-text-subtle focus:border-accent"
      />
      {open && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-10 z-40 max-h-56 overflow-y-auto rounded-md border border-border bg-surface-raised p-1 shadow-lg shadow-black/10">
          {suggestions.map((field, index) => (
            <button
              key={field.id}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(field)}
              className={`flex h-8 w-full items-center gap-2 rounded px-2 text-left ${
                index === cursor ? "bg-accent-wash" : "hover:bg-surface-hover"
              }`}
            >
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text">
                {field.label}
              </span>
              <span className="shrink-0 font-mono text-[9px] uppercase text-text-subtle">
                {field.kind}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function JsonFilterValueInput({
  condition,
  field,
  value,
  onChange,
  label,
}: {
  condition: JsonFilterCondition;
  field?: JsonFilterField;
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const listId = `${condition.id}-${label.toLowerCase()}`;
  const numeric = field?.kind === "number" || condition.operator.startsWith("length");
  const date = field?.kind === "date";
  return (
    <label className="grid gap-1">
      <span className="text-[10px] font-medium text-text-subtle">{label}</span>
      <input
        type={numeric ? "number" : date ? "datetime-local" : "text"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        list={field?.samples.length ? listId : undefined}
        autoComplete="off"
        placeholder={valuePlaceholder(field?.kind, condition.operator)}
        className="h-9 w-full rounded-md border border-border bg-surface px-2.5 font-mono text-[12px] text-text outline-none placeholder:font-sans placeholder:text-text-subtle focus:border-accent"
      />
      {field && field.samples.length > 0 && (
        <datalist id={listId}>
          {field.samples.map((sample) => (
            <option key={sample} value={sample} />
          ))}
        </datalist>
      )}
    </label>
  );
}

function valuePlaceholder(
  kind: JsonFilterKind | undefined,
  operator: JsonFilterOperator,
): string {
  if (operator === "hasKey") return "Key name";
  if (operator.startsWith("length")) return "Length";
  if (operator === "arrayContains") return "Value in array";
  if (kind === "number") return "0";
  if (kind === "date") return "Date and time";
  return "Type a value...";
}
