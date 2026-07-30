import { useCallback, useMemo, useState } from "react";
import { Binary, Check, Copy, X } from "lucide-react";
import {
  blobByteLength,
  decodeBase64,
  formatBlobSize,
  hexDump,
  type BlobCell,
} from "../lib/cell-format.ts";

/**
 * Visualizador de BLOB — SOMENTE LEITURA, e isso é a razão de existir.
 *
 * A alternativa que havia antes era despejar o base64 num <input> de texto, o
 * que transformava "ver os bytes" em "gravar base64 como TEXT em cima do BLOB".
 * Aqui não há caminho de escrita: dá para inspecionar e copiar, nada mais.
 */

/** Quantos bytes o dump renderiza. 4 KB = 256 linhas — além disso o DOM é o gargalo. */
const RENDER_BYTE_LIMIT = 4 * 1024;

export function BlobCellModal({
  table,
  column,
  cell,
  truncated,
  loading,
  error,
  onLoadFull,
  onClose,
}: {
  table: string;
  column: string;
  /** O que está em mão: preview da listagem, ou o conteúdo completo já carregado. */
  cell: BlobCell;
  /** true enquanto o base64 em mão é só o preview. */
  truncated: boolean;
  loading: boolean;
  error: string | null;
  onLoadFull: () => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const totalBytes = blobByteLength(cell);
  const bytes = useMemo(() => decodeBase64(cell.blobBase64), [cell.blobBase64]);
  const rendered = useMemo(
    () => hexDump(bytes.subarray(0, RENDER_BYTE_LIMIT)),
    [bytes],
  );

  const copy = useCallback(() => {
    void navigator.clipboard.writeText(cell.blobBase64).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }, [cell.blobBase64]);

  const inHand = bytes.length;
  const clipped = inHand > RENDER_BYTE_LIMIT;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 px-4 pt-12"
      onClick={onClose}
    >
      <section
        className="flex h-[min(82vh,840px)] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-surface-raised shadow-xl shadow-black/15"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
          <Binary size={15} strokeWidth={1.5} className="text-accent" />
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-semibold">
              BLOB · {formatBlobSize(totalBytes)}
            </h2>
            <p className="truncate font-mono text-[11px] text-text-subtle">
              {table}.{column}
            </p>
          </div>
          <span className="ml-auto rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-subtle">
            read-only
          </span>
          <button
            onClick={onClose}
            className="rounded p-1 text-text-subtle hover:bg-surface-hover hover:text-text"
            title="Close"
          >
            <X size={15} strokeWidth={1.5} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto bg-surface-sunken p-4">
          {rendered.length === 0 ? (
            <p className="text-[12px] text-text-muted">This BLOB is empty (0 bytes).</p>
          ) : (
            <table className="font-mono text-[11px] leading-5">
              <tbody>
                {rendered.map((row) => (
                  <tr key={row.offset}>
                    <td className="select-none pr-4 align-top text-text-subtle">{row.offset}</td>
                    <td className="whitespace-pre pr-4 align-top text-text">
                      {row.hex.join(" ")}
                    </td>
                    <td className="whitespace-pre align-top text-text-muted">{row.ascii}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <footer className="flex h-12 shrink-0 items-center gap-3 border-t border-border px-4">
          {error ? (
            <span className="min-w-0 flex-1 truncate text-[12px] text-deleted">{error}</span>
          ) : (
            <span className="min-w-0 flex-1 truncate text-[11px] text-text-subtle">
              {/* Cada limite é anunciado com o número, nunca escondido. */}
              {truncated
                ? `Preview: first ${formatBlobSize(inHand)} of ${formatBlobSize(totalBytes)}.`
                : clipped
                  ? `Showing the first ${formatBlobSize(RENDER_BYTE_LIMIT)} of ${formatBlobSize(inHand)}.`
                  : `${inHand.toLocaleString()} bytes.`}
            </span>
          )}
          {truncated && (
            <button
              onClick={onLoadFull}
              disabled={loading}
              className="rounded-md border border-border px-3 py-1.5 text-[12px] text-text-muted hover:bg-surface-hover disabled:opacity-50"
            >
              {loading ? "Loading..." : "Load full content"}
            </button>
          )}
          <button
            onClick={copy}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] text-text-muted hover:bg-surface-hover"
            title={truncated ? "Copy the preview as base64" : "Copy as base64"}
          >
            {copied ? <Check size={13} strokeWidth={1.5} /> : <Copy size={13} strokeWidth={1.5} />}
            {copied ? "Copied" : "Copy base64"}
          </button>
        </footer>
      </section>
    </div>
  );
}
