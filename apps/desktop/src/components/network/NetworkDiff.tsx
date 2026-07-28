import { useMemo, useState } from "react";
import { GitCompare, X } from "lucide-react";
import type { NetworkRequest } from "@rnsi/protocol";
import { createValueInlineDiff, type JsonDiffSegment } from "../../lib/json-diff.ts";
import { diffJson, parseBody, shortValue, type FieldDiff } from "../../lib/network-diff.ts";
import { formatBytes, formatDuration, statusColorClass, statusLabel } from "./format.ts";

type DiffMode = "changes" | "side";

export function NetworkDiff({
  a,
  b,
  onClose,
}: {
  a: NetworkRequest;
  b: NetworkRequest;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<DiffMode>("changes");
  // Ordena cronologicamente: mais antigo = "before", mais novo = "after".
  const [before, after] = a.startedAt <= b.startedAt ? [a, b] : [b, a];

  const bodyBefore = useMemo(() => parseBody(before.responseBody?.text), [before]);
  const bodyAfter = useMemo(() => parseBody(after.responseBody?.text), [after]);
  const bodyDiffs = useMemo(() => diffJson(bodyBefore, bodyAfter), [bodyBefore, bodyAfter]);
  const headerDiffs = useMemo(
    () => diffJson(before.responseHeaders, after.responseHeaders),
    [before, after],
  );
  const inline = useMemo(
    () => (mode === "side" ? createValueInlineDiff(bodyBefore, bodyAfter) : null),
    [mode, bodyBefore, bodyAfter],
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col border-l border-border">
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-3 py-2.5">
        <GitCompare size={14} strokeWidth={1.5} className="text-accent" />
        <span className="font-mono text-[12px] font-semibold text-text">Diff</span>
        <span className="min-w-0 truncate font-mono text-[11px] text-text-muted">{before.path}</span>
        <button
          onClick={onClose}
          title="Close diff"
          className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded text-text-subtle hover:bg-surface-hover hover:text-text"
        >
          <X size={15} strokeWidth={1.5} />
        </button>
      </div>

      <MetaCompare before={before} after={after} />

      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-surface-sunken px-2">
        <ModeTab active={mode === "changes"} onClick={() => setMode("changes")}>
          Only changes
        </ModeTab>
        <ModeTab active={mode === "side"} onClick={() => setMode("side")}>
          Side by side
        </ModeTab>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
        {headerDiffs.length > 0 && (
          <Section title={`Headers · ${headerDiffs.length} changed`}>
            <FieldDiffList diffs={headerDiffs} />
          </Section>
        )}

        <Section title="Response body">
          {mode === "changes" ? (
            bodyDiffs.length === 0 ? (
              <p className="text-[12px] text-text-subtle">Identical response body.</p>
            ) : (
              <FieldDiffList diffs={bodyDiffs} />
            )
          ) : inline ? (
            <div className="grid grid-cols-2 gap-2">
              <SidePanel label={`before · ${formatDuration(before.duration)}`} segments={inline.before} />
              <SidePanel label={`after · ${formatDuration(after.duration)}`} segments={inline.after} />
            </div>
          ) : (
            <p className="text-[12px] text-text-subtle">
              {bodyDiffs.length === 0 ? "Identical response body." : "Bodies are not both JSON."}
            </p>
          )}
        </Section>
      </div>
    </div>
  );
}

function MetaCompare({ before, after }: { before: NetworkRequest; after: NetworkRequest }) {
  const rows: Array<{ label: string; before: string; after: string; changed: boolean; colorBefore?: string; colorAfter?: string }> = [
    {
      label: "Status",
      before: statusLabel(before),
      after: statusLabel(after),
      changed: before.status !== after.status,
      colorBefore: statusColorClass(before),
      colorAfter: statusColorClass(after),
    },
    {
      label: "Time",
      before: formatDuration(before.duration),
      after: formatDuration(after.duration),
      changed: before.duration !== after.duration,
    },
    {
      label: "Size",
      before: formatBytes(before.responseSize),
      after: formatBytes(after.responseSize),
      changed: before.responseSize !== after.responseSize,
    },
  ];
  return (
    <div className="shrink-0 border-b border-border px-3 py-2">
      <div className="overflow-hidden rounded-md border border-border">
        {rows.map((row, index) => (
          <div
            key={row.label}
            className={`flex items-center gap-2 px-2 py-1 text-[11px] ${index > 0 ? "border-t border-border/60" : ""}`}
          >
            <span className="w-14 shrink-0 text-text-subtle">{row.label}</span>
            <span className={`flex-1 text-right font-mono ${row.colorBefore ?? "text-text-muted"}`}>{row.before}</span>
            <span className="shrink-0 text-text-subtle">→</span>
            <span
              className={`flex-1 font-mono ${row.changed ? "font-semibold" : ""} ${row.colorAfter ?? (row.changed ? "text-text" : "text-text-muted")}`}
            >
              {row.after}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FieldDiffList({ diffs }: { diffs: FieldDiff[] }) {
  return (
    <div className="flex flex-col gap-1 font-mono text-[11px]">
      {diffs.map((diff, index) => (
        <div key={`${diff.path}-${index}`} className="rounded border border-border/60 bg-surface-raised px-2 py-1">
          <div className="mb-0.5 flex items-center gap-1.5">
            <span
              className={
                diff.kind === "added"
                  ? "text-created"
                  : diff.kind === "removed"
                    ? "text-deleted"
                    : "text-updated"
              }
            >
              {diff.kind === "added" ? "+" : diff.kind === "removed" ? "−" : "~"}
            </span>
            <span className="min-w-0 break-all text-text-muted">{diff.path}</span>
          </div>
          {diff.kind !== "added" && (
            <div className="flex gap-1 break-all text-deleted">
              <span className="shrink-0 select-none text-text-subtle">−</span>
              {shortValue(diff.before)}
            </div>
          )}
          {diff.kind !== "removed" && (
            <div className="flex gap-1 break-all text-created">
              <span className="shrink-0 select-none text-text-subtle">+</span>
              {shortValue(diff.after)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function SidePanel({ label, segments }: { label: string; segments: JsonDiffSegment[] }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-border">
      <div className="border-b border-border bg-surface-sunken px-2 py-1 text-[10px] uppercase tracking-wide text-text-subtle">
        {label}
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all p-2 font-mono text-[11px] leading-relaxed text-text-muted">
        {segments.map((segment, index) => (
          <span
            key={index}
            className={segment.changed ? "rounded bg-accent-wash text-accent" : undefined}
          >
            {segment.text}
          </span>
        ))}
      </pre>
    </div>
  );
}

function ModeTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-2.5 py-1 text-[12px] font-medium ${
        active ? "bg-surface-raised text-text shadow-sm" : "text-text-muted hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-subtle">{title}</h3>
      {children}
    </section>
  );
}
