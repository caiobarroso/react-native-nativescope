import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Database, KeyRound, SlidersHorizontal } from "lucide-react";
import type { ProviderDescriptor } from "@rnsi/protocol";
import { scopeStoreId, type CaptureScope } from "../lib/snapshots.ts";

interface Store {
  id: string;
  kind: "kv" | "db";
  providerLabel: string;
  instanceLabel: string;
}

/**
 * Recorte da captura num controle só, na granularidade de store/instância —
 * MMKV, AsyncStorage e SQLite selecionados do mesmo jeito (o SQLite não desce a
 * tabela de propósito: o diff já quebra por tabela no resultado). Default = tudo
 * (emite `null`, mantendo o snapshot.scope = null).
 */
export function SnapshotScopePicker({
  providers,
  value,
  onChange,
  disabled,
}: {
  providers: ProviderDescriptor[];
  value: CaptureScope | null;
  onChange: (scope: CaptureScope | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const stores = useMemo<Store[]>(
    () =>
      providers.flatMap((provider) => {
        const kind: "kv" | "db" | null = provider.capabilities.includes("key-value.read")
          ? "kv"
          : provider.capabilities.includes("database.query")
            ? "db"
            : null;
        if (!kind) return [];
        return provider.instances.map((instance) => ({
          id: scopeStoreId(provider.providerId, instance.instanceId),
          kind,
          providerLabel: provider.label,
          instanceLabel: instance.label,
        }));
      }),
    [providers],
  );

  const universe = useMemo(() => stores.map((s) => s.id), [stores]);
  const selected = useMemo(() => new Set(value ? value.stores : universe), [value, universe]);
  const isAll = value === null;

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  /** Universo completo selecionado => `null` (= tudo). */
  function emit(next: Set<string>) {
    onChange(next.size === universe.length ? null : { stores: [...next] });
  }

  function toggle(id: string) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    emit(next);
  }

  const label = isAll
    ? "All storage"
    : selected.size === 0
      ? "Nothing selected"
      : `${selected.size} of ${universe.length}`;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[12px] text-text-muted hover:bg-surface-hover disabled:opacity-50"
        title="Choose which storages to capture"
      >
        <SlidersHorizontal size={13} strokeWidth={1.5} />
        {label}
        <ChevronDown size={12} strokeWidth={1.5} className={open ? "rotate-180 transition" : "transition"} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 w-72 rounded-lg border border-border bg-surface-raised shadow-xl">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Capture scope</span>
            <button type="button" onClick={() => onChange(null)} className="ml-auto text-[11px] text-accent hover:underline">
              All
            </button>
            <span className="text-text-subtle">·</span>
            <button
              type="button"
              onClick={() => onChange({ stores: [] })}
              className="text-[11px] text-text-subtle hover:text-text"
            >
              None
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto p-1.5">
            {stores.map((store) => (
              <Option
                key={store.id}
                checked={selected.has(store.id)}
                onToggle={() => toggle(store.id)}
                icon={
                  store.kind === "kv" ? (
                    <KeyRound size={13} strokeWidth={1.5} className="text-text-subtle" />
                  ) : (
                    <Database size={13} strokeWidth={1.5} className="text-text-subtle" />
                  )
                }
                title={store.providerLabel}
                subtitle={store.instanceLabel}
              />
            ))}

            {stores.length === 0 && (
              <p className="px-2 py-3 text-center text-[11px] text-text-subtle">No connected storage.</p>
            )}
          </div>

          <p className="border-t border-border px-3 py-2 text-[10px] leading-relaxed text-text-subtle">
            Whole storages. SQLite still breaks down by table in the diff.
          </p>
        </div>
      )}
    </div>
  );
}

function Option({
  checked,
  onToggle,
  icon,
  title,
  subtitle,
}: {
  checked: boolean;
  onToggle: () => void;
  icon?: ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-hover"
    >
      <span
        className={`grid size-4 shrink-0 place-items-center rounded border ${
          checked ? "border-accent bg-accent text-white" : "border-border-strong bg-surface"
        }`}
      >
        {checked && <Check size={11} strokeWidth={2.5} />}
      </span>
      {icon}
      <span className="truncate text-[12px] text-text">{title}</span>
      {subtitle && <span className="ml-auto truncate text-[10px] text-text-subtle">{subtitle}</span>}
    </button>
  );
}
