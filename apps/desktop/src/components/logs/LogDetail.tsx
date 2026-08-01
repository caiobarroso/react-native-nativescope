import { useState } from "react";
import type { LogArg, LogEntry } from "@rnsi/protocol";
import { Check, ChevronDown, ChevronRight, Clock, Copy, MousePointerClick } from "lucide-react";
import { useLogs } from "../../lib/logs-store.ts";
import { useTimeline } from "../../lib/timeline-store.ts";
import { JsonWorkspace } from "../ValueEditor.tsx";
import {
  formatAbsolute,
  formatLogClock,
  levelBadgeClass,
  levelLabel,
  levelTextClass,
  sourceLabel,
} from "./format.ts";

/** Painel de detalhe: a mensagem, os argumentos inspecionáveis e o stack. */
export function LogDetail() {
  const selectedId = useLogs((s) => s.selectedId);
  const entry = useLogs((s) => (s.selectedId === null ? null : s.byId[s.selectedId] ?? null));
  const setNamespace = useLogs((s) => s.setNamespace);
  const openTimeline = useTimeline((s) => s.open);

  if (selectedId === null || entry === null) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center border-l border-border px-6 text-center">
        <div className="flex max-w-[280px] flex-col items-center gap-2">
          <MousePointerClick size={20} strokeWidth={1.5} className="text-text-subtle" />
          <p className="text-[12px] text-text-muted">Select a log to inspect it.</p>
          <p className="text-[11px] leading-relaxed text-text-subtle">
            Objects logged with <code className="font-mono">console.log</code> open in the same
            viewer used by Storage — expandable, searchable, copyable.
          </p>
        </div>
      </div>
    );
  }

  const inspectable = entry.args.filter((arg) => arg.json !== null);
  const source = sourceLabel(entry.source);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto border-l border-border">
      <div className="flex flex-col gap-2 border-b border-border bg-surface-sunken px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold ${levelBadgeClass(
              entry.level,
            )}`}
          >
            {levelLabel(entry.level)}
          </span>
          {entry.namespace !== null && (
            <button
              onClick={() => setNamespace(entry.namespace)}
              title="Filter the list by this namespace"
              className="shrink-0 rounded border border-accent/40 px-1.5 py-0.5 font-mono text-[10px] font-medium text-accent hover:bg-accent-wash"
            >
              {entry.namespace}
            </button>
          )}
          {source !== null && (
            <span className="shrink-0 rounded border border-deleted/40 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-deleted">
              {source}
            </span>
          )}
          <span className="min-w-0 flex-1" />
          <button
            onClick={() =>
              openTimeline({
                id: `log:${entry.id}`,
                kind: entry.level === "error" ? "error" : "log",
                ts: entry.ts,
                label: entry.message,
                detail: entry.namespace,
              }, { module: "logs" })
            }
            title="Open the timeline centred on this log — what ran right before and right after it"
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded border border-border bg-surface-raised px-1.5 text-[10px] text-text-muted hover:border-accent hover:text-accent"
          >
            <Clock size={11} strokeWidth={1.5} />
            Timeline
          </button>
          <CopyButton label="Copy log" value={plainText(entry)} />
          <CopyButton label="Copy JSON" value={JSON.stringify(entry, null, 2)} />
        </div>

        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[11px] tabular-nums text-text">
            {formatLogClock(entry.ts)}
          </span>
          <span aria-hidden className="text-text-subtle" style={{ opacity: 0.4 }}>
            ·
          </span>
          <span className="text-[11px] text-text-muted">{formatAbsolute(entry.ts)}</span>
          {entry.repeat > 1 && (
            <>
              <span aria-hidden className="text-text-subtle" style={{ opacity: 0.4 }}>
                ·
              </span>
              <span className="text-[11px] text-text-muted">repeated {entry.repeat}×</span>
            </>
          )}
        </div>

        <p
          className={`whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed ${levelTextClass(
            entry.level,
          )}`}
          style={{ overflowWrap: "anywhere" }}
        >
          {entry.message}
        </p>

        {entry.truncated && (
          <p className="text-[10px] text-text-subtle">
            Some values were capped on the device to keep the app fast.
          </p>
        )}
      </div>

      <div className="flex min-h-0 flex-col gap-3 p-4">
        {inspectable.length === 0 ? (
          <p className="text-[11px] text-text-subtle">
            No structured data — this log carried only text.
          </p>
        ) : (
          inspectable.map((arg, index) => (
            <ArgPanel key={index} arg={arg} index={index} total={inspectable.length} />
          ))
        )}

        {entry.stack !== null && <StackPanel stack={entry.stack} />}
      </div>
    </div>
  );
}

function ArgPanel({ arg, index, total }: { arg: LogArg; index: number; total: number }) {
  const [collapsed, setCollapsed] = useState(false);
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  const label = arg.kind === "error" ? "Error" : total === 1 ? "Data" : `Argument ${index + 1}`;

  return (
    <section className="flex min-h-0 flex-col">
      <button
        onClick={() => setCollapsed((current) => !current)}
        className="flex h-7 items-center gap-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle hover:text-text"
      >
        <Chevron size={12} strokeWidth={2} />
        {label}
        {arg.truncated && (
          <span className="font-normal normal-case tracking-normal text-text-subtle">
            (capped)
          </span>
        )}
      </button>
      {!collapsed && (
        <div className="flex min-h-[220px] flex-col">
          <JsonWorkspace
            draft={arg.json ?? "null"}
            onDraftChange={() => {}}
            sourceName={label}
            readOnly
          />
        </div>
      )}
    </section>
  );
}

function StackPanel({ stack }: { stack: string }) {
  const [collapsed, setCollapsed] = useState(true);
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  const lineCount = stack.split("\n").length;

  return (
    <section className="flex flex-col">
      <button
        onClick={() => setCollapsed((current) => !current)}
        className="flex h-7 items-center gap-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle hover:text-text"
      >
        <Chevron size={12} strokeWidth={2} />
        Stack
        {collapsed && (
          <span className="font-normal normal-case tracking-normal text-text-subtle">
            {lineCount} lines
          </span>
        )}
      </button>
      {!collapsed && (
        <pre className="overflow-x-auto rounded-md border border-border bg-surface-raised p-3 font-mono text-[11px] leading-relaxed text-text-muted">
          {stack}
        </pre>
      )}
    </section>
  );
}

function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        });
      }}
      title={label}
      className="inline-flex h-6 shrink-0 items-center gap-1 rounded border border-border bg-surface-raised px-1.5 text-[10px] text-text-muted hover:text-text"
    >
      {copied ? <Check size={11} strokeWidth={2} /> : <Copy size={11} strokeWidth={1.5} />}
      {label}
    </button>
  );
}

/** Versão colável do log — o que se joga num bug report ou numa LLM. */
function plainText(entry: LogEntry): string {
  const head = `[${formatLogClock(entry.ts)}] ${levelLabel(entry.level)}${
    entry.namespace !== null ? ` ${entry.namespace}` : ""
  } ${entry.message}`;
  const data = entry.args
    .filter((arg) => arg.json !== null)
    .map((arg) => arg.json)
    .join("\n");
  return [head, data, entry.stack].filter((part) => part && part.length > 0).join("\n");
}
