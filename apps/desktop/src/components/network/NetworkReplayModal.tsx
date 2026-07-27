import { useState } from "react";
import { RefreshCw, X } from "lucide-react";
import type { NetworkRequest } from "@rnsi/protocol";
import { useNetwork } from "../../lib/network-store.ts";
import { replayRequest } from "../../lib/studio-client.ts";
import { methodColorClass } from "./format.ts";

type ReplayMode = "original" | "current-session";

function headersToText(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join("\n");
}

function parseHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const name = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (name) out[name] = value;
  }
  return out;
}

export function NetworkReplayModal({
  request,
  onClose,
}: {
  request: NetworkRequest;
  onClose: () => void;
}) {
  const select = useNetwork((s) => s.select);
  const [mode, setMode] = useState<ReplayMode>("original");
  const [query, setQuery] = useState(request.query ?? "");
  const [headers, setHeaders] = useState(() => headersToText(request.requestHeaders));
  const [body, setBody] = useState(request.requestBody?.text ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const replay = async () => {
    setBusy(true);
    setError(null);
    try {
      const newId = await replayRequest(request.id, mode, {
        query: query.trim() === "" ? null : query.trim(),
        headers: parseHeaders(headers),
        body: body === "" ? null : body,
      });
      if (newId) select(newId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "replay failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          <RefreshCw size={15} strokeWidth={1.5} className="text-accent" />
          <h2 className="text-[13px] font-semibold text-text">Replay request</h2>
          <span className={`ml-1 font-mono text-[11px] font-bold uppercase ${methodColorClass(request.method)}`}>
            {request.method}
          </span>
          <span className="min-w-0 truncate font-mono text-[11px] text-text-muted">{request.path}</span>
          <button
            onClick={onClose}
            className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded text-text-subtle hover:bg-surface-hover hover:text-text"
          >
            <X size={15} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-subtle">Session</p>
            <div className="flex gap-2">
              <ModeButton active={mode === "original"} onClick={() => setMode("original")} title="Send exactly as captured (original auth & headers).">
                Original
              </ModeButton>
              <ModeButton
                active={mode === "current-session"}
                onClick={() => setMode("current-session")}
                title="Use the app's freshest auth for this host (avoids expired tokens)."
              >
                Current session
              </ModeButton>
            </div>
          </div>

          <Field label="Query">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="page=1&limit=20"
              className="h-8 w-full rounded-md border border-border bg-surface-raised px-2 font-mono text-[12px] text-text focus:border-accent focus:outline-none"
            />
          </Field>

          <Field label="Headers">
            <textarea
              value={headers}
              onChange={(event) => setHeaders(event.target.value)}
              rows={5}
              spellCheck={false}
              className="w-full resize-y rounded-md border border-border bg-surface-raised p-2 font-mono text-[11px] leading-relaxed text-text focus:border-accent focus:outline-none"
            />
          </Field>

          <Field label="Body">
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={5}
              spellCheck={false}
              placeholder="No body"
              className="w-full resize-y rounded-md border border-border bg-surface-raised p-2 font-mono text-[11px] leading-relaxed text-text focus:border-accent focus:outline-none"
            />
          </Field>

          {error ? <p className="text-[11px] text-deleted">{error}</p> : null}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-[12px] text-text-muted hover:bg-surface-hover"
          >
            Cancel
          </button>
          <button
            onClick={replay}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            <RefreshCw size={13} strokeWidth={2} className={busy ? "animate-spin" : ""} />
            {busy ? "Replaying…" : "Replay"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex-1 rounded-md border px-2 py-1.5 text-[12px] ${
        active
          ? "border-accent bg-accent-wash text-accent"
          : "border-border bg-surface-raised text-text-muted hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
        {label}
      </span>
      {children}
    </label>
  );
}
