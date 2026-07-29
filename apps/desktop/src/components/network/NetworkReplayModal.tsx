import { useLayoutEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json as jsonLanguage } from "@codemirror/lang-json";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { parse as parseGraphQL } from "graphql";
import { Braces, Check, ChevronDown, ChevronUp, CircleAlert, Plus, RefreshCw, RotateCcw, Trash2, X } from "lucide-react";
import type { NetworkRequest } from "@rnsi/protocol";
import { useNetwork } from "../../lib/network-store.ts";
import { getNetworkBody, replayRequest } from "../../lib/studio-client.ts";
import {
  formatGraphQLQuery,
  getGraphQLRequestInfo,
} from "../../lib/network-graphql.ts";
import { methodColorClass, requestTypeLabel } from "./format.ts";
import { GraphQLCodeEditor } from "./GraphQLCodeEditor.tsx";

type ReplayMode = "original" | "current-session";
type ReplayTab =
  | "query"
  | "headers"
  | "body"
  | "graphql-operation"
  | "graphql-variables";

type PairRow = {
  id: string;
  key: string;
  value: string;
};

const COMMON_HEADER_NAMES = [
  "Accept",
  "Accept-Encoding",
  "Accept-Language",
  "Authorization",
  "Cache-Control",
  "Content-Type",
  "Cookie",
  "If-None-Match",
  "Origin",
  "Referer",
  "User-Agent",
  "X-API-Key",
  "X-Request-ID",
] as const;

const LONG_VALUE_THRESHOLD = 96;

let replayRowSequence = 0;

function nextRowId(prefix: string): string {
  replayRowSequence += 1;
  return `${prefix}-${replayRowSequence}`;
}

function rowsFromQuery(query: string | null): PairRow[] {
  if (!query) return [];
  return Array.from(new URLSearchParams(query).entries()).map(([key, value]) => ({
    id: nextRowId("query"),
    key,
    value,
  }));
}

function queryFromRows(rows: PairRow[]): string {
  const params = new URLSearchParams();
  for (const row of rows) {
    const key = row.key.trim();
    if (key) params.append(key, row.value);
  }
  return params.toString();
}

function rowsFromHeaders(headers: Record<string, string>): PairRow[] {
  return Object.entries(headers).map(([key, value]) => ({
    id: nextRowId("header"),
    key,
    value,
  }));
}

function headersFromRows(rows: PairRow[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key) headers[key] = row.value;
  }
  return headers;
}

