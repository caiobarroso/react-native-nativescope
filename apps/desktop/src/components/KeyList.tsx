import { Copy, Download, Files, MoreHorizontal, Plus, Search, Trash2 } from "lucide-react";
import type { KeyEntry, StorageValue } from "@rnsi/protocol";
import { useStudio, keysId } from "../lib/store.ts";
import {
  exportInstance,
  getValueComplete,
  loadKeys,
  loadMoreKeys,
  removeKey,
  setValue,
} from "../lib/studio-client.ts";
import { createFileSink } from "../lib/export.ts";
import { generateTypeScript } from "./ValueEditor.tsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

const TYPE_LABEL: Record<string, string> = {
  string: "str",
  number: "num",
  boolean: "bool",
  json: "json",
  buffer: "buf",
  null: "null",
};

function copyText(value: string): void {
  void navigator.clipboard.writeText(value);
}

function nextDuplicateName(key: string, entries: KeyEntry[] | undefined): string {
  const existing = new Set((entries ?? []).map((entry) => entry.key));
  const base = `${key}.copy`;
  if (!existing.has(base)) return base;
  let index = 2;
  while (existing.has(`${base}${index}`)) index += 1;
  return `${base}${index}`;
}

function storageTypeSchema(key: string, value: StorageValue): string {
  if (value.type === "json") {
    try {
      return generateTypeScript(JSON.parse(value.value), key, {
        declaration: "interface",
        arrayStyle: "array",
      });
    } catch {
      return generateTypeScript(undefined, key, { declaration: "type", arrayStyle: "array" });
    }
  }
  return generateTypeScript(
    value.type === "null" ? null : value.type === "buffer" ? "" : value.value,
    key,
    { declaration: "type", arrayStyle: "array" },
  );
}

