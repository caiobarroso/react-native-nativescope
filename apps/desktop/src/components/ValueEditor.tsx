import { useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";
import type { StorageValue } from "@rnsi/protocol";
import { useStudio, keysId } from "../lib/store.ts";
import { getValue, setValue, removeKey } from "../lib/studio-client.ts";

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

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
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
            onChange={(e) => setType(e.target.value as typeof type)}
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
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              placeholder='{"exemplo": true}'
              className="min-h-40 w-full flex-1 resize-none rounded-md border border-border bg-surface-raised p-3 font-mono text-[12px] leading-relaxed placeholder:text-text-subtle"
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
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* faixa de metadata — fina, não uma coluna (plano §5.2) */}
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border px-4">
        <span className="min-w-0 truncate font-mono text-[12px] font-semibold">
          {selectedKey}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-3 text-[11px] text-text-subtle">
          {entry && <span>{entry.approxSize} B</span>}
          <select
            value={draftType}
            onChange={(e) => setDraftType(e.target.value as ValueType)}
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

      <div className="flex-1 overflow-y-auto p-4">
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
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            className="h-full min-h-48 w-full resize-none rounded-md border border-border bg-surface-raised p-3 font-mono text-[12px] leading-relaxed"
          />
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
  );
}
