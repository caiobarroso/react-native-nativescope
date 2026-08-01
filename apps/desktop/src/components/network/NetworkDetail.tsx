import { lazy, Suspense, useMemo, useState } from "react";
import {
  ArrowDownUp,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Database,
  Download,
  GitCompare,
  RefreshCw,
} from "lucide-react";
import type { NetworkBody, NetworkRequest } from "@rnsi/protocol";
import { useNetwork } from "../../lib/network-store.ts";
import { useTimeline } from "../../lib/timeline-store.ts";
import { groupKey } from "../../lib/network-select.ts";
import { getNetworkBody } from "../../lib/studio-client.ts";
import {
  getGraphQLRequestInfo,
  getGraphQLResponseInfo,
  getGraphQLResponseInfoFromBody,
  type GraphQLResponseInfo,
  type GraphQLOperation,
} from "../../lib/network-graphql.ts";
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
import { GraphQLCodeEditor } from "./GraphQLCodeEditor.tsx";
import { useStorageAttribution } from "../../lib/use-storage-impact.ts";
import {
  formatBytes,
  formatDuration,
  methodColorClass,
  requestTypeLabel,
  statusColorClass,
  statusLabel,
  statusReason,
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
  const graphQLRequest = request ? getGraphQLRequestInfo(request) : null;
  const graphQLResponse = request ? getGraphQLResponseInfo(request) : null;
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
        onStorageImpact={() => setTab("storage-impact")}
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
          graphQLRequest ? (
            <GraphQLRequestPanel
              operations={graphQLRequest.operations}
              headers={request.requestHeaders}
            />
          ) : (
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
          )
        ) : tab === "response-headers" ? (
          <HeaderTable
            title="Response headers"
            headers={request.responseHeaders}
          />
        ) : tab === "storage-impact" ? (
          <StorageImpactPanel items={impactItems} />
        ) : graphQLRequest ? (
          <GraphQLResponsePanel
            key={request.id}
            request={request}
            response={graphQLResponse}
          />
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

/** Separador sutil entre os metadados de status (reason · tempo · size).
 *  Opacidade recuada cria a hierarquia sem virar ruído. */
function MetaSep() {
  return (
    <span aria-hidden className="text-text-subtle" style={{ opacity: 0.4 }}>
      ·
    </span>
  );
}

function RequestSummary({
  request,
  impactCount,
  impactActive,
  onStorageImpact,
}: {
  request: NetworkRequest;
  impactCount: number;
  impactActive: boolean;
  onStorageImpact: () => void;
}) {
  const graphQL = getGraphQLRequestInfo(request);
  const graphQLErrors = getGraphQLResponseInfo(request)?.errors.length ?? 0;
  const typeLabel = requestTypeLabel(request);
  const reason = statusReason(request);
  // Reason phrase só agrega em erro/redirect; num 2xx o código verde já basta,
  // então escondemos "OK" pra manter a linha limpa.
  const showReason =
    reason !== null && (request.status === null || request.status >= 300);
  return (
    <div className="shrink-0 border-b border-border bg-surface px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={`font-mono text-[11px] font-semibold uppercase tracking-wide ${methodColorClass(typeLabel)}`}
            >
              {typeLabel}
            </span>
            <span
              className={`font-mono text-[14px] font-bold leading-none ${statusColorClass(request)}`}
            >
              {statusLabel(request)}
            </span>
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-text-subtle">
              {showReason ? (
                <>
                  <MetaSep />
                  <span className="text-text-muted">{reason}</span>
                </>
              ) : null}
              <MetaSep />
              <span className="tabular-nums" title="Duration">
                {formatDuration(request.duration)}
              </span>
              <MetaSep />
              <span className="tabular-nums" title="Response size">
                {formatBytes(request.responseSize)}
              </span>
            </span>
            {request.replayOf ? (
              <span
                className="inline-flex items-center gap-1 rounded bg-accent-wash px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-accent"
                title={`Replay of ${request.replayOf}`}
              >
                <RefreshCw size={9} strokeWidth={2} />
                Replay
              </span>
            ) : null}
            {graphQL ? (
              <span className="inline-flex items-center rounded bg-accent-wash px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-accent">
                GraphQL
              </span>
            ) : null}
            {graphQLErrors > 0 ? (
              <span className="inline-flex items-center rounded bg-deleted-wash px-1.5 py-0.5 font-mono text-[9px] font-semibold text-deleted">
                {graphQLErrors} GraphQL{" "}
                {graphQLErrors === 1 ? "error" : "errors"}
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-1.5">
            <p
              className="min-w-0 break-all font-mono text-[11px] text-text-muted"
              title={request.url}
            >
              {request.url}
            </p>
            <CopyIconButton value={request.url} title="Copy URL" />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <TimelineButton request={request} />
          {impactCount > 0 ? (
            <StorageImpactButton
              active={impactActive}
              count={impactCount}
              onClick={onStorageImpact}
            />
          ) : null}
        </div>
      </div>
      {request.error ? (
        <p className="mt-1 font-mono text-[11px] text-deleted">
          {request.error}
        </p>
      ) : null}
    </div>
  );
}

function GraphQLRequestPanel({
  operations,
  headers,
}: {
  operations: GraphQLOperation[];
  headers: Record<string, string>;
}) {
  return (
    <>
      {/* Headers no topo — consistente com o painel HTTP (headers acima do
          corpo). A operação GraphQL é o análogo do "corpo", vem depois. */}
      <HeaderTable title="Request headers" headers={headers} />
      {operations.map((operation, index) => (
        <GraphQLOperationSection
          key={`${operation.operationName ?? "anonymous"}-${index}`}
          operation={operation}
          index={index}
          total={operations.length}
        />
      ))}
    </>
  );
}

/** Uma operação GraphQL: documento (colapsável) + Variables/Extensions. O
 *  documento pode ser enorme e empurrar o viewer de Variables pra baixo — além
 *  do teto de 320px que já limita a altura, dá pra recolhê-lo e trazer o viewer
 *  de volta pro topo. */
function GraphQLOperationSection({
  operation,
  index,
  total,
}: {
  operation: GraphQLOperation;
  index: number;
  total: number;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <section className="@container space-y-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="flex min-w-0 items-center gap-2 text-left"
          title={collapsed ? "Show query document" : "Hide query document"}
        >
          <Chevron
            size={13}
            strokeWidth={1.5}
            className="shrink-0 text-text-subtle"
          />
          <h3 className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
            GraphQL operation
          </h3>
          <span className="shrink-0 rounded bg-accent-wash px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-accent">
            {operation.operationType}
          </span>
          <span className="min-w-0 truncate font-mono text-[11px] font-semibold text-text">
            {operation.operationName ?? "Anonymous operation"}
          </span>
        </button>
        {total > 1 ? (
          <span className="shrink-0 text-[10px] text-text-subtle">
            {index + 1} of {total}
          </span>
        ) : null}
        {collapsed && operation.formattedQuery ? (
          <span className="ml-auto shrink-0 font-mono text-[10px] text-text-subtle">
            {operation.formattedQuery.split("\n").length} lines hidden
          </span>
        ) : null}
      </div>

      {!collapsed ? (
        operation.formattedQuery ? (
          <GraphQLCodeEditor
            value={operation.formattedQuery}
            readOnly
            minHeight="150px"
            maxHeight="320px"
          />
        ) : (
          <p className="rounded-md border border-border bg-surface-sunken px-3 py-2 text-[11px] text-text-muted">
            Persisted operation. The request did not include its GraphQL
            document.
          </p>
        )
      ) : null}

      {/* Só divide em 2 colunas quando (a) há Extensions para preencher a 2ª
          coluna — senão a Variables ficava órfã na metade esquerda — e (b) o
          CONTÊINER (não a viewport) é largo o bastante. */}
      <div
        className={`grid min-h-[220px] grid-cols-1 gap-3 ${
          operation.extensions != null ? "@2xl:grid-cols-2" : ""
        }`}
      >
        <JsonValuePanel
          title="Variables"
          value={operation.variables}
          sourceName={`${operation.operationName ?? "operation"} variables`}
        />
        {operation.extensions != null ? (
          <JsonValuePanel
            title="Extensions"
            value={operation.extensions}
            sourceName={`${operation.operationName ?? "operation"} extensions`}
          />
        ) : null}
      </div>
    </section>
  );
}

function GraphQLResponsePanel({
  request,
  response,
}: {
  request: NetworkRequest;
  response: GraphQLResponseInfo | null;
}) {
  const [fullBody, setFullBody] = useState<NetworkBody | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const effectiveResponse =
    response ?? getGraphQLResponseInfoFromBody(fullBody);
  const [surface, setSurface] = useState<
    "data" | "errors" | "extensions" | "raw"
  >(response?.hasErrors ? "errors" : "data");

  if (!effectiveResponse) {
    if (request.responseBody?.truncated) {
      return (
        <section className="flex min-h-[280px] flex-1 flex-col items-center justify-center rounded-md border border-border bg-surface-sunken px-6 text-center">
          <ArrowDownUp
            size={18}
            strokeWidth={1.5}
            className="mb-2 text-accent"
          />
          <h3 className="text-[12px] font-semibold text-text">
            Load the full GraphQL response
          </h3>
          <p className="mt-1 max-w-md text-[11px] leading-relaxed text-text-muted">
            The timeline keeps a bounded preview. Load this payload on demand to
            inspect its data, errors and extensions separately.
          </p>
          <button
            type="button"
            disabled={loading}
            onClick={async () => {
              setLoading(true);
              setLoadError(null);
              try {
                const body = await getNetworkBody(request.id, "response");
                if (body) {
                  const parsed = getGraphQLResponseInfoFromBody(body);
                  setFullBody(body);
                  if (parsed?.hasErrors) setSurface("errors");
                } else
                  setLoadError("The full response is no longer available.");
              } catch {
                setLoadError("Failed to load the full response.");
              } finally {
                setLoading(false);
              }
            }}
            className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[11px] font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            <Download size={13} strokeWidth={2} />
            {loading ? "Loading…" : "Load full response"}
          </button>
          {loadError ? (
            <p className="mt-2 text-[10px] text-deleted">{loadError}</p>
          ) : null}
        </section>
      );
    }
    return (
      <BodySection
        title="Response body"
        body={request.responseBody}
        requestId={request.id}
        side="response"
        sourceName={request.path}
      />
    );
  }

  const options = [
    {
      id: "data" as const,
      label: "Data",
      available: effectiveResponse.data !== undefined,
    },
    {
      id: "errors" as const,
      label: `Errors${effectiveResponse.errors.length ? ` ${effectiveResponse.errors.length}` : ""}`,
      available: effectiveResponse.errors.length > 0,
    },
    {
      id: "extensions" as const,
      label: "Extensions",
      available: effectiveResponse.extensions !== undefined,
    },
    { id: "raw" as const, label: "Raw", available: true },
  ];
  const value =
    surface === "data"
      ? effectiveResponse.data
      : surface === "errors"
        ? effectiveResponse.errors
        : surface === "extensions"
          ? effectiveResponse.extensions
          : effectiveResponse.raw;

  return (
    <section className="flex min-h-[320px] flex-1 flex-col">
      <div className="mb-2 flex items-center gap-1 rounded-md border border-border bg-surface-sunken p-0.5">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled={!option.available}
            onClick={() => setSurface(option.id)}
            className={`inline-flex h-7 items-center rounded px-2.5 text-[11px] font-medium ${
              surface === option.id
                ? option.id === "errors"
                  ? "bg-deleted-wash text-deleted"
                  : "bg-surface-raised text-text shadow-sm"
                : "text-text-muted hover:text-text"
            } disabled:cursor-default disabled:opacity-35`}
          >
            {option.label}
          </button>
        ))}
        <span className="ml-auto pr-2 text-[10px] text-text-subtle">
          GraphQL response
        </span>
      </div>
      <JsonWorkspace
        draft={stringifyJsonValue(value)}
        onDraftChange={() => {}}
        sourceName={`${request.path} ${surface}`}
        readOnly
      />
    </section>
  );
}

