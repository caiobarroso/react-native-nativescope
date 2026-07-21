import { useMemo, useState } from "react";
import {
  Camera,
  Database,
  GitCompare,
  KeyRound,
  PlayCircle,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Trash2,
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
  type CaptureScope,
  type KeyValueDiff,
  type SnapshotDiff,
  type StorageSnapshot,
} from "../lib/snapshots.ts";
import { loadKeys } from "../lib/studio-client.ts";
import { SnapshotStory } from "./SnapshotStory.tsx";
import { SnapshotScopePicker } from "./SnapshotScopePicker.tsx";

const CHANGE_LABEL = {
  created: "created",
  updated: "updated",
  removed: "removed",
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
  const [scope, setScope] = useState<CaptureScope | null>(null);
  const [showStory, setShowStory] = useState(false);

  const selected = snapshots.find((snapshot) => snapshot.id === selectedId) ?? snapshots[0] ?? null;
  const storyView = showStory || !selected;
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
    setShowStory(false);
    setProgress("preparing...");
    try {
      const snapshot = await captureSnapshot(providers, setProgress, scope);
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

  function deleteSnapshot(id: string): void {
    setSnapshots((current) => current.filter((snapshot) => snapshot.id !== id));
    if (selectedId === id) {
      setSelectedId(null);
      setDiff(null);
    }
  }

  async function compare(): Promise<void> {
    if (!selected) return;
    setBusy("compare");
    setError(null);
    setShowStory(false);
    setProgress("capturing current state...");
    try {
      // Recaptura com o MESMO recorte do baseline — senão o diff acusaria como
      // "removido" tudo que ficou de fora de um dos lados.
      const current = await captureSnapshot(providers, setProgress, selected.scope);
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
        title="Snapshots and diff"
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
            className="flex max-h-[86vh] min-h-[560px] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-border bg-surface-raised shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
              <Camera size={15} strokeWidth={1.5} className="text-text-subtle" />
              <div className="min-w-0">
                <h2 className="text-[13px] font-semibold">Snapshots + Diff</h2>
                <p className="text-[11px] text-text-subtle">
                  Freeze storage, act in your app, see exactly what changed — undo any of it.
                </p>
              </div>

              <div className="ml-auto flex items-center gap-2">
                {snapshots.length > 0 && (
                  <button
                    onClick={() => setShowStory((v) => !v)}
                    className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] ${
                      showStory ? "text-accent" : "text-text-subtle hover:text-text"
                    }`}
                    title="How snapshots work"
                  >
                    <PlayCircle size={13} strokeWidth={1.5} />
                    How it works
                  </button>
                )}

                <SnapshotScopePicker
                  providers={providers}
                  value={scope}
                  onChange={setScope}
                  disabled={busy !== null || providers.length === 0}
                />

                {selected ? (
                  <>
                    <button
                      onClick={() => void compare()}
                      disabled={busy !== null}
                      className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                    >
                      <GitCompare size={13} strokeWidth={1.5} />
                      {busy === "compare" ? "Comparing..." : "Compare with now"}
                    </button>
                    <button
                      onClick={() => void capture()}
                      disabled={busy !== null}
                      className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] text-text-muted hover:bg-surface-hover disabled:opacity-50"
                      title="Capture a fresh baseline"
                    >
                      <Camera size={13} strokeWidth={1.5} />
                      {busy === "capture" ? "Capturing..." : "Recapture"}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => void capture()}
                    disabled={busy !== null || providers.length === 0}
                    className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                  >
                    <Camera size={13} strokeWidth={1.5} />
                    {busy === "capture" ? "Capturing..." : "Capture baseline"}
                  </button>
                )}
              </div>

              <button
                onClick={() => setOpen(false)}
                className="rounded p-1 text-text-subtle hover:bg-surface-hover hover:text-text"
                title="Close"
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
                  Captures
                </div>
                <ol className="max-h-full overflow-y-auto p-2">
                  {snapshots.length === 0 && (
                    <li className="rounded-md border border-border bg-surface px-3 py-3 text-[12px] text-text-subtle">
                      Capture a snapshot, interact with the app, then compare it with the current state.
                    </li>
                  )}
                  {snapshots.map((snapshot) => {
                    const stats = snapshotStats(snapshot);
                    const active = selected?.id === snapshot.id;
                    return (
                      <li key={snapshot.id} className="group relative mb-2">
                        <button
                          onClick={() => {
                            setSelectedId(snapshot.id);
                            setDiff(null);
                            setShowStory(false);
                          }}
                          className={`w-full rounded-md border px-3 py-2 text-left ${
                            active
                              ? "border-accent bg-accent-wash"
                              : "border-border bg-surface hover:bg-surface-hover"
                          }`}
                        >
                          <div className="mb-1 flex items-center gap-2 pr-6">
                            <span className="font-mono text-[12px]">{snapshotLabel(snapshot)}</span>
                            {snapshot.scope && (
                              <span className="rounded bg-accent-wash px-1.5 py-px text-[9px] font-medium uppercase tracking-wide text-accent">
                                scoped
                              </span>
                            )}
                            {stats.errors > 0 && (
                              <ShieldAlert size={12} strokeWidth={1.5} className="ml-auto text-deleted" />
                            )}
                          </div>
                          <p className="text-[11px] text-text-subtle">
                            {stats.keys} keys · {stats.tables} tables · {stats.rows} rows
                          </p>
                        </button>
                        <button
                          onClick={() => deleteSnapshot(snapshot.id)}
                          className="absolute right-1.5 top-1.5 rounded p-1 text-text-subtle opacity-0 transition hover:bg-surface-hover hover:text-deleted focus-visible:opacity-100 group-hover:opacity-100"
                          title="Delete this capture"
                        >
                          <Trash2 size={12} strokeWidth={1.5} />
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </aside>

              <main className="min-h-0 overflow-y-auto p-4">
                {storyView && (
                  <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-center gap-6">
                    <div>
                      <h3 className="text-[15px] font-semibold">
                        See exactly what an action writes to storage
                      </h3>
                      <p className="mt-1.5 max-w-xl text-[12px] leading-relaxed text-text-muted">
                        Freeze a baseline, do <em>one</em> thing in your app — a login, a purchase, a
                        sync — then compare. Every created, updated and removed key or row is laid
                        out side by side, and you can undo any of them.
                      </p>
                    </div>

                    <SnapshotStory />

                    {!selected ? (
                      <p className="text-[12px] text-text-subtle">
                        Hit <b className="text-text-muted">Capture baseline</b> above to start — or
                        narrow the scope to a single table first.
                      </p>
                    ) : (
                      <button
                        onClick={() => setShowStory(false)}
                        className="self-start rounded-md border border-border px-3 py-1.5 text-[12px] text-text-muted hover:bg-surface-hover"
                      >
                        Back to snapshot
                      </button>
                    )}
                  </div>
                )}

                {!storyView && selected && !diff && (
                  <div className="rounded-md border border-border bg-surface-sunken p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <Sparkles size={14} strokeWidth={1.5} className="text-accent" />
                      <span className="font-semibold">Baseline ready</span>
                    </div>
                    <p className="text-[12px] text-text-muted">
                      Captured {new Date(selected.timestamp).toLocaleString("en-US")}. Go act in your
                      app, then hit <b className="text-text">Compare with now</b> to see the diff.
                    </p>
                    <p className="mt-2 text-[11px] text-text-subtle">
                      {selected.scope
                        ? "Scoped capture — the comparison uses this same selection."
                        : "Full-storage capture."}{" "}
                      SQLite captures up to {SQLITE_SNAPSHOT_ROW_LIMIT} rows per table to keep the UI responsive.
                    </p>
                  </div>
                )}

                {!storyView && diff && summary && (
                  <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-6 gap-2">
                      <Metric label="keys +" value={summary.keyCreated} tone="created" />
                      <Metric label="keys ~" value={summary.keyUpdated} tone="updated" />
                      <Metric label="keys -" value={summary.keyRemoved} tone="removed" />
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
                        Nothing changed between the snapshot and the current state.
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
                                    before: {valuePreview(item.before)}
                                  </p>
                                  <p className="truncate font-mono text-[11px] text-text-muted">
                                    after: {valuePreview(item.after)}
                                  </p>
                                </div>
                                <button
                                  onClick={() => void restore(item)}
                                  disabled={restoreKey === restoreId}
                                  className="self-center rounded-md border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-surface-hover disabled:opacity-50"
                                  title="Restore snapshot value"
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
                                    diff limited to the first {SQLITE_SNAPSHOT_ROW_LIMIT} rows
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
