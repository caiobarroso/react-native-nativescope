import { useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import {
  acceptCompletion,
  autocompletion,
  completionStatus,
  snippetCompletion,
  startCompletion,
} from "@codemirror/autocomplete";
import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from "@codemirror/autocomplete";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { sql as sqlLanguage, SQLite } from "@codemirror/lang-sql";
import { Prec } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { ChevronDown, ChevronUp, Play, Sparkles, Table2, Wand2 } from "lucide-react";
import type { ExecuteResult, TableSchema } from "@rnsi/protocol";
import { useStudio, keysId } from "../lib/store.ts";
import { useLayout } from "../lib/layout.ts";
import { blobLabel, isBlobCell } from "../lib/cell-format.ts";
import { executeSql } from "../lib/studio-client.ts";
import { ResizeHandle } from "./ResizeHandle.tsx";

const SQL_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "JOIN",
  "LEFT JOIN",
  "INNER JOIN",
  "ON",
  "INSERT INTO",
  "VALUES",
  "UPDATE",
  "SET",
  "DELETE FROM",
  "CREATE TABLE",
  "ALTER TABLE",
  "DROP TABLE",
  "ORDER BY",
  "GROUP BY",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "PRAGMA",
  "EXPLAIN QUERY PLAN",
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "COALESCE",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "NULL",
  "NOT NULL",
  "PRIMARY KEY",
  "FOREIGN KEY",
  "REFERENCES",
  "INTEGER",
  "TEXT",
  "REAL",
  "BLOB",
  "NUMERIC",
];

const EMPTY_TABLES: TableSchema[] = [];

const CLAUSE_WORDS = new Set([
  "WHERE",
  "JOIN",
  "LEFT",
  "RIGHT",
  "INNER",
  "OUTER",
  "FULL",
  "CROSS",
  "ON",
  "GROUP",
  "ORDER",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "UNION",
  "EXCEPT",
  "INTERSECT",
  "SET",
  "VALUES",
]);

const sqlHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--cm-keyword)", fontWeight: "600" },
  { tag: [tags.name, tags.variableName], color: "var(--cm-name)" },
  { tag: tags.propertyName, color: "var(--cm-property)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--cm-string)" },
  { tag: [tags.number, tags.integer, tags.float], color: "var(--cm-number)" },
  { tag: tags.bool, color: "var(--cm-number)" },
  { tag: tags.null, color: "var(--cm-null)", fontWeight: "600" },
  { tag: tags.comment, color: "var(--cm-comment)", fontStyle: "italic" },
  { tag: tags.operator, color: "var(--cm-operator)" },
  { tag: tags.punctuation, color: "var(--cm-punctuation)" },
]);

function quoteIdent(name: string): string {
  if (/^[A-Za-z_][\w$]*$/.test(name) && !SQL_KEYWORDS.includes(name.toUpperCase())) {
    return name;
  }
  return `"${name.replaceAll('"', '""')}"`;
}

function escapeSnippet(value: string): string {
  return value.replace(/[$}\\]/g, "\\$&");
}

function tableByName(tables: TableSchema[], name: string): TableSchema | undefined {
  const normalized = name.replace(/^"|"$/g, "").replaceAll('""', '"').toLowerCase();
  return tables.find((table) => table.name.toLowerCase() === normalized);
}

function columnOptions(table: TableSchema, boost = 0): Completion[] {
  return table.columns.map((column) => ({
    label: column.name,
    type: "property",
    detail: column.declaredType || "column",
    boost: boost + (column.pkIndex > 0 ? 4 : 0),
    info:
      column.pkIndex > 0
        ? `PK ${column.pkIndex} · ${column.declaredType || "no declared type"}`
        : column.notNull
          ? `NOT NULL · ${column.declaredType || "no declared type"}`
          : column.declaredType || "no declared type",
  }));
}

function tableOptions(tables: TableSchema[]): Completion[] {
  return tables.map((table) => ({
    label: table.name,
    apply: quoteIdent(table.name),
    type: "type",
    detail: table.kind === "view" ? `view · ${table.rowCount} rows` : `${table.rowCount} rows`,
    info: table.columns.map((column) => `${column.name} ${column.declaredType}`.trim()).join("\n"),
    boost: table.rowCount > 0 ? 2 : 0,
  }));
}

function keywordOptions(): Completion[] {
  return SQL_KEYWORDS.map((label) => ({
    label,
    type: /^(COUNT|SUM|AVG|MIN|MAX|COALESCE)$/i.test(label) ? "function" : "keyword",
    boost: label.length <= 6 ? 1 : 0,
  }));
}

