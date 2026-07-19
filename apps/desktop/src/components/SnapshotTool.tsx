import { useMemo, useState } from "react";
import {
  Camera,
  Database,
  GitCompare,
  KeyRound,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import { useStudio } from "../lib/store.ts";
import {
  SQLITE_SNAPSHOT_ROW_LIMIT,
  captureSnapshot,
  cellPreview,
  diffSnapshots,
  restoreKeyDiff,
  snapshotLabel,
  snapshotStats,
  valuePreview,
  type KeyValueDiff,
  type SnapshotDiff,
  type StorageSnapshot,
} from "../lib/snapshots.ts";
import { loadKeys } from "../lib/studio-client.ts";

const CHANGE_LABEL = {
  created: "criado",
  updated: "alterado",
  removed: "removido",
} as const;

const CHANGE_CLASS = {
  created: "text-created",
  updated: "text-updated",
  removed: "text-deleted",
} as const;

export function SnapshotTool() {
  const providers = useStudio((s) => s.providers);
  const [open, setOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<StorageSnapshot[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [diff, setDiff] = useState<SnapshotDiff | null>(null);
  const [busy, setBusy] = useState<"capture" | "compare" | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [restoreKey, setRestoreKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = snapshots.find((snapshot) => snapshot.id === selectedId) ?? snapshots[0] ?? null;
  const summary = useMemo(() => {
    if (!diff) return null;
    const keyCreated = diff.keyDiffs.filter((item) => item.change === "created").length;
    const keyUpdated = diff.keyDiffs.filter((item) => item.change === "updated").length;
    const keyRemoved = diff.keyDiffs.filter((item) => item.change === "removed").length;
    const rowAdded = diff.tableDiffs.reduce((sum, table) => sum + table.added.length, 0);
    const rowUpdated = diff.tableDiffs.reduce((sum, table) => sum + table.updated.length, 0);
    const rowRemoved = diff.tableDiffs.reduce((sum, table) => sum + table.removed.length, 0);
    return { keyCreated, keyUpdated, keyRemoved, rowAdded, rowUpdated, rowRemoved };
  }, [diff]);

  async function capture(): Promise<void> {
    setBusy("capture");
    setError(null);
    setProgress("preparando...");
    try {
      const snapshot = await captureSnapshot(providers, setProgress);
      setSnapshots((current) => [snapshot, ...current].slice(0, 12));
      setSelectedId(snapshot.id);
      setDiff(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  async function compare(): Promise<void> {
    if (!selected) return;
    setBusy("compare");
    setError(null);
    setProgress("capturando estado atual...");
    try {
      const current = await captureSnapshot(providers, setProgress);
      setDiff(diffSnapshots(selected, current));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  async function restore(diffItem: KeyValueDiff): Promise<void> {
    const id = `${diffItem.providerId}-${diffItem.instanceId}-${diffItem.key}`;
    setRestoreKey(id);
    setError(null);
    try {
      await restoreKeyDiff(diffItem);
      await loadKeys(diffItem.providerId, diffItem.instanceId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRestoreKey(null);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Snapshots e diff"
        className="flex items-center gap-1.5 rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-[12px] text-text-muted hover:bg-surface-hover hover:text-text"
      >
        <Camera size={13} strokeWidth={1.5} />
        Snapshots
        {snapshots.length > 0 && (
          <span className="rounded bg-accent-wash px-1.5 py-px text-[10px] text-accent">
            {snapshots.length}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 px-4 pt-16"
          onClick={() => setOpen(false)}
        >
          <section
            className="flex max-h-[82vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-border bg-surface-raised shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
              <Camera size={15} strokeWidth={1.5} className="text-text-subtle" />
              <div className="min-w-0">
                <h2 className="text-[13px] font-semibold">Snapshots + Diff</h2>
                <p className="text-[11px] text-text-subtle">
                  Compare o estado do storage antes e depois de uma ação no app.
                </p>
              </div>
              <button
                onClick={() => void capture()}
                disabled={busy !== null || providers.length === 0}
                className="ml-auto rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {busy === "capture" ? "Capturando..." : "Capturar"}
              </button>
              <button
                onClick={() => void compare()}
                disabled={busy !== null || !selected}
                className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] text-text-muted hover:bg-surface-hover disabled:opacity-50"
              >
                <GitCompare size={13} strokeWidth={1.5} />
                Comparar atual
              </button>
              <button
                onClick={() => setOpen(false)}
                className="rounded p-1 text-text-subtle hover:bg-surface-hover hover:text-text"
                title="Fechar"
              >
                <X size={15} strokeWidth={1.5} />
              </button>
            </header>

            {(progress || error) && (
              <div className="shrink-0 border-b border-border px-4 py-2 text-[12px]">
                {progress && <span className="text-text-muted">{progress}</span>}
                {error && <span className="text-deleted">{error}</span>}
              </div>
            )}

            <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr]">
              <aside className="min-h-0 border-r border-border bg-surface-sunken">
                <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                  Capturas
                </div>
                <ol className="max-h-full overflow-y-auto p-2">
                  {snapshots.length === 0 && (
                    <li className="rounded-md border border-border bg-surface px-3 py-3 text-[12px] text-text-subtle">
                      Capture um snapshot, mexa no app, depois compare com o estado atual.
                    </li>
                  )}
                  {snapshots.map((snapshot) => {
                    const stats = snapshotStats(snapshot);
                    const active = selected?.id === snapshot.id;
                    return (
                      <li key={snapshot.id} className="mb-2">
                        <button
                          onClick={() => {
                            setSelectedId(snapshot.id);
                            setDiff(null);
                          }}
                          className={`w-full rounded-md border px-3 py-2 text-left ${
                            active
                              ? "border-accent bg-accent-wash"
                              : "border-border bg-surface hover:bg-surface-hover"
                          }`}
                        >
                          <div className="mb-1 flex items-center gap-2">
                            <span className="font-mono text-[12px]">{snapshotLabel(snapshot)}</span>
                            {stats.errors > 0 && (
                              <ShieldAlert size={12} strokeWidth={1.5} className="ml-auto text-deleted" />
                            )}
                          </div>
                          <p className="text-[11px] text-text-subtle">
                            {stats.keys} chaves · {stats.tables} tabelas · {stats.rows} rows
                          </p>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </aside>

              <main className="min-h-0 overflow-y-auto p-4">
                {!selected && (
                  <div className="flex h-64 items-center justify-center text-text-subtle">
                    Nenhum snapshot capturado ainda.
                  </div>
                )}

                {selected && !diff && (
                  <div className="rounded-md border border-border bg-surface-sunken p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <Sparkles size={14} strokeWidth={1.5} className="text-accent" />
                      <span className="font-semibold">Snapshot selecionado</span>
                    </div>
                    <p className="text-[12px] text-text-muted">
                      Snapshot de {new Date(selected.timestamp).toLocaleString("pt-BR")}. Clique em
                      "Comparar atual" para capturar o estado de agora e ver o diff.
                    </p>
                    <p className="mt-2 text-[11px] text-text-subtle">
                      SQLite captura até {SQLITE_SNAPSHOT_ROW_LIMIT} rows por tabela para manter a UI responsiva.
                    </p>
                  </div>
                )}

                {diff && summary && (
                  <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-6 gap-2">
                      <Metric label="chaves +" value={summary.keyCreated} tone="created" />
                      <Metric label="chaves ~" value={summary.keyUpdated} tone="updated" />
                      <Metric label="chaves -" value={summary.keyRemoved} tone="removed" />
                      <Metric label="rows +" value={summary.rowAdded} tone="created" />
                      <Metric label="rows ~" value={summary.rowUpdated} tone="updated" />
                      <Metric label="rows -" value={summary.rowRemoved} tone="removed" />
                    </div>

                    {diff.errors.length > 0 && (
                      <div className="rounded-md border border-deleted/30 bg-deleted-wash px-3 py-2 text-[12px] text-deleted">
                        {diff.errors.slice(0, 4).map((item) => (
                          <p key={item}>{item}</p>
                        ))}
                      </div>
                    )}

                    {diff.keyDiffs.length === 0 && diff.tableDiffs.length === 0 && (
                      <div className="rounded-md border border-border bg-surface-sunken p-4 text-[12px] text-text-muted">
                        Nada mudou entre o snapshot e o estado atual.
                      </div>
                    )}

                    {diff.keyDiffs.length > 0 && (
                      <section className="rounded-md border border-border">
                        <SectionTitle icon="key" title="Key-value" count={diff.keyDiffs.length} />
                        <ol>
                          {diff.keyDiffs.map((item) => {
                            const restoreId = `${item.providerId}-${item.instanceId}-${item.key}`;
                            return (
                              <li
                                key={restoreId}
                                className="grid grid-cols-[1fr_auto] gap-3 border-t border-border px-3 py-2"
                              >
                                <div className="min-w-0">
                                  <div className="mb-1 flex items-center gap-2">
                                    <span className={`text-[11px] font-semibold ${CHANGE_CLASS[item.change]}`}>
                                      {CHANGE_LABEL[item.change]}
                                    </span>
                                    <span className="font-mono text-[12px]">{item.key}</span>
                                    <span className="ml-auto text-[10px] text-text-subtle">
                                      {item.providerLabel} · {item.instanceLabel}
                                    </span>
                                  </div>
                                  <p className="truncate font-mono text-[11px] text-text-subtle">
                                    antes: {valuePreview(item.before)}
                                  </p>
                                  <p className="truncate font-mono text-[11px] text-text-muted">
                                    depois: {valuePreview(item.after)}
                                  </p>
                                </div>
                                <button
                                  onClick={() => void restore(item)}
                                  disabled={restoreKey === restoreId}
                                  className="self-center rounded-md border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-surface-hover disabled:opacity-50"
                                  title="Restaurar valor do snapshot"
                                >
                                  <RotateCcw size={12} strokeWidth={1.5} />
                                </button>
                              </li>
                            );
                          })}
                        </ol>
                      </section>
                    )}

                    {diff.tableDiffs.length > 0 && (
                      <section className="rounded-md border border-border">
                        <SectionTitle icon="database" title="SQLite" count={diff.tableDiffs.length} />
                        <ol>
                          {diff.tableDiffs.map((table) => (
                            <li
                              key={`${table.providerId}-${table.instanceId}-${table.table}`}
                              className="border-t border-border px-3 py-2"
                            >
                              <div className="mb-1 flex items-center gap-2">
                                <span className="font-mono text-[12px]">{table.table}</span>
                                <span className="text-[10px] text-text-subtle">
                                  {table.providerLabel} · {table.instanceLabel}
                                </span>
                                <span className="ml-auto font-mono text-[11px] text-text-subtle">
                                  {table.beforeTotal} → {table.afterTotal}
                                </span>
                              </div>
                              <p className="text-[11px] text-text-muted">
                                <span className="text-created">+{table.added.length}</span>{" "}
                                <span className="text-updated">~{table.updated.length}</span>{" "}
                                <span className="text-deleted">-{table.removed.length}</span>
                                {table.truncated && (
                                  <span className="ml-2 text-text-subtle">
                                    diff limitado às primeiras {SQLITE_SNAPSHOT_ROW_LIMIT} rows
                                  </span>
                                )}
                              </p>
                              {[...table.added.slice(0, 2), ...table.removed.slice(0, 2)].map((row) => (
                                <p key={row.identity} className="mt-1 truncate font-mono text-[11px] text-text-subtle">
                                  {cellPreview(row.cells)}
                                </p>
                              ))}
                            </li>
                          ))}
                        </ol>
                      </section>
                    )}
                  </div>
                )}
              </main>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "created" | "updated" | "removed";
}) {
  const color =
    tone === "created" ? "text-created" : tone === "removed" ? "text-deleted" : "text-updated";
  return (
    <div className="rounded-md border border-border bg-surface-sunken px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-text-subtle">{label}</p>
      <p className={`font-mono text-[18px] font-semibold ${color}`}>{value}</p>
    </div>
  );
}

function SectionTitle({
  icon,
  title,
  count,
}: {
  icon: "key" | "database";
  title: string;
  count: number;
}) {
  return (
    <div className="flex h-9 items-center gap-2 px-3">
      {icon === "key" ? (
        <KeyRound size={13} strokeWidth={1.5} className="text-text-subtle" />
      ) : (
        <Database size={13} strokeWidth={1.5} className="text-text-subtle" />
      )}
      <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        {title}
      </span>
      <span className="text-[11px] text-text-subtle">{count}</span>
    </div>
  );
}
