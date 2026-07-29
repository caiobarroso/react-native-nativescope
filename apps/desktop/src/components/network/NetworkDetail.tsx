import { lazy, Suspense, useMemo, useState } from "react";
import {
  ArrowDownUp,
  Check,
  ChevronDown,
  Copy,
  Database,
  GitCompare,
  RefreshCw,
} from "lucide-react";
import type { NetworkBody, NetworkRequest } from "@rnsi/protocol";
import { useNetwork } from "../../lib/network-store.ts";
import { groupKey } from "../../lib/network-select.ts";
import { getNetworkBody } from "../../lib/studio-client.ts";
import { JsonWorkspace } from "../ValueEditor.tsx";
import {
  EXPORT_FORMATS,
  exportRequest,
  type ExportFormat,
} from "../../lib/network-export.ts";
const NetworkReplayModal = lazy(() =>
  import("./NetworkReplayModal.tsx").then((module) => ({
    default: module.NetworkReplayModal,
  })),
);
import { NetworkDiff } from "./NetworkDiff.tsx";
import { StorageImpactPanel } from "./StorageImpactPanel.tsx";
import { useStorageAttribution } from "../../lib/use-storage-impact.ts";
import {
  formatBytes,
  formatDuration,
  methodColorClass,
  statusColorClass,
  statusLabel,
} from "./format.ts";

type Tab = "request" | "response" | "response-headers" | "storage-impact";