function selectedTableSnippets(table: TableSchema | undefined): Completion[] {
  if (!table) return [];
  const tableName = quoteIdent(table.name);
  const columns = table.columns.map((column) => quoteIdent(column.name));
  const firstColumn = columns[0] ?? "*";
  const writableColumns = table.columns.filter((column) => column.pkIndex === 0);
  const insertColumns = writableColumns.length > 0 ? writableColumns : table.columns;
  const insertColumnNames = insertColumns.map((column) => quoteIdent(column.name));
  const insertValues = insertColumns.map((_, index) => `\${${index + 1}:value}`).join(", ");
  const updateColumn = quoteIdent(writableColumns[0]?.name ?? table.columns[0]?.name ?? "column");
  const identityColumn = quoteIdent(table.columns.find((column) => column.pkIndex > 0)?.name ?? "rowid");

  return [
    snippetCompletion(`SELECT *\nFROM ${escapeSnippet(tableName)}\nLIMIT \${1:100};`, {
      label: `select ${table.name}`,
      type: "text",
      detail: "snippet",
      info: "Query the open table with a limit.",
      boost: 25,
    }),
    snippetCompletion(`SELECT COUNT(*) AS total\nFROM ${escapeSnippet(tableName)};`, {
      label: `count ${table.name}`,
      type: "text",
      detail: "snippet",
      info: "Count rows in the open table.",
      boost: 24,
    }),
    snippetCompletion(
      `SELECT ${escapeSnippet(firstColumn)}\nFROM ${escapeSnippet(tableName)}\nWHERE \${1:condition}\nORDER BY ${escapeSnippet(firstColumn)} DESC\nLIMIT \${2:100};`,
      {
        label: `filter ${table.name}`,
        type: "text",
        detail: "snippet",
        info: "Query with WHERE, ordering, and a limit.",
        boost: 23,
      },
    ),
    snippetCompletion(
      `INSERT INTO ${escapeSnippet(tableName)} (${insertColumnNames.map(escapeSnippet).join(", ")})\nVALUES (${insertValues});`,
      {
        label: `insert ${table.name}`,
        type: "text",
        detail: "snippet",
        info: "Insert a row using the known columns.",
        boost: 22,
      },
    ),
    snippetCompletion(
      `UPDATE ${escapeSnippet(tableName)}\nSET ${escapeSnippet(updateColumn)} = \${1:value}\nWHERE ${escapeSnippet(identityColumn)} = \${2:id};`,
      {
        label: `update ${table.name}`,
        type: "text",
        detail: "snippet",
        info: "Update a row with WHERE.",
        boost: 21,
      },
    ),
    snippetCompletion(
      `DELETE FROM ${escapeSnippet(tableName)}\nWHERE ${escapeSnippet(identityColumn)} = \${1:id};`,
      {
        label: `delete ${table.name}`,
        type: "text",
        detail: "snippet",
        info: "Delete a row with WHERE.",
        boost: 20,
      },
    ),
  ];
}

function parseAliases(sql: string, tables: TableSchema[]): Map<string, TableSchema> {
  const aliases = new Map<string, TableSchema>();
  const scrubbed = sql.replace(/'([^']|'')*'/g, "''").replace(/"([^"]|"")*"/g, (match) => match);
  const sourcePattern =
    /\b(?:from|join)\s+("[^"]+"|[A-Za-z_][\w$]*)(?:\s+(?:as\s+)?("[^"]+"|[A-Za-z_][\w$]*))?/gi;
  let match: RegExpExecArray | null;
  while ((match = sourcePattern.exec(scrubbed))) {
    const tableName = match[1];
    if (!tableName) continue;
    const table = tableByName(tables, tableName);
    if (!table) continue;
    aliases.set(table.name.toLowerCase(), table);
    const alias = match[2]?.replace(/^"|"$/g, "");
    if (alias && !CLAUSE_WORDS.has(alias.toUpperCase())) aliases.set(alias.toLowerCase(), table);
  }

  const updatePattern =
    /\bupdate\s+("[^"]+"|[A-Za-z_][\w$]*)(?:\s+(?:as\s+)?("[^"]+"|[A-Za-z_][\w$]*))?/gi;
  while ((match = updatePattern.exec(scrubbed))) {
    const tableName = match[1];
    if (!tableName) continue;
    const table = tableByName(tables, tableName);
    if (!table) continue;
    aliases.set(table.name.toLowerCase(), table);
    const alias = match[2]?.replace(/^"|"$/g, "");
    if (alias && !CLAUSE_WORDS.has(alias.toUpperCase())) aliases.set(alias.toLowerCase(), table);
  }
  return aliases;
}