export function KeyList() {
  const selection = useStudio((s) => s.selection);
  const keys = useStudio((s) =>
    selection ? s.keys[keysId(selection.providerId, selection.instanceId)] : undefined,
  );
  const selectedKey = useStudio((s) => s.selectedKey);
  const selectKey = useStudio((s) => s.selectKey);
  const recentChanges = useStudio((s) => s.recentChanges);
  const creating = useStudio((s) => s.creating);
  const setCreating = useStudio((s) => s.setCreating);
  const keyFilter = useStudio((s) => s.keyFilter);
  const setKeyFilter = useStudio((s) => s.setKeyFilter);
  const keysMeta = useStudio((s) =>
    selection ? s.keysMeta[keysId(selection.providerId, selection.instanceId)] : undefined,
  );
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState<number | null>(null);

  async function exportKeys(): Promise<void> {
    if (!selection || exporting !== null) return;
    const sink = await createFileSink(
      `${selection.providerId}-${selection.instanceId}.ndjson`,
    );
    if (!sink) return; // usuário cancelou
    setExporting(0);
    try {
      await exportInstance(
        { kind: "key-value", providerId: selection.providerId, instanceId: selection.instanceId },
        sink,
        (received) => setExporting(received),
      );
      await sink.close();
    } catch {
      await sink.abort();
    } finally {
      setExporting(null);
    }
  }

  const filtered = useMemo(
    () =>
      keyFilter.trim() === ""
        ? keys
        : keys?.filter(
            (e) =>
              e.key.toLowerCase().includes(keyFilter.toLowerCase()) ||
              e.preview.toLowerCase().includes(keyFilter.toLowerCase()),
          ),
    [keys, keyFilter],
  );

  // Virtualização: 1 milhão de chaves carregadas = ~30 nós DOM (plano §C).
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filtered?.length ?? 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 32,
    overscan: 12,
  });

  const loadMore = useCallback(() => {
    if (!selection || loadingMore) return;
    setLoadingMore(true);
    void loadMoreKeys(selection.providerId, selection.instanceId).finally(() =>
      setLoadingMore(false),
    );
  }, [selection, loadingMore]);

  // Scroll infinito: chegando perto do fim da janela carregada (sem filtro
  // ativo), a próxima página vem sozinha.
  const virtualItems = virtualizer.getVirtualItems();
  const lastVisibleIndex = virtualItems[virtualItems.length - 1]?.index ?? 0;
  useEffect(() => {
    if (keyFilter.trim() !== "") return;
    if (!keysMeta?.nextAfterKey || loadingMore) return;
    if (filtered && lastVisibleIndex >= filtered.length - 10) loadMore();
  }, [lastVisibleIndex, filtered, keysMeta?.nextAfterKey, keyFilter, loadingMore, loadMore]);

  if (!selection) return null;

  async function deleteEntry(key: string): Promise<void> {
    if (!selection) return;
    await removeKey(selection.providerId, selection.instanceId, key);
    if (selectedKey === key) selectKey(null);
    await loadKeys(selection.providerId, selection.instanceId);
    setOpenMenu(null);
  }

  async function duplicateEntry(key: string): Promise<void> {
    if (!selection) return;
    // Valor íntegro sempre — duplicar a partir de preview truncado corromperia.
    const value = await getValueComplete(selection.providerId, selection.instanceId, key);
    if (!value) return;
    const nextKey = nextDuplicateName(key, keys);
    await setValue(selection.providerId, selection.instanceId, nextKey, value);
    await loadKeys(selection.providerId, selection.instanceId);
    selectKey(nextKey);
    setOpenMenu(null);
  }

  async function copySchema(key: string): Promise<void> {
    if (!selection) return;
    const value = await getValueComplete(selection.providerId, selection.instanceId, key);
    if (!value) return;
    copyText(storageTypeSchema(key, value));
    setOpenMenu(null);
  }

  return (
    <div className="flex w-72 shrink-0 flex-col border-r border-border">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-2">
        <Search size={13} strokeWidth={1.5} className="shrink-0 text-text-subtle" />
        <input
          type="text"
          value={keyFilter}
          onChange={(e) => setKeyFilter(e.target.value)}
          placeholder="Filtrar chaves e valores"
          className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-text-subtle"
        />
        <button
          onClick={() => void exportKeys()}
          disabled={exporting !== null}
          title={
            exporting !== null
              ? `Exportando… ${Math.round(exporting / 1024)} KB`
              : "Exportar tudo (NDJSON, 100% dos dados via stream)"
          }
          className={`shrink-0 rounded p-1 ${
            exporting !== null
              ? "text-accent"
              : "text-text-subtle hover:bg-surface-hover hover:text-text"
          }`}
        >
          <Download size={13} strokeWidth={1.5} />
        </button>
        <button
          onClick={() => setCreating(true)}
          title="Nova chave"
          className={`shrink-0 rounded p-1 ${
            creating
              ? "bg-accent-wash text-accent"
              : "text-text-subtle hover:bg-surface-hover hover:text-text"
          }`}
        >
          <Plus size={14} strokeWidth={1.5} />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
      {keys === undefined && (
        <p className="p-4 text-text-subtle">Carregando chaves…</p>
      )}
      {keys?.length === 0 && (
        <p className="p-4 text-text-subtle">Nenhuma chave nesta instância.</p>
      )}
      {keys && keys.length > 0 && filtered?.length === 0 && (
        <p className="p-4 text-text-subtle">Nada bate com "{keyFilter}".</p>
      )}
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
      {virtualItems.map((virtualItem) => {
        const entry = filtered?.[virtualItem.index];
        if (!entry) return null;
        const active = entry.key === selectedKey;
        const changeStamp =
          recentChanges[`${keysId(selection.providerId, selection.instanceId)} ${entry.key}`];
        const flash = changeStamp && Date.now() - changeStamp < 950;
        return (
          <div
            key={`${entry.key}-${changeStamp ?? 0}`}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualItem.start}px)`,
            }}
            className={`group flex h-8 w-full shrink-0 items-center border-l-2 ${
              active
                ? "border-accent bg-accent-wash"
                : "border-transparent hover:bg-surface-hover"
            } ${flash ? "rnsi-flash" : ""}`}
          >
            <button
              onClick={() => {
                setOpenMenu(null);
                selectKey(entry.key);
              }}
              className="flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-left"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                {entry.key}
              </span>
              <span className="shrink-0 rounded border border-border px-1 py-px text-[10px] text-text-subtle">
                {TYPE_LABEL[entry.valueType] ?? entry.valueType}
              </span>
            </button>
            <button
              onClick={(event) => {
                event.stopPropagation();
                setOpenMenu((current) => (current === entry.key ? null : entry.key));
              }}
              className="mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-subtle opacity-0 hover:bg-surface-hover hover:text-text group-hover:opacity-100 data-[open=true]:opacity-100"
              data-open={openMenu === entry.key}
              title="Ações"
            >
              <MoreHorizontal size={14} strokeWidth={1.5} />
            </button>
            {openMenu === entry.key && (
              <div className="absolute right-1 top-7 z-30 w-44 overflow-hidden rounded-md border border-border bg-surface-raised py-1 text-[12px] shadow-lg shadow-black/10">
                <button
                  onClick={() => {
                    copyText(entry.key);
                    setOpenMenu(null);
                  }}
                  className="flex h-8 w-full items-center gap-2 px-2.5 text-left text-text-muted hover:bg-surface-hover hover:text-text"
                >
                  <Copy size={13} strokeWidth={1.5} />
                  Copiar nome
                </button>
                <button
                  onClick={() => void copySchema(entry.key)}
                  className="flex h-8 w-full items-center gap-2 px-2.5 text-left text-text-muted hover:bg-surface-hover hover:text-text"
                >
                  <Copy size={13} strokeWidth={1.5} />
                  Copiar schema
                </button>
                <button
                  onClick={() => void duplicateEntry(entry.key)}
                  className="flex h-8 w-full items-center gap-2 px-2.5 text-left text-text-muted hover:bg-surface-hover hover:text-text"
                >
                  <Files size={13} strokeWidth={1.5} />
                  Duplicar
                </button>
                <button
                  onClick={() => void deleteEntry(entry.key)}
                  className="flex h-8 w-full items-center gap-2 px-2.5 text-left text-deleted hover:bg-deleted-wash"
                >
                  <Trash2 size={13} strokeWidth={1.5} />
                  Deletar
                </button>
              </div>
            )}
          </div>
        );
      })}
      </div>
      {keysMeta?.nextAfterKey && (
        <div className="border-t border-border p-2">
          {keyFilter.trim() !== "" && (
            <p className="mb-1.5 px-1 text-[11px] text-text-subtle">
              Filtro aplicado às {keys?.length ?? 0} chaves carregadas.
            </p>
          )}
          <button
            disabled={loadingMore}
            onClick={loadMore}
            className="h-7 w-full rounded-md border border-border text-[12px] text-text-muted hover:bg-surface-hover hover:text-text disabled:opacity-50"
          >
            {loadingMore
              ? "Carregando…"
              : `Carregar mais (${keys?.length ?? 0} de ${keysMeta.total})`}
          </button>
        </div>
      )}
      </div>
    </div>
  );
}
