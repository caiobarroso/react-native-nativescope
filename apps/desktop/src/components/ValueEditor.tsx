import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Braces, Check, Code2, Copy, FileCode2, History, ListTree, Maximize2, Minimize2, Trash2, X } from "lucide-react";
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

function countJsonNodes(value: unknown): number {
  if (!isJsonRoot(value)) return 1;
  return (Object.values(value) as unknown[]).reduce<number>(
    (total, child) => total + countJsonNodes(child),
    1,
  );
}

function rootLabel(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} itens`;
  if (isJsonRoot(value)) return `${Object.keys(value).length} chaves`;
  if (value === null) return "null";
  return typeof value;
}

type TsDeclaration = "interface" | "type";
type TsArrayStyle = "array" | "bracket";

interface TypeScriptOptions {
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

function generateTypeScript(
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

function JsonWorkspace({
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
  const [mode, setMode] = useState<"tree" | "raw" | "ts">("tree");
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
          {parsed.error === null ? `${rootLabel(parsed.value)} · ${nodeCount} nós` : "inválido"}
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
        {mode === "ts" && parsed.error === null ? (
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
              onClick={() => setBoolDraft((v) => !v)}
              role="switch"
              aria-checked={boolDraft}
              className={`relative h-6 w-11 rounded-full transition-colors ${
                boolDraft ? "bg-accent" : "bg-border-strong"
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                  boolDraft ? "translate-x-5.5" : "translate-x-0.5"
                }`}
              />
            </button>
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
            onClick={() => setBoolDraft((v) => !v)}
            role="switch"
            aria-checked={boolDraft}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              boolDraft ? "bg-accent" : "bg-border-strong"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                boolDraft ? "translate-x-5.5" : "translate-x-0.5"
              }`}
            />
          </button>
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