function completionRange(context: CompletionContext): { from: number; to: number } | null {
  const word = context.matchBefore(/[\w$"]*/);
  if (!word && !context.explicit) return null;
  return { from: word?.from ?? context.pos, to: context.pos };
}

function createSqlCompletionSource(
  tables: TableSchema[],
  selectedTable: string | null,
): CompletionSource {
  const selected = selectedTable ? tableByName(tables, selectedTable) : undefined;
  const baseOptions = [
    ...selectedTableSnippets(selected),
    ...tableOptions(tables),
    ...keywordOptions(),
    ...(selected ? columnOptions(selected, 8) : []),
  ];

  return (context): CompletionResult | null => {
    const before = context.state.sliceDoc(0, context.pos);
    const dot = before.match(/("[^"]+"|[A-Za-z_][\w$]*)\.\s*([A-Za-z_][\w$]*)?$/);
    if (dot) {
      const aliases = parseAliases(before, tables);
      const owner = (dot[1] ?? "").replace(/^"|"$/g, "").toLowerCase();
      const table = aliases.get(owner) ?? tableByName(tables, owner);
      if (!table) return null;
      return {
        from: context.pos - (dot[2]?.length ?? 0),
        options: columnOptions(table, 30),
        validFor: /^[\w$]*$/,
      };
    }

    const range = completionRange(context);
    if (!range) return null;

    const tableContext =
      /\b(from|join|into|update|table|describe|pragma\s+table_info)\s+("[^"]*"|[A-Za-z_][\w$]*)?$/i.test(
        before,
      );
    if (tableContext) {
      return {
        from: range.from,
        options: tableOptions(tables),
        validFor: /^[\w$"]*$/,
      };
    }

    const columnContext =
      /\b(select|where|and|or|on|by|set|having|returning)\s+("[^"]*"|[A-Za-z_][\w$]*)?$/i.test(
        before,
      ) || /,\s*("[^"]*"|[A-Za-z_][\w$]*)?$/.test(before);
    if (columnContext && selected) {
      const aliases = parseAliases(before, tables);
      const sourceTables = aliases.size > 0 ? [...new Set(aliases.values())] : [selected];
      return {
        from: range.from,
        options: sourceTables.flatMap((table, index) => columnOptions(table, 18 - index)),
        validFor: /^[\w$"]*$/,
      };
    }

    return {
      from: range.from,
      options: baseOptions,
      validFor: /^[\w$"]*$/,
    };
  };
}

function createEditorExtensions(
  tables: TableSchema[],
  selectedTable: string | null,
  run: () => void,
): Extension[] {
  const selected = selectedTable ? tableByName(tables, selectedTable) : undefined;
  const defaultQuery = previewSqlForTable(selected, "select");
  const schema = Object.fromEntries(
    tables.map((table) => [
      table.name,
      table.columns.map((column) => ({
        label: column.name,
        type: "property",
        detail: column.declaredType || "column",
      })),
    ]),
  );

  return [
    sqlLanguage({
      dialect: SQLite,
      schema,
      defaultTable: selectedTable ?? undefined,
      upperCaseKeywords: true,
    }),
    syntaxHighlighting(sqlHighlight),
    autocompletion({
      override: [createSqlCompletionSource(tables, selectedTable)],
      activateOnTyping: true,
      maxRenderedOptions: 14,
    }),
    Prec.highest(
      keymap.of([
        {
          key: "Tab",
          run: (view) => {
            const status = completionStatus(view.state);
            if (status === "active") return acceptCompletion(view);
            if (status === "pending") return false;
            if (view.state.doc.toString().trim() !== "" || defaultQuery === "") return false;
            view.dispatch({
              changes: { from: 0, to: view.state.doc.length, insert: defaultQuery },
              selection: { anchor: defaultQuery.length },
            });
            return true;
          },
        },
        {
          key: "Mod-Enter",
          run: () => {
            run();
            return true;
          },
        },
        { key: "Ctrl-Space", run: startCompletion },
      ]),
    ),
    EditorView.lineWrapping,
    EditorView.theme({
      "&": {
        "--cm-keyword": "#b55f42",
        "--cm-name": "#2f3437",
        "--cm-property": "#476f8f",
        "--cm-string": "#5f7f4b",
        "--cm-number": "#8a5a9e",
        "--cm-null": "#9a6a34",
        "--cm-comment": "#8d887f",
        "--cm-operator": "#7a756d",
        "--cm-punctuation": "#7a756d",
        backgroundColor: "var(--surface-raised)",
        color: "var(--text)",
        fontSize: "12px",
        border: "1px solid var(--border)",
        borderRadius: "6px",
      },
      ".dark &": {
        "--cm-keyword": "#ffad8f",
        "--cm-name": "#f3f1ea",
        "--cm-property": "#9bd4ff",
        "--cm-string": "#b8df9f",
        "--cm-number": "#d9b2ff",
        "--cm-null": "#f3c47e",
        "--cm-comment": "#aaa49a",
        "--cm-operator": "#d8d2c8",
        "--cm-punctuation": "#c4bdb2",
      },
      "&.cm-focused": {
        outline: "1px solid color-mix(in srgb, var(--accent) 72%, transparent)",
        outlineOffset: "0",
      },
      ".cm-content": {
        color: "var(--text)",
        caretColor: "var(--accent)",
      },
      ".cm-placeholder": {
        color: "var(--text-subtle)",
      },
      ".cm-scroller": {
        fontFamily: "var(--font-mono)",
        minHeight: "96px",
      },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: "color-mix(in srgb, var(--accent) 26%, transparent)",
      },
      ".cm-gutters": {
        backgroundColor: "var(--surface-sunken)",
        color: "var(--text-subtle)",
        borderRight: "1px solid var(--border)",
      },
      ".cm-activeLineGutter, .cm-activeLine": {
        backgroundColor: "color-mix(in srgb, var(--accent-wash) 70%, transparent)",
      },
      ".cm-tooltip": {
        backgroundColor: "var(--surface-raised)",
        border: "1px solid var(--border-strong)",
        color: "var(--text)",
      },
      ".cm-tooltip-autocomplete ul": {
        fontFamily: "var(--font-mono)",
      },
      ".cm-tooltip-autocomplete ul li": {
        color: "var(--text)",
      },
      ".cm-completionDetail, .cm-completionInfo": {
        color: "var(--text-muted)",
      },
      ".cm-tooltip-autocomplete ul li[aria-selected]": {
        backgroundColor: "var(--accent)",
        color: "white",
      },
      ".cm-tooltip-autocomplete ul li[aria-selected] .cm-completionDetail": {
        color: "rgba(255, 255, 255, 0.78)",
      },
    }),
  ];
}

function classifySql(sql: string): {
  isMutation: boolean;
  warning: string | null;
} {
  const trimmed = sql.trim();
  if (trimmed === "") return { isMutation: false, warning: null };
  const normalized = trimmed.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, " ");
  const isRead = /^\s*(select|pragma|with|explain)\b/i.test(normalized);
  const withoutStrings = normalized.replace(/'([^']|'')*'/g, "''");

  if (/^\s*delete\s+from\b/i.test(withoutStrings) && !/\bwhere\b/i.test(withoutStrings)) {
    return { isMutation: true, warning: "DELETE without WHERE will affect the entire table." };
  }
  if (/^\s*update\b/i.test(withoutStrings) && !/\bwhere\b/i.test(withoutStrings)) {
    return { isMutation: true, warning: "UPDATE without WHERE will modify the entire table." };
  }
  if (/^\s*drop\s+table\b/i.test(withoutStrings)) {
    return { isMutation: true, warning: "DROP TABLE removes the table from the connected app." };
  }
  if (/^\s*alter\s+table\b/i.test(withoutStrings)) {
    return { isMutation: true, warning: "ALTER TABLE changes the schema in real time." };
  }
  return { isMutation: !isRead, warning: null };
}

function previewSqlForTable(table: TableSchema | undefined, kind: "select" | "count" | "insert"): string {
  if (!table) return "";
  const tableName = quoteIdent(table.name);
  if (kind === "count") return `SELECT COUNT(*) AS total\nFROM ${tableName};`;
  // Numa view sem INSTEAD OF INSERT o template geraria SQL que o SQLite
  // recusa. Cair no SELECT é mais útil que oferecer um erro pronto.
  if (kind === "insert" && table.kind === "view" && table.writable?.insert !== true) {
    return `SELECT *\nFROM ${tableName}\nLIMIT 100;`;
  }
  if (kind === "insert") {
    const writable = table.columns.filter((column) => column.pkIndex === 0);
    const columns = writable.length > 0 ? writable : table.columns;
    return `INSERT INTO ${tableName} (${columns.map((column) => quoteIdent(column.name)).join(", ")})\nVALUES (${columns.map(() => "?").join(", ")});`;
  }
  return `SELECT *\nFROM ${tableName}\nLIMIT 100;`;
}

function resultCountLabel(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "row" : "rows"} returned`;
}

function resultColumnSchema(
  columnName: string,
  schema: TableSchema | undefined,
): TableSchema["columns"][number] | undefined {
  const normalized = columnName.replace(/^"|"$/g, "").replaceAll('""', '"').toLowerCase();
  return schema?.columns.find((column) => column.name.toLowerCase() === normalized);
}

/**
 * Console SQL avançado. O autocomplete é 100% local: schema carregado pelo
 * inspector + parsing leve do texto antes do cursor.
 */
export function SqlConsole() {
  const selection = useStudio((s) => s.selection);
  const selectedTable = useStudio((s) => s.selectedTable);
  const tableKey = selection ? keysId(selection.providerId, selection.instanceId) : null;
  const tables = useStudio((s) =>
    tableKey ? (s.tables[tableKey] ?? EMPTY_TABLES) : EMPTY_TABLES,
  );
  const size = useLayout((s) => s.panels.sqlConsole.size);
  const collapsed = useLayout((s) => s.panels.sqlConsole.collapsed);
  const toggleCollapsed = useLayout((s) => s.toggleCollapsed);
  const open = !collapsed;
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<ExecuteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const runRef = useRef<() => void>(() => {});

  const selectedSchema = selectedTable ? tableByName(tables, selectedTable) : undefined;
  const classification = classifySql(sql);

  async function run(): Promise<void> {
    if (!selection || sql.trim() === "") return;
    if (classification.isMutation && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setRunning(true);
    setError(null);
    try {
      setResult(await executeSql(selection.providerId, selection.instanceId, sql));
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
    }
  }
  runRef.current = () => void run();

  const extensions = useMemo(
    () => createEditorExtensions(tables, selectedTable, () => runRef.current()),
    [tables, selectedTable],
  );

  if (!selection) return null;

  function insertTemplate(kind: "select" | "count" | "insert"): void {
    const next = previewSqlForTable(selectedSchema, kind);
    if (!next) return;
    setSql(next);
    setConfirming(false);
    setResult(null);
    setError(null);
  }

  return (
    <section
      style={open ? { height: size } : undefined}
      className="relative flex shrink-0 flex-col border-t border-border"
    >
      {open && <ResizeHandle panelId="sqlConsole" edge="top" />}
      <button
        onClick={() => toggleCollapsed("sqlConsole")}
        className="flex h-8 w-full shrink-0 items-center gap-2 px-3 text-[11px] font-semibold uppercase tracking-wide text-text-muted hover:bg-surface-hover"
      >
        SQL
        {tables.length > 0 && (
          <span className="flex items-center gap-1 rounded border border-border bg-surface-sunken px-1.5 py-0.5 font-normal normal-case tracking-normal text-text-subtle">
            <Sparkles size={11} strokeWidth={1.5} />
            autocomplete
          </span>
        )}
        <span className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-text-subtle">
          {open ? (
            <ChevronDown size={14} strokeWidth={1.5} />
          ) : (
            <ChevronUp size={14} strokeWidth={1.5} />
          )}
        </span>
      </button>

      {open && (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden border-t border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-[11px] text-text-muted">
              <Table2 size={12} strokeWidth={1.5} />
              {selectedTable ?? "no table selected"}
            </span>
            <button
              onClick={() => insertTemplate("select")}
              disabled={!selectedSchema}
              className="rounded border border-border px-2 py-1 font-mono text-[11px] text-text-muted hover:bg-surface-hover disabled:opacity-40"
            >
              SELECT
            </button>
            <button
              onClick={() => insertTemplate("count")}
              disabled={!selectedSchema}
              className="rounded border border-border px-2 py-1 font-mono text-[11px] text-text-muted hover:bg-surface-hover disabled:opacity-40"
            >
              COUNT
            </button>
            <button
              onClick={() => insertTemplate("insert")}
              disabled={!selectedSchema}
              className="rounded border border-border px-2 py-1 font-mono text-[11px] text-text-muted hover:bg-surface-hover disabled:opacity-40"
            >
              INSERT
            </button>
            <span className="ml-auto flex items-center gap-1 text-[11px] text-text-subtle">
              <Wand2 size={12} strokeWidth={1.5} />
              Ctrl+Space
            </span>
          </div>

          <div className="flex shrink-0 items-start gap-2">
            <div className="min-w-0 flex-1">
              <CodeMirror
                value={sql}
                onChange={(value) => {
                  setSql(value);
                  setConfirming(false);
                }}
                extensions={extensions}
                basicSetup={{
                  foldGutter: false,
                  highlightActiveLine: true,
                  highlightActiveLineGutter: false,
                }}
                theme="none"
                minHeight="96px"
                maxHeight="240px"
                placeholder={
                  selectedSchema
                    ? previewSqlForTable(selectedSchema, "select")
                    : "Select a table to load a real query template."
                }
              />
            </div>
            <button
              onClick={() => void run()}
              disabled={running || sql.trim() === ""}
              className={`flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50 ${
                confirming ? "bg-deleted" : "bg-accent hover:bg-accent-hover"
              }`}
            >
              <Play size={12} strokeWidth={2} />
              {confirming ? "Confirm" : running ? "Running..." : "Run"}
            </button>
          </div>

          {classification.warning && (
            <p className="rounded border border-deleted/30 bg-deleted-wash px-2 py-1 text-[12px] text-deleted">
              {classification.warning}
            </p>
          )}

          {error && <p className="text-[12px] text-deleted">{error}</p>}

          {result?.kind === "mutation" && (
            <div className="flex h-10 shrink-0 items-center gap-2 rounded-md border border-border bg-surface px-3 text-[12px]">
              <span className="font-mono font-semibold text-text">Result</span>
              <span className="text-text-muted">
                {result.rowsAffected.toLocaleString()} {result.rowsAffected === 1 ? "row" : "rows"} affected
              </span>
            </div>
          )}

          {result?.kind === "rows" && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-surface">
              <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
                <Table2 size={13} strokeWidth={1.5} className="text-text-subtle" />
                <span className="font-mono text-[12px] font-semibold text-text">Results</span>
                <span className="text-[11px] tabular-nums text-text-subtle">
                  {resultCountLabel(result.rows.length)}
                </span>
                <span className="ml-auto text-[11px] tabular-nums text-text-subtle">
                  {result.columns.length.toLocaleString()} {result.columns.length === 1 ? "column" : "columns"}
                </span>
              </div>

              <div className="min-h-0 flex-1 overflow-auto">
                {result.rows.length === 0 ? (
                  <div className="flex min-h-24 items-center justify-center px-4 text-[12px] text-text-subtle">
                    No rows returned by this query.
                  </div>
                ) : (
                  <table
                    aria-label="SQL query results"
                    className="w-full border-separate border-spacing-0 font-mono text-[12px]"
                    style={{ minWidth: Math.max(720, result.columns.length * 160) }}
                  >
                    <thead className="sticky top-0 z-10 bg-surface">
                      <tr>
                        {result.columns.map((column) => {
                          const schemaColumn = resultColumnSchema(column, selectedSchema);
                          return (
                            <th
                              key={column}
                              className="h-9 border-b border-r border-border bg-surface px-0 text-left align-middle font-normal"
                            >
                              <div className="flex h-full min-w-0 items-center gap-2 px-3">
                                <span className="min-w-0 truncate font-semibold text-text">{column}</span>
                                {schemaColumn !== undefined && schemaColumn.pkIndex > 0 && (
                                  <span className="shrink-0 text-[10px] font-medium text-accent">pk</span>
                                )}
                                <span className="shrink-0 text-[11px] font-normal text-text-subtle">
                                  {schemaColumn?.declaredType || "no type"}
                                </span>
                              </div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row, i) => (
                        <tr key={i} className="group hover:bg-surface-hover">
                          {result.columns.map((column) => {
                            const value = row[column] ?? null;
                            const displayValue =
                              value === null
                                ? "NULL"
                                : isBlobCell(value)
                                  ? blobLabel(value)
                                  : String(value);
                            return (
                              <td
                                key={column}
                                className="h-8 max-w-[32rem] border-b border-r border-border px-3 align-middle"
                              >
                                <div
                                  className={`max-w-[32rem] truncate ${value === null ? "text-text-subtle" : isBlobCell(value) ? "text-text-muted" : "text-text"}`}
                                  title={displayValue}
                                >
                                  {displayValue}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
