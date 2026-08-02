import { useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, Clock, Flag, Globe, PlayCircle, ScrollText } from "lucide-react";
import { useLogs } from "../../lib/logs-store.ts";
import { useNetwork } from "../../lib/network-store.ts";
import { useTimeline } from "../../lib/timeline-store.ts";
import { collectAnchors, type TimelineAnchor } from "../../lib/timeline-select.ts";
import { formatLogClock } from "../logs/format.ts";
import { TimelineStory } from "./TimelineStory.tsx";

/**
 * Tela de escolha de momento — o empty state que também é o tutorial.
 *
 * A Timeline é a única superfície do Studio que não tem equivalente em nenhuma
 * outra ferramenta, então ela não pode contar com o usuário já saber o que é.
 * Por isso a história em loop vem ligada por padrão aqui (mesmo idioma do
 * "How it works" dos Snapshots) e sai do caminho com um clique.
 *
 * A regra de ouro continua: nunca se chega na Timeline sem escopo. Aqui você
 * escolhe um momento, e a Timeline se monta em volta dele.
 */
export function TimelineAnchors() {
  const logs = useLogs((s) => s.entries);
  const markedAt = useLogs((s) => s.markedAt);
  const requests = useNetwork((s) => s.requests);
  const open = useTimeline((s) => s.open);
  const origin = useTimeline((s) => s.origin);
  const goBack = useTimeline((s) => s.goBack);
  const [showStory, setShowStory] = useState(true);

  const anchors = useMemo(
    () => collectAnchors({ logs, requests, markedAt }),
    [logs, requests, markedAt],
  );

  const marks = anchors.filter((anchor) => anchor.kind === "mark");
  const errors = anchors.filter((anchor) => anchor.kind === "error");
  const failed = anchors.filter((anchor) => anchor.kind === "request");
  const originLabel = origin?.module === "logs" ? "Logs" : origin?.module === "network" ? "Network" : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-border bg-surface-sunken px-3">
        {originLabel !== null && (
          <button
            onClick={goBack}
            title={`Return to ${originLabel}`}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border bg-surface-raised px-2 text-[11px] text-text-muted hover:text-text"
          >
            <ArrowLeft size={12} strokeWidth={1.5} />
            Back to {originLabel}
          </button>
        )}
        <Clock size={14} strokeWidth={1.5} className="shrink-0 text-text-subtle" />
        <div className="min-w-0">
          <h2 className="text-[12px] font-semibold leading-tight text-text">Timeline</h2>
          <p className="text-[11px] leading-tight text-text-subtle">
            Logs, requests and storage writes around one moment
          </p>
        </div>
        <button
          onClick={() => setShowStory((current) => !current)}
          title="What this screen is for"
          className={`ml-auto flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] ${
            showStory ? "text-accent" : "text-text-subtle hover:text-text"
          }`}
        >
          <PlayCircle size={13} strokeWidth={1.5} />
          How it works
        </button>
      </div>

      {/*
        `safe center` e não `center` puro: quando o conteúdo passa da altura da
        janela, o centro puro cortaria o topo (e o topo é onde a história
        começa). Com `safe`, ele degrada para alinhamento no início e a rolagem
        funciona normal.
      */}
      <div
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
        style={{ justifyContent: "safe center" }}
      >
        <div className="mx-auto flex w-full max-w-[880px] flex-col gap-7 px-8 py-10">
          {showStory && <TimelineStory />}

          {anchors.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-[12px] text-text-subtle">
              No moment to open yet. Drop a <strong className="font-semibold">Mark</strong> in Logs
              before doing something in your app — or wait for an error or failed request to show up
              here on its own. To investigate a regular log, open Timeline directly from that log.
            </p>
          ) : (
            <>
              <AnchorGroup title="Marks" anchors={marks} onOpen={open} />
              <AnchorGroup title="Recent errors" anchors={errors} onOpen={open} />
              <AnchorGroup title="Failed requests" anchors={failed} onOpen={open} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AnchorGroup({
  title,
  anchors,
  onOpen,
}: {
  title: string;
  anchors: TimelineAnchor[];
  onOpen: (anchor: TimelineAnchor) => void;
}) {
  if (anchors.length === 0) return null;
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
        {title}
      </h3>
      <ul className="flex flex-col gap-1">
        {anchors.map((anchor) => (
          <li key={anchor.id}>
            <button
              onClick={() => onOpen(anchor)}
              className="flex w-full items-center gap-2 rounded-md border border-border bg-surface-raised px-3 py-2 text-left transition-colors hover:border-accent hover:bg-accent-wash"
            >
              <AnchorIcon kind={anchor.kind} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[11px] text-text">
                  {anchor.label}
                </span>
                {anchor.detail !== null && (
                  <span className="block truncate text-[10px] text-text-subtle">
                    {anchor.detail}
                  </span>
                )}
              </span>
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-text-subtle">
                {formatLogClock(anchor.ts)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AnchorIcon({ kind }: { kind: TimelineAnchor["kind"] }) {
  if (kind === "mark") {
    return <Flag size={13} strokeWidth={1.5} className="shrink-0 text-accent" />;
  }
  if (kind === "error") {
    return <AlertCircle size={13} strokeWidth={1.5} className="shrink-0 text-deleted" />;
  }
  if (kind === "log") {
    return <ScrollText size={13} strokeWidth={1.5} className="shrink-0 text-text-subtle" />;
  }
  return <Globe size={13} strokeWidth={1.5} className="shrink-0 text-deleted" />;
}