export function NetworkDetail() {
  const selectedId = useNetwork((s) => s.selectedId);
  const request = useNetwork((s) =>
    s.selectedId ? s.byId[s.selectedId] : null,
  );
  const compareId = useNetwork((s) => s.compareId);
  const byId = useNetwork((s) => s.byId);
  const setCompare = useNetwork((s) => s.setCompare);
  const attribution = useStorageAttribution();
  const [tab, setTab] = useState<Tab>("response");
  const [replayOpen, setReplayOpen] = useState(false);

  const compareRequest = compareId ? (byId[compareId] ?? null) : null;
  const impactItems = request ? (attribution.items.get(request.id) ?? []) : [];
  const impactCount = impactItems.length;
  if (request && compareRequest) {
    return (
      <NetworkDiff
        a={request}
        b={compareRequest}
        onClose={() => setCompare(null)}
      />
    );
  }

  if (!selectedId || !request) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center border-l border-border p-8 text-center">
        <p className="max-w-[280px] text-[13px] text-text-subtle">
          Select a request to inspect its headers, body, and timing.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col border-l border-border">
      <RequestSummary
        request={request}
        impactCount={impactCount}
        impactActive={tab === "storage-impact"}
        onOpenImpact={() => setTab("storage-impact")}
      />

      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border bg-surface-sunken px-3">
        <TabButton active={tab === "request"} onClick={() => setTab("request")}>
          Request
        </TabButton>
        <TabButton
          active={tab === "response"}
          onClick={() => setTab("response")}
        >
          Response
        </TabButton>
        <TabButton
          active={tab === "response-headers"}
          onClick={() => setTab("response-headers")}
        >
          Response headers
        </TabButton>
        <div className="ml-auto flex items-center gap-1.5">
          <CompareMenu request={request} />
          <button
            onClick={() => setReplayOpen(true)}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface-raised px-2 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text"
          >
            <RefreshCw size={12} strokeWidth={1.5} />
            Replay
          </button>
          <ExportMenu request={request} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {tab === "request" ? (
          <>
            <HeaderTable
              title="Request headers"
              headers={request.requestHeaders}
            />
            <BodySection
              key={`${request.id}-request`}
              title="Request body"
              body={request.requestBody}
              requestId={request.id}
              side="request"
              sourceName={`${request.path} request`}
            />
          </>
        ) : tab === "response-headers" ? (
          <HeaderTable
            title="Response headers"
            headers={request.responseHeaders}
          />
        ) : tab === "storage-impact" ? (
          <StorageImpactPanel items={impactItems} />
        ) : (
          <BodySection
            key={`${request.id}-response`}
            title="Response body"
            body={request.responseBody}
            requestId={request.id}
            side="response"
            sourceName={request.path}
          />
        )}
      </div>

      {replayOpen && (
        <Suspense fallback={null}>
          <NetworkReplayModal
            request={request}
            onClose={() => setReplayOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}

function RequestSummary({
  request,
  impactCount,
  impactActive,
  onOpenImpact,
}: {
  request: NetworkRequest;
  impactCount: number;
  impactActive: boolean;
  onOpenImpact: () => void;
}) {
  return (
    <div className="shrink-0 border-b border-border bg-surface px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span
          className={`font-mono text-[11px] font-bold uppercase ${methodColorClass(request.method)}`}
        >
          {request.method}
        </span>
        <span
          className={`font-mono text-[13px] font-semibold ${statusColorClass(request)}`}
        >
          {statusLabel(request)}
        </span>
        {request.statusText ? (
          <span className="text-[12px] text-text-muted">
            {request.statusText}
          </span>
        ) : null}
        {request.replayOf ? (
          <span
            className="inline-flex items-center gap-1 rounded bg-accent-wash px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-accent"
            title={`Replay of ${request.replayOf}`}
          >
            <RefreshCw size={9} strokeWidth={2} />
            Replay
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-3 font-mono text-[11px] text-text-subtle">
          <span title="Duration">{formatDuration(request.duration)}</span>
          <span title="Response size">{formatBytes(request.responseSize)}</span>
        </span>
      </div>
      <div className="mt-1 flex min-w-0 items-start gap-3">
        <p
          className="min-w-0 flex-1 break-all font-mono text-[11px] text-text-muted"
          title={request.url}
        >
          {request.url}
        </p>
        <button
          type="button"
          onClick={onOpenImpact}
          aria-pressed={impactActive}
          title={
            impactCount > 0
              ? `Inspect ${impactCount} storage ${
                  impactCount === 1 ? "change" : "changes"
                } correlated with this response`
              : "Inspect storage changes correlated with this response"
          }
          className={`inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[10px] transition-colors ${
            impactActive
              ? "border-accent bg-accent-wash text-accent"
              : impactCount > 0
                ? "border-border bg-surface-raised text-text-muted hover:border-accent hover:text-accent"
                : "border-border/70 bg-surface-raised text-text-subtle hover:bg-surface-hover hover:text-text-muted"
          }`}
        >
          <Database size={11} strokeWidth={1.5} />
          Storage impact
          <span className="font-mono tabular-nums">{impactCount}</span>
        </button>
      </div>
      {request.error ? (
        <p className="mt-1 font-mono text-[11px] text-deleted">
          {request.error}
        </p>
      ) : null}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-[12px] font-medium ${
        active
          ? "bg-surface-raised text-text shadow-sm"
          : "text-text-muted hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

function CompareMenu({ request }: { request: NetworkRequest }) {
  const requests = useNetwork((s) => s.requests);
  const setCompare = useNetwork((s) => s.setCompare);
  const [open, setOpen] = useState(false);

  const candidates = useMemo(
    () =>
      requests
        .filter((r) => r.id !== request.id && groupKey(r) === groupKey(request))
        .slice(0, 40),
    [requests, request],
  );

  const buttonClass =
    "inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface-raised px-2 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text disabled:opacity-40 disabled:hover:bg-surface-raised";

  if (candidates.length === 0) {
    return (
      <button
        disabled
        title="No other executions of this endpoint to compare"
        className={buttonClass}
      >
        <GitCompare size={12} strokeWidth={1.5} />
        Compare
      </button>
    );
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className={buttonClass}>
        <GitCompare size={12} strokeWidth={1.5} />
        Compare
        <ChevronDown size={12} strokeWidth={1.5} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 max-h-72 w-56 overflow-y-auto rounded-md border border-border bg-surface-raised py-1 shadow-lg">
            <p className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
              Compare with
            </p>
            {candidates.map((candidate) => (
              <button
                key={candidate.id}
                onClick={() => {
                  setCompare(candidate.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] hover:bg-surface-hover"
              >
                <span
                  className={`font-mono font-semibold ${statusColorClass(candidate)}`}
                >
                  {statusLabel(candidate)}
                </span>
                <span className="font-mono text-text-muted">
                  {formatDuration(candidate.duration)}
                </span>
                <span className="ml-auto font-mono text-text-subtle">
                  {new Date(candidate.startedAt).toLocaleTimeString()}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ExportMenu({ request }: { request: NetworkRequest }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (format: ExportFormat, label: string) => {
    setOpen(false);
    try {
      await navigator.clipboard.writeText(exportRequest(request, format));
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1400);
    } catch {
      /* clipboard indisponível: silencioso */
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface-raised px-2 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text"
      >
        {copied ? (
          <>
            <Check size={12} strokeWidth={2} className="text-created" />
            Copied {copied}
          </>
        ) : (
          <>
            <Copy size={12} strokeWidth={1.5} />
            Copy as
            <ChevronDown size={12} strokeWidth={1.5} />
          </>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-36 overflow-hidden rounded-md border border-border bg-surface-raised py-1 shadow-lg">
            {EXPORT_FORMATS.map((format) => (
              <button
                key={format.id}
                onClick={() => copy(format.id, format.label)}
                className="block w-full px-2.5 py-1.5 text-left text-[12px] text-text-muted hover:bg-surface-hover hover:text-text"
              >
                {format.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function HeaderTable({
  title,
  headers,
}: {
  title: string;
  headers: Record<string, string>;
}) {
  const entries = Object.entries(headers);
  return (
    <section>
      <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
        {title} {entries.length > 0 ? `· ${entries.length}` : ""}
      </h3>
      {entries.length === 0 ? (
        <p className="text-[12px] text-text-subtle">None.</p>
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          {entries.map(([name, value], index) => (
            <div
              key={name}
              className={`flex gap-2 px-2 py-1 text-[11px] ${
                index > 0 ? "border-t border-border/60" : ""
              }`}
            >
              <span
                className="w-40 shrink-0 truncate font-mono font-semibold text-text-muted"
                title={name}
              >
                {name}
              </span>
              <span className="min-w-0 flex-1 break-all font-mono text-text">
                {value}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function BodySection({
  title,
  body,
  requestId,
  side,
  sourceName,
}: {
  title: string;
  body: NetworkBody | null;
  requestId: string;
  side: "request" | "response";
  sourceName: string;
}) {
  const [full, setFull] = useState<NetworkBody | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const effective = full ?? body;
  const hasText = effective !== null && effective.text.length > 0;

  const loadFull = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getNetworkBody(requestId, side);
      if (result) setFull(result);
      else setError("Full body is no longer available on the device.");
    } catch {
      setError("Failed to load full body.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
          {title}
        </h3>
        {effective && effective.size > 0 ? (
          <span className="text-[10px] text-text-subtle">
            {formatBytes(effective.size)}
          </span>
        ) : null}
      </div>

      {!effective || (effective.size === 0 && !hasText) ? (
        <p className="text-[12px] text-text-subtle">No body.</p>
      ) : effective.kind === "binary" || effective.kind === "form" ? (
        <p className="text-[12px] text-text-subtle">
          {effective.kind === "binary" ? "Binary content" : "Form data"} ·{" "}
          {formatBytes(effective.size)}
        </p>
      ) : (
        <div className="flex min-h-[220px] flex-1 flex-col">
          {effective.truncated ? (
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <p className="flex items-center gap-1 text-[10px] text-text-subtle">
                <ArrowDownUp size={11} strokeWidth={1.5} />
                Preview truncated to {formatBytes(effective.text.length)}.
              </p>
              <button
                onClick={loadFull}
                disabled={loading}
                className="rounded border border-border bg-surface-raised px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-surface-hover hover:text-text disabled:opacity-50"
              >
                {loading ? "Loading…" : "Load full body"}
              </button>
            </div>
          ) : null}
          {error ? (
            <p className="mb-1 text-[10px] text-deleted">{error}</p>
          ) : null}
          {isJsonBody(effective) ? (
            <JsonWorkspace
              draft={effective.text}
              onDraftChange={() => {}}
              sourceName={sourceName}
              readOnly
            />
          ) : (
            // Resposta não-JSON (texto plano, XML, um token, uma string): mostra
            // o corpo INTEIRO com quebra de linha — não a tela "invalid JSON".
            <PlainBody
              text={effective.text}
              contentType={effective.contentType ?? null}
            />
          )}
        </div>
      )}
    </section>
  );
}

/** JSON quando o runtime rotulou `kind:"json"` — ou, defensivo, quando o texto
 *  claramente começa como objeto/array e o rótulo veio ausente. */
function isJsonBody(body: NetworkBody): boolean {
  return (
    body.kind === "json" || (body.kind == null && /^\s*[[{]/.test(body.text))
  );
}

/** Viewer de corpo textual não-JSON: readOnly, quebra tokens longos, rola em
 *  corpos grandes, com botão de copiar — o análogo simples do JsonWorkspace. */
function PlainBody({
  text,
  contentType,
}: {
  text: string;
  contentType: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const label = contentType ? contentType.split(";")[0] : "text";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard indisponível: silencioso */
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-surface-raised">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-surface-sunken px-2">
        <span className="font-mono text-[11px] text-text-subtle">{label}</span>
        <button
          onClick={copy}
          title="Copy"
          className="ml-auto rounded p-1 text-text-subtle hover:bg-surface-hover hover:text-text"
        >
          {copied ? (
            <Check size={13} strokeWidth={1.5} />
          ) : (
            <Copy size={13} strokeWidth={1.5} />
          )}
        </button>
      </div>
      <textarea
        value={text}
        readOnly
        spellCheck={false}
        aria-label="Response body text"
        className="min-h-0 flex-1 resize-none rounded-b-md bg-surface p-3 font-mono text-[12px] leading-relaxed text-text outline-none"
      />
    </div>
  );
}