function pairSignature(rows: PairRow[]): string {
  return rows
    .map((row) => [row.key.trim().toLowerCase(), row.value] as const)
    .filter(([key]) => key.length > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}`)
    .join("\n");
}

function parseJson(text: string): { valid: boolean; value: unknown | null; error: string | null } {
  if (text.trim() === "") return { valid: true, value: null, error: null };
  try {
    return { valid: true, value: JSON.parse(text), error: null };
  } catch (cause) {
    return {
      valid: false,
      value: null,
      error: cause instanceof Error ? cause.message.replace(/^JSON\.parse: /, "") : "Invalid JSON",
    };
  }
}

function prettyJson(text: string): string {
  const parsed = parseJson(text);
  return parsed.valid && text.trim() !== "" ? JSON.stringify(parsed.value, null, 2) : text;
}

function bodySignature(text: string): string {
  const parsed = parseJson(text);
  return parsed.valid ? `json:${JSON.stringify(parsed.value)}` : `text:${text}`;
}

function headerValue(headers: Record<string, string>, name: string): string | null {
  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === expected) return value;
  }
  return null;
}

function buildGraphQLReplayBody(
  baselineBody: string,
  query: string,
  variables: unknown,
  operationName: string,
): string {
  const parsed = parseJson(baselineBody);
  const envelope =
    parsed.valid &&
    typeof parsed.value === "object" &&
    parsed.value !== null &&
    !Array.isArray(parsed.value)
      ? { ...(parsed.value as Record<string, unknown>) }
      : {};

  envelope.query = query;
  envelope.variables = variables;
  if (operationName.trim()) envelope.operationName = operationName.trim();
  else delete envelope.operationName;
  return JSON.stringify(envelope, null, 2);
}

const replayJsonHighlight = HighlightStyle.define([
  { tag: tags.propertyName, color: "var(--cm-property)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--cm-string)" },
  { tag: [tags.number, tags.integer, tags.float], color: "var(--cm-number)" },
  { tag: tags.bool, color: "var(--cm-bool)", fontWeight: "600" },
  { tag: tags.null, color: "var(--cm-null)", fontWeight: "600" },
  { tag: tags.punctuation, color: "var(--cm-punctuation)" },
]);

const replayEditorTheme = EditorView.theme({
  "&": {
    "--cm-property": "#476f8f",
    "--cm-string": "#5f7f4b",
    "--cm-number": "#8a5a9e",
    "--cm-bool": "#9a6a34",
    "--cm-null": "#9a6a34",
    "--cm-punctuation": "#7a756d",
    backgroundColor: "var(--surface-raised)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    fontSize: "12px",
  },
  ".dark &": {
    "--cm-property": "#9bd4ff",
    "--cm-string": "#b8df9f",
    "--cm-number": "#d9b2ff",
    "--cm-bool": "#f3c47e",
    "--cm-null": "#f3c47e",
    "--cm-punctuation": "#c4bdb2",
  },
  "&.cm-focused": {
    outline: "1px solid color-mix(in srgb, var(--accent) 72%, transparent)",
  },
  ".cm-content": {
    caretColor: "var(--accent)",
    fontFamily: "var(--font-mono)",
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
    backgroundColor: "color-mix(in srgb, var(--accent-wash) 68%, transparent)",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
  },
});

const textEditorExtensions: Extension[] = [EditorView.lineWrapping, replayEditorTheme];
const jsonEditorExtensions: Extension[] = [
  jsonLanguage(),
  syntaxHighlighting(replayJsonHighlight),
  EditorView.lineWrapping,
  replayEditorTheme,
];

export function NetworkReplayModal({
  request,
  onClose,
}: {
  request: NetworkRequest;
  onClose: () => void;
}) {
  const select = useNetwork((state) => state.select);
  const graphQL = useMemo(() => getGraphQLRequestInfo(request), [request]);
  const graphQLEditable =
    graphQL?.source === "body" &&
    graphQL.batched === false &&
    !request.requestBody?.contentType
      ?.toLowerCase()
      .includes("application/graphql") &&
    request.requestBody?.kind !== "binary" &&
    request.requestBody?.kind !== "form";
  const initialQueryRows = useMemo(() => rowsFromQuery(request.query), [request.query]);
  const initialHeaderRows = useMemo(() => rowsFromHeaders(request.requestHeaders), [request.requestHeaders]);
  const initialBody = useMemo(() => {
    const text = request.requestBody?.text ?? "";
    return request.requestBody?.truncated ? text : prettyJson(text);
  }, [request.requestBody]);
  const initialContentType =
    request.requestBody?.contentType ?? headerValue(request.requestHeaders, "content-type") ?? "";
  const capturedBodyKind = request.requestBody?.kind ?? "text";
  const bodyCanBeEdited = capturedBodyKind !== "binary" && capturedBodyKind !== "form";
  const initialGraphQLQuery =
    graphQLEditable
      ? (graphQL.primary.formattedQuery ?? graphQL.primary.query ?? "")
      : "";
  const initialGraphQLVariables =
    graphQLEditable && graphQL.primary.variables != null
      ? JSON.stringify(graphQL.primary.variables, null, 2)
      : "{}";
  const initialGraphQLOperationName =
    graphQLEditable ? (graphQL.primary.operationName ?? "") : "";

  const [mode, setMode] = useState<ReplayMode>("original");
  const [tab, setTab] = useState<ReplayTab>(() =>
    graphQLEditable
      ? "graphql-operation"
      : request.requestBody?.text
        ? "body"
        : request.query
          ? "query"
          : "headers",
  );
  const [queryRows, setQueryRows] = useState<PairRow[]>(initialQueryRows);
  const [headerRows, setHeaderRows] = useState<PairRow[]>(initialHeaderRows);
  const [baselineBody, setBaselineBody] = useState(initialBody);
  const [body, setBody] = useState(initialBody);
  const [bodyEdited, setBodyEdited] = useState(false);
  const [graphQLQuery, setGraphQLQuery] = useState(initialGraphQLQuery);
  const [graphQLVariables, setGraphQLVariables] = useState(
    initialGraphQLVariables,
  );
  const [graphQLOperationName, setGraphQLOperationName] = useState(
    initialGraphQLOperationName,
  );
  const [loadedFullBody, setLoadedFullBody] = useState(false);
  const [loadingFullBody, setLoadingFullBody] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => queryFromRows(queryRows), [queryRows]);
  const headers = useMemo(() => headersFromRows(headerRows), [headerRows]);
  const bodyParse = useMemo(() => parseJson(body), [body]);
  const bodyLooksJson =
    capturedBodyKind === "json" ||
    initialContentType.toLowerCase().includes("json") ||
    (bodyParse.valid && (body.trim().startsWith("{") || body.trim().startsWith("[")));
  const previewIsTruncated = request.requestBody?.truncated === true && !loadedFullBody;
  const bodyInvalid =
    bodyCanBeEdited &&
    bodyLooksJson &&
    body.trim() !== "" &&
    !bodyParse.valid &&
    (bodyEdited || !previewIsTruncated);
  const queryDirty = query !== queryFromRows(initialQueryRows);
  const headersDirty = pairSignature(headerRows) !== pairSignature(initialHeaderRows);
  const bodyDirty = bodyCanBeEdited && bodyEdited && bodySignature(body) !== bodySignature(baselineBody);
  const graphQLQueryError = useMemo(() => {
    if (!graphQLEditable || graphQLQuery.trim() === "") return null;
    try {
      parseGraphQL(graphQLQuery);
      return null;
    } catch (cause) {
      return cause instanceof Error ? cause.message : "Invalid GraphQL document";
    }
  }, [graphQLEditable, graphQLQuery]);
  const graphQLVariablesParse = useMemo(
    () => parseJson(graphQLVariables),
    [graphQLVariables],
  );
  const graphQLDirty =
    Boolean(graphQLEditable) &&
    (formatGraphQLQuery(graphQLQuery) !==
      formatGraphQLQuery(initialGraphQLQuery) ||
      bodySignature(graphQLVariables) !==
        bodySignature(initialGraphQLVariables) ||
      graphQLOperationName !== initialGraphQLOperationName);
  const graphQLInvalid =
    Boolean(graphQLEditable) &&
    (graphQLQueryError !== null || !graphQLVariablesParse.valid);
  const changeCount =
    Number(queryDirty) +
    Number(headersDirty) +
    Number(bodyDirty || graphQLDirty);
  const removedHeaders = useMemo(() => {
    const remaining = new Set(headerRows.map((row) => row.key.trim().toLowerCase()).filter(Boolean));
    return Object.keys(request.requestHeaders).filter((header) => !remaining.has(header.toLowerCase()));
  }, [headerRows, request.requestHeaders]);

  function changeRow(
    setRows: React.Dispatch<React.SetStateAction<PairRow[]>>,
    id: string,
    field: "key" | "value",
    value: string,
  ): void {
    setRows((rows) => rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
    setError(null);
  }

  function reset(): void {
    setQueryRows(rowsFromQuery(request.query));
    setHeaderRows(rowsFromHeaders(request.requestHeaders));
    setBody(baselineBody);
    setBodyEdited(false);
    setGraphQLQuery(initialGraphQLQuery);
    setGraphQLVariables(initialGraphQLVariables);
    setGraphQLOperationName(initialGraphQLOperationName);
    setError(null);
  }

  async function loadFullBody(): Promise<void> {
    setLoadingFullBody(true);
    setError(null);
    try {
      const full = await getNetworkBody(request.id, "request");
      if (!full) {
        setError("The full request body is no longer available on this device.");
        return;
      }
      const next = prettyJson(full.text);
      setBaselineBody(next);
      setBody(next);
      setBodyEdited(false);
      setLoadedFullBody(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the full request body.");
    } finally {
      setLoadingFullBody(false);
    }
  }

  function formatBody(): void {
    const parsed = parseJson(body);
    if (!parsed.valid) return;
    setBody(JSON.stringify(parsed.value, null, 2));
  }

  const replay = async () => {
    if (busy || bodyInvalid || graphQLInvalid) return;
    setBusy(true);
    setError(null);
    try {
      const overrides: {
        query?: string | null;
        headers?: Record<string, string>;
        removedHeaders?: string[];
        body?: string | null;
      } = {};
      if (queryDirty) overrides.query = query === "" ? null : query;
      if (headersDirty) {
        overrides.headers = headers;
        if (removedHeaders.length > 0) overrides.removedHeaders = removedHeaders;
      }
      if (bodyDirty) {
        overrides.body = body === "" ? null : body;
      } else if (graphQLDirty) {
        overrides.body = buildGraphQLReplayBody(
          baselineBody,
          graphQLQuery,
          graphQLVariablesParse.value,
          graphQLOperationName,
        );
      }

      const newId = await replayRequest(
        request.id,
        mode,
        Object.keys(overrides).length > 0 ? overrides : undefined,
      );
      if (!newId) {
        setError("Replay could not reach the app. Confirm the device is still connected.");
        return;
      }
      select(newId);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Replay failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-3.5">
          <RefreshCw size={16} strokeWidth={1.5} className="text-accent" />
          <h2 className="text-[14px] font-semibold text-text">Replay request</h2>
          <span className={`ml-1 font-mono text-[11px] font-bold uppercase ${methodColorClass(requestTypeLabel(request))}`}>
            {requestTypeLabel(request)}
          </span>
          <span className="min-w-0 truncate font-mono text-[12px] text-text-muted">
            {graphQL?.primary.operationName ?? request.path}
          </span>
          <button
            onClick={onClose}
            aria-label="Close replay"
            className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-text-subtle hover:bg-surface-hover hover:text-text"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface-sunken px-5 py-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">Session</span>
          <div className="flex rounded-md border border-border bg-surface-raised p-0.5">
            <ModeButton active={mode === "original"} onClick={() => setMode("original")} title="Use the request exactly as it was captured.">
              Original
            </ModeButton>
            <ModeButton
              active={mode === "current-session"}
              onClick={() => setMode("current-session")}
              title="Use the app's newest Authorization and Cookie values for this host."
            >
              Current session
            </ModeButton>
          </div>
          <span className="text-[11px] text-text-subtle">
            {mode === "original" ? "Captured credentials" : "Fresh app credentials"}
          </span>
          <button
            onClick={reset}
            disabled={changeCount === 0}
            className="ml-auto inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface-raised px-2 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text disabled:cursor-default disabled:opacity-40"
          >
            <RotateCcw size={12} strokeWidth={1.5} />
            Reset changes
          </button>
        </div>

        <div className="flex shrink-0 items-center border-b border-border px-5">
          {graphQLEditable ? (
            <>
              <ReplayTab
                active={tab === "graphql-operation"}
                onClick={() => setTab("graphql-operation")}
              >
                Operation
              </ReplayTab>
              <ReplayTab
                active={tab === "graphql-variables"}
                onClick={() => setTab("graphql-variables")}
              >
                Variables
              </ReplayTab>
            </>
          ) : null}
          <ReplayTab active={tab === "query"} onClick={() => setTab("query")} count={queryRows.filter((row) => row.key.trim()).length}>
            URL params
          </ReplayTab>
          <ReplayTab active={tab === "headers"} onClick={() => setTab("headers")} count={headerRows.filter((row) => row.key.trim()).length}>
            Headers
          </ReplayTab>
          <ReplayTab active={tab === "body"} onClick={() => setTab("body")}>
            {graphQLEditable ? "Raw body" : "Body"}
          </ReplayTab>
          {changeCount > 0 && (
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-accent">
              <Check size={12} strokeWidth={2} />
              {changeCount} {changeCount === 1 ? "section changed" : "sections changed"}
            </span>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {tab === "graphql-operation" && graphQLEditable ? (
            <div className="flex min-h-[330px] flex-col">
              <div className="mb-3 flex items-end gap-3">
                <label className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
                    Operation name
                  </span>
                  <input
                    value={graphQLOperationName}
                    onChange={(event) => {
                      setGraphQLOperationName(event.target.value);
                      setError(null);
                    }}
                    placeholder="Anonymous operation"
                    className="h-8 rounded-md border border-border bg-surface-raised px-2.5 font-mono text-[12px] text-text outline-none focus:border-accent"
                  />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setGraphQLQuery(formatGraphQLQuery(graphQLQuery))
                  }
                  disabled={graphQLQueryError !== null}
                  className="inline-flex h-8 items-center rounded-md border border-border bg-surface-raised px-2.5 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text disabled:opacity-40"
                >
                  Format operation
                </button>
              </div>
              <GraphQLCodeEditor
                value={graphQLQuery}
                onChange={(value) => {
                  setGraphQLQuery(value);
                  setError(null);
                }}
                minHeight="280px"
                maxHeight="min(430px, 48vh)"
              />
              {graphQLQueryError ? (
                <p className="mt-2 flex items-start gap-1.5 text-[11px] text-deleted">
                  <CircleAlert
                    size={13}
                    strokeWidth={1.5}
                    className="mt-0.5 shrink-0"
                  />
                  {graphQLQueryError}
                </p>
              ) : null}
            </div>
          ) : tab === "graphql-variables" && graphQLEditable ? (
            <div className="flex min-h-[330px] flex-col">
              <div className="mb-3 flex items-center gap-2">
                <Braces
                  size={13}
                  strokeWidth={1.5}
                  className="text-text-subtle"
                />
                <span className="text-[12px] font-medium text-text">
                  JSON variables
                </span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                    graphQLVariablesParse.valid
                      ? "bg-created-wash text-created"
                      : "bg-deleted-wash text-deleted"
                  }`}
                >
                  {graphQLVariablesParse.valid ? "Valid JSON" : "Invalid JSON"}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setGraphQLVariables(prettyJson(graphQLVariables))
                  }
                  disabled={!graphQLVariablesParse.valid}
                  className="ml-auto inline-flex h-7 items-center rounded-md border border-border bg-surface-raised px-2 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text disabled:opacity-40"
                >
                  Format JSON
                </button>
              </div>
              <CodeMirror
                value={graphQLVariables}
                onChange={(value) => {
                  setGraphQLVariables(value);
                  setError(null);
                }}
                extensions={jsonEditorExtensions}
                basicSetup={{
                  foldGutter: true,
                  highlightActiveLine: true,
                  highlightActiveLineGutter: false,
                  lineNumbers: true,
                }}
                theme="none"
                minHeight="280px"
                maxHeight="min(430px, 48vh)"
              />
              {!graphQLVariablesParse.valid ? (
                <p className="mt-2 text-[11px] text-deleted">
                  Fix the variables JSON before replaying.{" "}
                  {graphQLVariablesParse.error}
                </p>
              ) : null}
            </div>
          ) : tab === "query" ? (
            <PairEditor
              description="Edit URL parameters without touching the path. Empty parameter names are ignored."
              emptyLabel="No query parameters captured."
              rows={queryRows}
              keyLabel="Parameter"
              valueLabel="Value"
              addLabel="Add parameter"
              onAdd={() => setQueryRows((rows) => [...rows, { id: nextRowId("query"), key: "", value: "" }])}
              onChange={(id, field, value) => changeRow(setQueryRows, id, field, value)}
              onRemove={(id) => {
                setQueryRows((rows) => rows.filter((row) => row.id !== id));
                setError(null);
              }}
            />
          ) : tab === "headers" ? (
            <PairEditor
              description={
                mode === "current-session"
                  ? "Edit request headers freely. Authorization and Cookie are refreshed from the app for this mode."
                  : "Headers are sent exactly as shown. Choose a common header or type any name; removing a captured header removes it from the replay."
              }
              emptyLabel="No request headers captured."
              rows={headerRows}
              keyLabel="Header"
              valueLabel="Value"
              addLabel="Add header"
              suggestions={COMMON_HEADER_NAMES}
              onAdd={() => setHeaderRows((rows) => [...rows, { id: nextRowId("header"), key: "", value: "" }])}
              onAddSuggestion={(key) => {
                setHeaderRows((rows) => [...rows, { id: nextRowId("header"), key, value: "" }]);
                setError(null);
              }}
              onChange={(id, field, value) => changeRow(setHeaderRows, id, field, value)}
              onRemove={(id) => {
                setHeaderRows((rows) => rows.filter((row) => row.id !== id));
                setError(null);
              }}
            />
          ) : bodyCanBeEdited ? (
            <div className="flex min-h-[300px] flex-col">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <Braces size={13} strokeWidth={1.5} className="text-text-subtle" />
                  <span className="text-[12px] font-medium text-text">{bodyLooksJson ? "JSON body" : "Text body"}</span>
                  {bodyLooksJson && (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        bodyInvalid ? "bg-deleted-wash text-deleted" : "bg-created-wash text-created"
                      }`}
                    >
                      {bodyInvalid ? <CircleAlert size={10} strokeWidth={1.5} /> : <Check size={10} strokeWidth={1.8} />}
                      {bodyInvalid ? "Invalid JSON" : "Valid JSON"}
                    </span>
                  )}
                </div>
                <div className="ml-auto flex items-center gap-1.5">
                  {previewIsTruncated && (
                    <button
                      onClick={() => void loadFullBody()}
                      disabled={loadingFullBody}
                      className="inline-flex h-7 items-center rounded-md border border-border bg-surface-raised px-2 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text disabled:opacity-50"
                    >
                      {loadingFullBody ? "Loading full body..." : "Load full body"}
                    </button>
                  )}
                  {bodyLooksJson && (
                    <button
                      onClick={formatBody}
                      disabled={!bodyParse.valid || body.trim() === ""}
                      className="inline-flex h-7 items-center rounded-md border border-border bg-surface-raised px-2 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text disabled:opacity-40"
                    >
                      Format JSON
                    </button>
                  )}
                </div>
              </div>

              {previewIsTruncated && (
                <p className="mb-3 rounded-md border border-accent/25 bg-accent-wash px-3 py-2 text-[11px] leading-relaxed text-text-muted">
                  This is a truncated preview. Replay uses the complete captured body until you edit it. Load it first when you need to change a large payload.
                </p>
              )}

              <CodeMirror
                value={body}
                onChange={(value) => {
                  setBody(value);
                  setBodyEdited(true);
                  setError(null);
                }}
                extensions={bodyLooksJson ? jsonEditorExtensions : textEditorExtensions}
                basicSetup={{
                  foldGutter: false,
                  highlightActiveLine: true,
                  highlightActiveLineGutter: false,
                  lineNumbers: true,
                }}
                theme="none"
                minHeight="250px"
                maxHeight="min(390px, 42vh)"
                placeholder={bodyLooksJson ? '{\n  "key": "value"\n}' : "No body"}
              />
              {bodyInvalid && (
                <p className="mt-2 flex items-start gap-1.5 text-[11px] text-deleted">
                  <CircleAlert size={13} strokeWidth={1.5} className="mt-0.5 shrink-0" />
                  Fix the JSON before replaying. {bodyParse.error}
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-border bg-surface-sunken px-4 py-3 text-[12px] leading-relaxed text-text-muted">
              This request body was captured as {capturedBodyKind === "binary" ? "binary data" : "form data"}. It can be replayed unchanged, but cannot be safely edited as text.
            </div>
          )}

          {error && <p className="mt-3 text-[11px] text-deleted">{error}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3.5">
          <span className="mr-auto text-[11px] text-text-subtle">
            {bodyDirty ? "Body override ready" : "Unchanged sections use the captured request"}
          </span>
          <button
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-md border border-border px-3 text-[12px] text-text-muted hover:bg-surface-hover"
          >
            Cancel
          </button>
          <button
            onClick={() => void replay()}
            disabled={busy || bodyInvalid || graphQLInvalid}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[12px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw size={13} strokeWidth={2} className={busy ? "animate-spin" : ""} />
            {busy ? "Replaying..." : "Replay request"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReplayTab({
  active,
  count,
  children,
  onClick,
}: {
  active: boolean;
  count?: number;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex h-9 items-center gap-1.5 border-b-2 px-3 text-[12px] font-medium ${
        active ? "border-accent text-text" : "border-transparent text-text-muted hover:text-text"
      }`}
    >
      {children}
      {typeof count === "number" && (
        <span className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[10px] text-text-subtle">{count}</span>
      )}
    </button>
  );
}

function ModeButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`inline-flex h-7 items-center rounded px-2.5 text-[11px] ${
        active ? "bg-accent text-white" : "text-text-muted hover:bg-surface-hover hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

function PairEditor({
  description,
  emptyLabel,
  rows,
  keyLabel,
  valueLabel,
  addLabel,
  suggestions,
  onAdd,
  onAddSuggestion,
  onChange,
  onRemove,
}: {
  description: string;
  emptyLabel: string;
  rows: PairRow[];
  keyLabel: string;
  valueLabel: string;
  addLabel: string;
  suggestions?: readonly string[];
  onAdd: () => void;
  onAddSuggestion?: (key: string) => void;
  onChange: (id: string, field: "key" | "value", value: string) => void;
  onRemove: (id: string) => void;
}) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set());
  const [collapsedRows, setCollapsedRows] = useState<Set<string>>(() => new Set());
  const suggestionListId = suggestions ? keyLabel.toLowerCase() + "-suggestions" : undefined;

  function toggleValue(row: PairRow): void {
    const isLong = row.value.length > LONG_VALUE_THRESHOLD || row.value.includes("\n");
    const isExpanded = expandedRows.has(row.id) || (isLong && !collapsedRows.has(row.id));

    if (isExpanded) {
      setExpandedRows((current) => {
        const next = new Set(current);
        next.delete(row.id);
        return next;
      });
      setCollapsedRows((current) => new Set(current).add(row.id));
      return;
    }

    setCollapsedRows((current) => {
      const next = new Set(current);
      next.delete(row.id);
      return next;
    });
    setExpandedRows((current) => new Set(current).add(row.id));
  }

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="text-[12px] text-text-muted">{description}</p>
        {suggestions && onAddSuggestion ? (
          <select
            aria-label="Add a common header"
            defaultValue=""
            onChange={(event) => {
              const key = event.target.value;
              if (key) onAddSuggestion(key);
              event.currentTarget.value = "";
            }}
            className="ml-auto h-7 rounded-md border border-border bg-surface-raised px-2 text-[11px] text-text-muted outline-none hover:bg-surface-hover hover:text-text"
          >
            <option value="">Common headers...</option>
            {suggestions.map((suggestion) => (
              <option key={suggestion} value={suggestion}>
                {suggestion}
              </option>
            ))}
          </select>
        ) : null}
        <button
          onClick={onAdd}
          className={(suggestions ? "" : "ml-auto ") + "inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface-raised px-2 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text"}
        >
          <Plus size={12} strokeWidth={1.5} />
          {addLabel}
        </button>
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        <div className="grid grid-cols-[minmax(160px,0.42fr)_minmax(0,1fr)_76px_36px] border-b border-border bg-surface-sunken font-mono text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
          <span className="px-3 py-2">{keyLabel}</span>
          <span className="border-l border-border px-3 py-2">{valueLabel}</span>
          <span className="border-l border-border" />
          <span className="border-l border-border" />
        </div>
        {rows.length === 0 ? (
          <div className="px-3 py-5 text-[12px] text-text-subtle">{emptyLabel}</div>
        ) : (
          rows.map((row) => {
            const isLong = row.value.length > LONG_VALUE_THRESHOLD || row.value.includes("\n");
            const isExpanded = expandedRows.has(row.id) || (isLong && !collapsedRows.has(row.id));

            return (
              <div
                key={row.id}
                className="grid grid-cols-[minmax(160px,0.42fr)_minmax(0,1fr)_76px_36px] border-b border-border last:border-b-0"
              >
                <input
                  value={row.key}
                  onChange={(event) => onChange(row.id, "key", event.target.value)}
                  aria-label={keyLabel}
                  placeholder={keyLabel}
                  list={suggestionListId}
                  className="h-9 min-w-0 self-start bg-surface px-3 font-mono text-[12px] text-text outline-none shadow-none placeholder:text-text-subtle focus:bg-surface-raised focus-visible:outline-none focus-visible:shadow-none rnsi-replay-pair-input"
                />
                <PairValueField
                  value={row.value}
                  onChange={(next) => onChange(row.id, "value", next)}
                  ariaLabel={valueLabel}
                  placeholder={valueLabel}
                  maxHeight={isLong && !isExpanded ? 56 : 240}
                />
                <div className="flex items-start justify-center border-l border-border bg-surface pt-1.5">
                  {isLong ? (
                    <button
                      onClick={() => toggleValue(row)}
                      title={isExpanded ? "Collapse full value" : "Expand full value"}
                      className="inline-flex h-6 items-center gap-0.5 rounded px-1.5 text-[10px] text-text-muted hover:bg-surface-hover hover:text-text"
                    >
                      {isExpanded ? <ChevronUp size={12} strokeWidth={1.5} /> : <ChevronDown size={12} strokeWidth={1.5} />}
                      {isExpanded ? "Collapse" : "Expand"}
                    </button>
                  ) : null}
                </div>
                <button
                  onClick={() => onRemove(row.id)}
                  title={"Remove " + (row.key || keyLabel.toLowerCase())}
                  className="inline-flex items-start justify-center border-l border-border bg-surface pt-2.5 text-text-subtle hover:bg-deleted-wash hover:text-deleted"
                >
                  <Trash2 size={13} strokeWidth={1.5} />
                </button>
              </div>
            );
          })
        )}
      </div>
      {suggestions ? (
        <datalist id={suggestionListId}>
          {suggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      ) : null}
    </section>
  );
}

/** Campo de valor do par (header/query) que cresce em ALTURA conforme o
 *  conteúdo — quebra tokens longos (JWT, cookie) em várias linhas dentro da
 *  largura da célula em vez de cortar na horizontal como um <input>. Cresce até
 *  `maxHeight` e então rola. Estética da célula do grid: borda só à esquerda,
 *  sem canto arredondado; `min-h-9` alinha valores de uma linha à coluna da
 *  chave. */
function PairValueField({
  value,
  onChange,
  ariaLabel,
  placeholder,
  maxHeight,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder: string;
  maxHeight: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Mede o conteúdo e ajusta a altura. `height="auto"` primeiro para o
  // scrollHeight refletir o tamanho natural. Sem borda vertical aqui, então
  // scrollHeight (conteúdo + padding) já é a altura exata — nada a somar.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [value, maxHeight]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={ariaLabel}
      placeholder={placeholder}
      rows={1}
      spellCheck={false}
      style={{ maxHeight, overflowWrap: "anywhere" }}
      className="min-h-9 min-w-0 resize-none self-start border-l border-border bg-surface px-3 py-2 font-mono text-[12px] leading-relaxed text-text outline-none shadow-none placeholder:text-text-subtle focus:bg-surface-raised focus-visible:outline-none focus-visible:shadow-none rnsi-replay-pair-input"
    />
  );
}
