import { useState } from "react";
import { Flag, Pause, Play, Trash2 } from "lucide-react";
import { useLogs } from "../../lib/logs-store.ts";
import { ConfirmDialog } from "../ConfirmDialog.tsx";

/**
 * Controles de captura do módulo. Ficam no fim da barra de filtros, e não no
 * Header — a convenção estabelecida pelo Network é que a chrome do módulo vive
 * dentro da view do módulo.
 */
export function LogsCaptureControls() {
  const paused = useLogs((s) => s.capturePaused);
  const setCapturePaused = useLogs((s) => s.setCapturePaused);
  const mark = useLogs((s) => s.mark);
  const markedSeq = useLogs((s) => s.markedSeq);
  const clearEntries = useLogs((s) => s.clearEntries);
  const entryCount = useLogs((s) => s.entries.length);
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <div className="ml-auto flex shrink-0 items-center gap-1">
      <button
        onClick={mark}
        title="Drop a marker on the timeline and focus on what comes next"
        className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] ${
          markedSeq !== null
            ? "border-accent bg-accent-wash text-accent"
            : "border-border bg-surface-raised text-text-muted hover:text-text"
        }`}
      >
        <Flag size={12} strokeWidth={1.5} />
        Mark
      </button>

      <button
        onClick={() => setCapturePaused(!paused)}
        title={paused ? "Resume capture" : "Pause capture"}
        className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] ${
          paused
            ? "border-accent bg-accent-wash text-accent"
            : "border-border bg-surface-raised text-text-muted hover:text-text"
        }`}
      >
        {paused ? <Play size={12} strokeWidth={1.5} /> : <Pause size={12} strokeWidth={1.5} />}
        {paused ? "Resume" : "Pause"}
      </button>

      {entryCount > 0 && (
        <button
          onClick={() => setConfirmClear(true)}
          title="Clear all captured logs"
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface-raised px-2 text-[11px] text-text-muted hover:text-text"
        >
          <Trash2 size={12} strokeWidth={1.5} />
          Clear
        </button>
      )}

      {confirmClear && (
        <ConfirmDialog
          title="Clear captured logs?"
          description="This removes every log captured so far in this Studio session. The app keeps running untouched."
          confirmLabel="Clear logs"
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            clearEntries();
            setConfirmClear(false);
          }}
        />
      )}
    </div>
  );
}
