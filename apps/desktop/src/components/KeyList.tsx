import {
  Copy,
  ChartNoAxesColumnIncreasing,
  Files,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import type { KeyEntry, StorageValue } from "@rnsi/protocol";
import { useStudio, keysId } from "../lib/store.ts";
import { useLayout } from "../lib/layout.ts";
import { ResizeHandle } from "./ResizeHandle.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import {
  getValueComplete,
  loadKeys,
  loadMoreKeys,
  removeKey,
  searchKeys,
  setValue,
} from "../lib/studio-client.ts";
import { generateTypeScript } from "../lib/typescript-gen.ts";
import { useCallback, useEffect, useRef, useState } from "react";
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

export function KeyList({ onOpenOverview }: { onOpenOverview?: () => void }) {
  const selection = useStudio((s) => s.selection);
  const keys = useStudio((s) =>
    selection ? s.keys[keysId(selection.providerId, selection.instanceId)] : undefined,
  );
  const selectedKey = useStudio((s) => s.selectedKey);
  const selectKey = useStudio((s) => s.selectKey);
  const recentChanges = useStudio((s) => s.recentChanges);
  const activityFocus = useStudio((s) => s.activityFocus);
  const creating = useStudio((s) => s.creating);
  const setCreating = useStudio((s) => s.setCreating);
  const keyFilter = useStudio((s) => s.keyFilter);
  const setKeyFilter = useStudio((s) => s.setKeyFilter);
  const size = useLayout((s) => s.panels.keyList.size);
  const collapsed = useLayout((s) => s.panels.keyList.collapsed);
  const toggleCollapsed = useLayout((s) => s.toggleCollapsed);
  const keysMeta = useStudio((s) =>
    selection ? s.keysMeta[keysId(selection.providerId, selection.instanceId)] : undefined,
  );
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Busca NO DEVICE (plano §D), não filtro client-side sobre a página
  // carregada: com 1M de chaves e 200 carregadas, o filtro antigo dizia "nada
  // bate" mesmo havendo match na chave 900.000. Agora a varredura roda onde o
  // dado mora e só os matches viajam.
  const [searchResults, setSearchResults] = useState<KeyEntry[] | null>(null);
  const [searchInfo, setSearchInfo] = useState<{ complete: boolean; scanned: number } | null>(null);
  const [searching, setSearching] = useState(false);
  const filtering = keyFilter.trim() !== "";

  useEffect(() => {
    const q = keyFilter.trim();
    if (!selection || q === "") {
      setSearchResults(null);
      setSearchInfo(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchKeys(selection.providerId, selection.instanceId, q, 200)
        .then((result) => {
          if (cancelled) return;
          setSearchResults(result.entries);
          setSearchInfo({ complete: result.complete, scanned: result.scanned });
          setSearching(false);
        })
        .catch(() => {
          if (cancelled) return;
          setSearchResults([]);
          setSearchInfo(null);
          setSearching(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [keyFilter, selection]);

  const filtered = filtering ? searchResults ?? undefined : keys;

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
    void loadMoreKeys(selection.providerId, selection.instanceId)
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  }, [selection, loadingMore]);

  // Scroll infinito: chegando perto do fim da janela carregada (sem filtro
  // ativo), a próxima página vem sozinha.
  const virtualItems = virtualizer.getVirtualItems();
  const lastVisibleIndex = virtualItems[virtualItems.length - 1]?.index ?? 0;

  const focusedKey =
    activityFocus &&
    activityFocus.providerId === selection?.providerId &&
    activityFocus.instanceId === selection?.instanceId &&
    activityFocus.target.kind === "key-value"
      ? activityFocus.target.key
      : null;

  useEffect(() => {
    if (!focusedKey || !filtered) return;
    const index = filtered.findIndex((entry) => entry.key === focusedKey);
    if (index < 0) return;
    virtualizer.scrollToIndex(index, { align: "center" });
  }, [activityFocus?.token, filtered, focusedKey, virtualizer]);

  useEffect(() => {
    if (keyFilter.trim() !== "") return;
    if (!keysMeta?.nextAfterKey || loadingMore) return;
    if (filtered && lastVisibleIndex >= filtered.length - 10) loadMore();
  }, [lastVisibleIndex, filtered, keysMeta?.nextAfterKey, keyFilter, loadingMore, loadMore]);

  if (!selection) return null;

  if (collapsed) {
    return (
      <div className="flex w-9 shrink-0 flex-col items-center border-r border-border py-2">
        <button
          onClick={() => toggleCollapsed("keyList")}
          title="Expand key list"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-subtle hover:bg-surface-hover hover:text-text"
        >
          <PanelLeftOpen size={16} strokeWidth={1.5} />
        </button>
      </div>
    );
  }

  async function deleteEntry(key: string): Promise<void> {
    if (!selection) return;
    setDeleting(true);
    try {
      await removeKey(selection.providerId, selection.instanceId, key);
      if (selectedKey === key) selectKey(null);
      await loadKeys(selection.providerId, selection.instanceId);
      setDeleteCandidate(null);
    } finally {
      setDeleting(false);
    }
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
    <div
      style={{ width: size }}
      className="relative flex shrink-0 flex-col border-r border-border"
    >
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-2">
        <div className="relative min-w-0 flex-1">
          <Search
            size={13}
            strokeWidth={1.5}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-subtle"
          />
          <input
            type="text"
            value={keyFilter}
            onChange={(e) => setKeyFilter(e.target.value)}
            placeholder="Filter keys and values"
            className="h-7 w-full rounded-md border border-border bg-surface px-2 pl-7 text-[12px] outline-none placeholder:text-text-subtle focus:border-accent"
          />
        </div>
        <button
          onClick={onOpenOverview}
          title="Storage overview"
          className="shrink-0 rounded p-1 text-text-subtle hover:bg-surface-hover hover:text-text disabled:opacity-40"
        >
          <ChartNoAxesColumnIncreasing size={13} strokeWidth={1.5} />
        </button>
        <button
          onClick={() => setCreating(true)}
          title="New key"
          className={`shrink-0 rounded p-1 ${
            creating
              ? "bg-accent-wash text-accent"
              : "text-text-subtle hover:bg-surface-hover hover:text-text"
          }`}
        >
          <Plus size={14} strokeWidth={1.5} />
        </button>
        <button
          onClick={() => toggleCollapsed("keyList")}
          title="Collapse panel"
          className="shrink-0 rounded p-1 text-text-subtle hover:bg-surface-hover hover:text-text"
        >
          <PanelLeftClose size={14} strokeWidth={1.5} />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
      {keys === undefined && (
        <p className="p-4 text-text-subtle">Loading keys…</p>
      )}
      {!filtering && keys?.length === 0 && (
        <p className="p-4 text-text-subtle">No keys in this instance.</p>
      )}
      {filtering && searching && !searchResults && (
        <p className="p-4 text-text-subtle">Searching on device…</p>
      )}
      {filtering && searchResults?.length === 0 && !searching && (
        <p className="p-4 text-text-subtle">No keys found for "{keyFilter}".</p>
      )}
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
      {virtualItems.map((virtualItem) => {
        const entry = filtered?.[virtualItem.index];
        if (!entry) return null;
        const active = entry.key === selectedKey;
        const menuOpen = openMenu === entry.key;
        const changeStamp =
          recentChanges[`${keysId(selection.providerId, selection.instanceId)} ${entry.key}`];
        const flash = changeStamp && Date.now() - changeStamp < 950;
        const activityHighlighted = focusedKey === entry.key;
        return (
          <div
            key={`${entry.key}-${changeStamp ?? 0}-${activityHighlighted ? activityFocus?.token : 0}`}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              zIndex: menuOpen ? 40 : 0,
              transform: `translateY(${virtualItem.start}px)`,
            }}
            className={`group flex h-8 w-full shrink-0 items-center border-l-2 ${
              active
                ? "border-accent bg-accent-wash"
                : "border-transparent hover:bg-surface-hover"
            } ${activityHighlighted ? "rnsi-activity-focus" : flash ? "rnsi-flash" : ""}`}
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
              data-open={menuOpen}
              title="Actions"
            >
              <MoreHorizontal size={14} strokeWidth={1.5} />
            </button>
            {menuOpen && (
              <div className="absolute right-1 top-7 z-50 w-48 overflow-hidden rounded-md border border-border-strong bg-surface-raised py-1 text-[12px] shadow-xl shadow-black/15">
                <button
                  onClick={() => {
                    copyText(entry.key);
                    setOpenMenu(null);
                  }}
                  className="flex h-8 w-full items-center gap-2 px-2.5 text-left text-text-muted hover:bg-surface-hover hover:text-text"
                >
                  <Copy size={13} strokeWidth={1.5} />
                  Copy name
                </button>
                <button
                  onClick={() => void copySchema(entry.key)}
                  className="flex h-8 w-full items-center gap-2 px-2.5 text-left text-text-muted hover:bg-surface-hover hover:text-text"
                >
                  <Copy size={13} strokeWidth={1.5} />
                  Copy schema
                </button>
                <button
                  onClick={() => void duplicateEntry(entry.key)}
                  className="flex h-8 w-full items-center gap-2 px-2.5 text-left text-text-muted hover:bg-surface-hover hover:text-text"
                >
                  <Files size={13} strokeWidth={1.5} />
                  Duplicate
                </button>
                <button
                  onClick={() => {
                    setOpenMenu(null);
                    setDeleteCandidate(entry.key);
                  }}
                  className="flex h-8 w-full items-center gap-2 px-2.5 text-left text-deleted hover:bg-deleted-wash"
                >
                  <Trash2 size={13} strokeWidth={1.5} />
                  Delete
                </button>
              </div>
            )}
          </div>
        );
      })}
      </div>
      {filtering ? (
        (searching || searchResults) && (
          <div className="border-t border-border p-2 text-[11px] text-text-subtle">
            {searching
              ? "Searching on device…"
              : `${searchResults?.length ?? 0} result${
                  (searchResults?.length ?? 0) === 1 ? "" : "s"
                } on device${
                  searchInfo && !searchInfo.complete
                    ? ` · partial scan (${searchInfo.scanned.toLocaleString()} read)`
                    : ""
                }`}
          </div>
        )
      ) : (
        keysMeta?.nextAfterKey && (
          <div className="border-t border-border p-2">
            <button
              disabled={loadingMore}
              onClick={loadMore}
              className="h-7 w-full rounded-md border border-border text-[12px] text-text-muted hover:bg-surface-hover hover:text-text disabled:opacity-50"
            >
              {loadingMore
                ? "Loading…"
                : `Load more (${keys?.length ?? 0} of ${keysMeta.total})`}
            </button>
          </div>
        )
      )}
      </div>
      {deleteCandidate && (
        <ConfirmDialog
          title="Delete key?"
          description="This permanently removes this value from the connected app."
          loading={deleting}
          onCancel={() => setDeleteCandidate(null)}
          onConfirm={() => void deleteEntry(deleteCandidate)}
          detail={
            <code className="block truncate rounded-md border border-border bg-surface-sunken px-2.5 py-2 font-mono text-[12px] text-text">
              {deleteCandidate}
            </code>
          }
        />
      )}
      <ResizeHandle panelId="keyList" edge="right" />
    </div>
  );
}