function JsonValuePanel({
  title,
  value,
  sourceName,
}: {
  title: string;
  value: unknown;
  sourceName: string;
}) {
  return (
    <section className="flex min-h-[220px] min-w-0 flex-col">
      <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
        {title}
      </h3>
      {value == null ? (
        <div className="flex min-h-[120px] flex-1 items-center justify-center rounded-md border border-border bg-surface-sunken text-[11px] text-text-subtle">
          None.
        </div>
      ) : (
        <JsonWorkspace
          draft={stringifyJsonValue(value)}
          onDraftChange={() => {}}
          sourceName={sourceName}
          readOnly
        />
      )}
    </section>
  );
}

function stringifyJsonValue(value: unknown): string {
  if (value === undefined) return "null";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "null";
  }
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

/**
 * Entrada para a Timeline escopada nesta request. O Storage impact ao lado
 * responde "o que ESTA request mudou"; a Timeline responde a pergunta maior —
 * "o que aconteceu em volta dela", incluindo os logs que o Storage impact não
 * enxerga.
 */
function TimelineButton({ request }: { request: NetworkRequest }) {
  const open = useTimeline((s) => s.open);
  return (
    <button
      onClick={() =>
        open({
          id: `req:${request.id}`,
          kind: "request",
          ts: request.startedAt,
          label: `${request.method} ${request.path}`,
          detail: request.status === null ? request.error : String(request.status),
        }, { module: "network" })
      }
      title="See logs and storage writes around this request"
      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-[11px] font-medium text-text-muted hover:border-accent hover:text-accent"
    >
      <Clock size={13} strokeWidth={1.5} />
      Timeline
    </button>
  );
}

