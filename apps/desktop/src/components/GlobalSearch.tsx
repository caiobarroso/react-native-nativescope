import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Database, KeyRound, Search } from "lucide-react";
import type { KeyEntry, ProviderDescriptor, TableSchema } from "@rnsi/protocol";
import { useStudio } from "../lib/store.ts";
import { loadKeys, loadTables, fetchAllKeys, fetchAllTables } from "../lib/studio-client.ts";

interface SearchHit {
  kind: "key" | "table";
  providerId: string;
  providerLabel: string;
  instanceId: string;
  /** nome da chave ou da tabela */
  name: string;
  preview: string;
}

/**
 * Busca global ⌘K — cross-storage (plano §5.2). Responde "onde diabos está
 * guardado esse valor?": varre chaves de todos os providers key-value e
 * tabelas de todos os bancos, simultaneamente, num campo só.
 */
export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(false);
  const providers = useStudio((s) => s.providers);
  const indexRef = useRef<SearchHit[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ⌘K abre; Esc fecha.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Ao abrir: monta o índice varrendo tudo (datasets de dev são pequenos).
  useEffect(() => {
    if (!open) {
      setQuery("");
      setCursor(0);
      indexRef.current = null;
      return;
    }
    inputRef.current?.focus();
    let cancelled = false;
    setLoading(true);
    void buildIndex(providers).then((index) => {
      if (cancelled) return;
      indexRef.current = index;
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, providers]);

  useEffect(() => {
    const index = indexRef.current;
    if (!index || query.trim() === "") {
      setHits([]);
      return;
    }
    const q = query.toLowerCase();
    setHits(
      index
        .filter(
          (hit) =>
            hit.name.toLowerCase().includes(q) || hit.preview.toLowerCase().includes(q),
        )
        .slice(0, 30),
    );
    setCursor(0);
  }, [query, loading]);

  const navigate = useCallback((hit: SearchHit) => {
    const store = useStudio.getState();
    store.select({ providerId: hit.providerId, instanceId: hit.instanceId });
    if (hit.kind === "key") {
      void loadKeys(hit.providerId, hit.instanceId).then(() => {
        useStudio.getState().selectKey(hit.name);
      });
    } else {
      void loadTables(hit.providerId, hit.instanceId).then(() => {
        useStudio.getState().selectTable(hit.name);
      });
    }
    setOpen(false);
  }, []);

  const grouped = useMemo(() => hits, [hits]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-24"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-[560px] overflow-hidden rounded-lg border border-border bg-surface-raised shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search size={14} strokeWidth={1.5} className="text-text-subtle" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, grouped.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === "Enter" && grouped[cursor]) {
                navigate(grouped[cursor]);
              }
            }}
            placeholder="Buscar em todos os storages…"
            className="h-11 flex-1 bg-transparent text-[13px] outline-none placeholder:text-text-subtle"
          />
          {loading && <span className="text-[11px] text-text-subtle">indexando…</span>}
        </div>

        <ol className="max-h-80 overflow-y-auto p-1">
          {query.trim() !== "" && !loading && grouped.length === 0 && (
            <li className="px-3 py-4 text-[12px] text-text-subtle">
              Nada encontrado em nenhum storage.
            </li>
          )}
          {grouped.map((hit, i) => (
            <li key={`${hit.providerId}-${hit.instanceId}-${hit.kind}-${hit.name}`}>
              <button
                onClick={() => navigate(hit)}
                onMouseEnter={() => setCursor(i)}
                className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left ${
                  i === cursor ? "bg-accent-wash" : ""
                }`}
              >
                {hit.kind === "table" ? (
                  <Database size={13} strokeWidth={1.5} className="shrink-0 text-text-subtle" />
                ) : (
                  <KeyRound size={13} strokeWidth={1.5} className="shrink-0 text-text-subtle" />
                )}
                <span className="shrink-0 font-mono text-[12px]">{hit.name}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-subtle">
                  {hit.preview}
                </span>
                <span className="shrink-0 text-[10px] text-text-muted">
                  {hit.providerLabel} · {hit.instanceId}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

async function buildIndex(providers: ProviderDescriptor[]): Promise<SearchHit[]> {
  const jobs: Array<Promise<SearchHit[]>> = [];

  for (const provider of providers) {
    for (const instance of provider.instances) {
      if (provider.capabilities.includes("key-value.read")) {
        jobs.push(
          fetchAllKeys(provider.providerId, instance.instanceId).then(({ entries }) =>
            entries.map((entry: KeyEntry) => ({
              kind: "key" as const,
              providerId: provider.providerId,
              providerLabel: provider.label,
              instanceId: instance.instanceId,
              name: entry.key,
              preview: entry.preview,
            })),
          ),
        );
      }
      if (provider.capabilities.includes("database.query")) {
        jobs.push(
          fetchAllTables(provider.providerId, instance.instanceId).then(
            (tables: TableSchema[]) =>
              tables.map((table) => ({
                kind: "table" as const,
                providerId: provider.providerId,
                providerLabel: provider.label,
                instanceId: instance.instanceId,
                name: table.name,
                preview: `${table.rowCount} linhas · ${table.columns.map((c) => c.name).join(", ")}`,
              })),
          ),
        );
      }
    }
  }

  const settled = await Promise.allSettled(jobs);
  return settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}
