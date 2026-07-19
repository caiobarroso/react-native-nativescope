import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Database, KeyRound, Search } from "lucide-react";
import type { ProviderDescriptor } from "@rnsi/protocol";
import { useStudio } from "../lib/store.ts";
import {
  loadKeys,
  loadTables,
  fetchAllTables,
  searchDatabase,
  searchKeys,
} from "../lib/studio-client.ts";

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
 * guardado esse valor?". A busca roda NO DEVICE (plano de grandes volumes
 * §D): chaves via varredura paginada de previews, linhas SQLite via LIKE —
 * buscar em GB não transfere GB, só os matches viajam.
 */
export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(false);
  const providers = useStudio((s) => s.providers);
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

  useEffect(() => {
    if (!open) {
      setQuery("");
      setCursor(0);
      setHits([]);
      return;
    }
    inputRef.current?.focus();
  }, [open]);

  // Cada consulta roda no device, com debounce — nada de índice local.
  useEffect(() => {
    if (!open || query.trim() === "") {
      setHits([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      void searchEverywhere(providers, query.trim()).then((results) => {
        if (cancelled) return;
        setHits(results.slice(0, 30));
        setCursor(0);
        setLoading(false);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query, providers]);

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
          {loading && <span className="text-[11px] text-text-subtle">buscando no device…</span>}
        </div>

        <ol className="max-h-80 overflow-y-auto p-1">
          {query.trim() !== "" && !loading && grouped.length === 0 && (
            <li className="px-3 py-4 text-[12px] text-text-subtle">
              Nada encontrado em nenhum storage.
            </li>
          )}
          {grouped.map((hit, i) => (
            <li key={`${hit.providerId}-${hit.instanceId}-${hit.kind}-${hit.name}-${i}`}>
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

async function searchEverywhere(
  providers: ProviderDescriptor[],
  query: string,
): Promise<SearchHit[]> {
  const q = query.toLowerCase();
  const jobs: Array<Promise<SearchHit[]>> = [];

  for (const provider of providers) {
    for (const instance of provider.instances) {
      if (provider.capabilities.includes("key-value.read")) {
        jobs.push(
          searchKeys(provider.providerId, instance.instanceId, query, 30).then(({ entries }) =>
            entries.map((entry) => ({
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
        // Nomes de tabela (barato) + conteúdo de linhas via LIKE no device.
        jobs.push(
          fetchAllTables(provider.providerId, instance.instanceId).then((tables) =>
            tables
              .filter((table) => table.name.toLowerCase().includes(q))
              .map((table) => ({
                kind: "table" as const,
                providerId: provider.providerId,
                providerLabel: provider.label,
                instanceId: instance.instanceId,
                name: table.name,
                preview: `${table.rowCountIsEstimate ? "~" : ""}${table.rowCount} linhas · ${table.columns.map((c) => c.name).join(", ")}`,
              })),
          ),
        );
        jobs.push(
          searchDatabase(provider.providerId, instance.instanceId, query, 20).then(
            ({ matches }) =>
              matches.map((match) => ({
                kind: "table" as const,
                providerId: provider.providerId,
                providerLabel: provider.label,
                instanceId: instance.instanceId,
                name: match.table,
                preview: match.snippet,
              })),
          ),
        );
      }
    }
  }

  const settled = await Promise.allSettled(jobs);
  return settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}