/** Storage impact promovido ao cabeçalho do request: pill de ação com destaque
 *  coral + contagem quando há impacto — é o diferencial do produto, fica à vista
 *  no topo (não escondido entre as abas). */
function StorageImpactButton({
  active,
  count,
  onClick,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title="Storage changes correlated with this response"
      className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-medium ${
        active
          ? "border-accent/50 bg-accent-wash text-accent"
          : "border-accent/40 text-accent hover:bg-accent-wash"
      }`}
    >
      <Database size={13} strokeWidth={1.5} />
      Storage impact
      <span className="inline-flex h-4 min-w-4 items-center justify-center rounded bg-accent px-1 font-mono text-[10px] tabular-nums text-white">
        {count}
      </span>
    </button>
  );
}

/** Botão minimalista de copiar (só ícone) com feedback de check. */
function CopyIconButton({
  value,
  title = "Copy",
}: {
  value: string;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard indisponível: silencioso */
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      title={title}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-subtle hover:bg-surface-hover hover:text-text"
    >
      {copied ? (
        <Check size={13} strokeWidth={1.5} />
      ) : (
        <Copy size={13} strokeWidth={1.5} />
      )}
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
  const [collapsed, setCollapsed] = useState(false);
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <section>
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        className="mb-1 flex items-center gap-1.5 text-left"
        title={
          collapsed
            ? `Show ${title.toLowerCase()}`
            : `Hide ${title.toLowerCase()}`
        }
      >
        <Chevron
          size={12}
          strokeWidth={1.5}
          className="shrink-0 text-text-subtle"
        />
        <h3 className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
          {title} {entries.length > 0 ? `· ${entries.length}` : ""}
        </h3>
      </button>
      {collapsed ? null : entries.length === 0 ? (
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
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-created/40 bg-created-wash px-2.5 py-1.5">
              <ArrowDownUp
                size={12}
                strokeWidth={1.5}
                className="shrink-0 text-created"
              />
              <p className="text-[11px] text-text-muted">
                Showing first {formatBytes(effective.text.length)} of{" "}
                {formatBytes(effective.size)}.
              </p>
              <button
                onClick={loadFull}
                disabled={loading}
                className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-created px-2.5 py-1 text-[11px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                <Download size={12} strokeWidth={2} />
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
