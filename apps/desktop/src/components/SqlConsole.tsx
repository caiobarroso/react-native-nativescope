import { useState } from "react";
import { ChevronDown, ChevronUp, Play } from "lucide-react";
import type { ExecuteResult } from "@rnsi/protocol";
import { useStudio } from "../lib/store.ts";
import { executeSql } from "../lib/studio-client.ts";

/**
 * Console SQL — recurso avançado, colapsado por padrão (plano §5.2).
 * SELECTs ganham LIMIT implícito no adapter; mutações exigem segundo
 * clique de confirmação.
 */
export function SqlConsole() {
  const selection = useStudio((s) => s.selection);
  const [open, setOpen] = useState(false);
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<ExecuteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);

  if (!selection) return null;

  const isMutation = !/^\s*(select|pragma|with|explain)\b/i.test(sql) && sql.trim() !== "";

  async function run(): Promise<void> {
    if (!selection || sql.trim() === "") return;
    if (isMutation && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setRunning(true);
    setError(null);
    try {
      setResult(await executeSql(selection.providerId, selection.instanceId, sql));
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="shrink-0 border-t border-border">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-full items-center gap-2 px-3 text-[11px] font-semibold uppercase tracking-wide text-text-muted hover:bg-surface-hover"
      >
        SQL
        <span className="ml-auto">
          {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-2 border-t border-border p-3">
          <div className="flex items-start gap-2">
            <textarea
              value={sql}
              onChange={(e) => {
                setSql(e.target.value);
                setConfirming(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void run();
              }}
              spellCheck={false}
              rows={2}
              placeholder="SELECT * FROM visits WHERE status = 'pending';   (⌘↵ executa)"
              className="min-h-16 flex-1 resize-y rounded-md border border-border bg-surface-raised p-2 font-mono text-[12px] placeholder:text-text-subtle"
            />
            <button
              onClick={() => void run()}
              disabled={running || sql.trim() === ""}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50 ${
                confirming ? "bg-deleted" : "bg-accent hover:bg-accent-hover"
              }`}
            >
              <Play size={12} strokeWidth={2} />
              {confirming ? "Confirmar mutação" : running ? "Executando…" : "Executar"}
            </button>
          </div>

          {error && <p className="text-[12px] text-deleted">{error}</p>}

          {result?.kind === "mutation" && (
            <p className="text-[12px] text-text-muted">
              OK — {result.rowsAffected} linha(s) afetada(s).
            </p>
          )}

          {result?.kind === "rows" && (
            <div className="max-h-48 overflow-auto rounded-md border border-border">
              <table className="w-full border-collapse font-mono text-[11px]">
                <thead className="sticky top-0 bg-surface-sunken">
                  <tr>
                    {result.columns.map((column) => (
                      <th key={column} className="px-2 py-1 text-left font-semibold">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i} className="border-t border-border">
                      {result.columns.map((column) => {
                        const value = row[column] ?? null;
                        return (
                          <td key={column} className="max-w-48 truncate px-2 py-1">
                            {value === null ? (
                              <span className="text-text-subtle">NULL</span>
                            ) : typeof value === "object" ? (
                              "(blob)"
                            ) : (
                              String(value)
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.rows.length === 0 && (
                <p className="p-2 text-[11px] text-text-subtle">0 linhas.</p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
