import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Radio } from "lucide-react";
import { useNetwork } from "../../lib/network-store.ts";
import {
  endpointLabel,
  formatBytes,
  formatDuration,
  methodColorClass,
  statusColorClass,
  statusLabel,
} from "./format.ts";

const ROW_HEIGHT = 40;

export function NetworkList() {
  const requests = useNetwork((s) => s.requests);
  const selectedId = useNetwork((s) => s.selectedId);
  const select = useNetwork((s) => s.select);
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: requests.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 14,
  });

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-surface-sunken px-3 text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
        <span className="w-12 shrink-0">Method</span>
        <span className="min-w-0 flex-1">Endpoint</span>
        <span className="w-10 shrink-0 text-right">Status</span>
        <span className="w-16 shrink-0 text-right">Time</span>
        <span className="w-16 shrink-0 text-right">Size</span>
      </div>

      {requests.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <Radio size={22} strokeWidth={1.5} className="text-text-subtle" />
          <p className="text-[13px] text-text-muted">Waiting for requests…</p>
          <p className="max-w-[260px] text-[11px] text-text-subtle">
            Every fetch / XHR the app makes shows up here, newest first.
          </p>
        </div>
      ) : (
        <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const request = requests[item.index]!;
              const active = request.id === selectedId;
              return (
                <button
                  key={request.id}
                  onClick={() => select(request.id)}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: ROW_HEIGHT,
                    transform: `translateY(${item.start}px)`,
                  }}
                  className={`flex items-center gap-2 border-b border-border/60 px-3 text-left text-[12px] ${
                    active ? "bg-accent-wash" : "hover:bg-surface-hover"
                  }`}
                >
                  <span
                    className={`w-12 shrink-0 font-mono text-[10px] font-bold uppercase ${methodColorClass(request.method)}`}
                  >
                    {request.method}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-text" title={endpointLabel(request)}>
                    {endpointLabel(request)}
                  </span>
                  <span
                    className={`w-10 shrink-0 text-right font-mono text-[11px] font-semibold ${statusColorClass(request)}`}
                  >
                    {statusLabel(request)}
                  </span>
                  <span className="w-16 shrink-0 text-right font-mono text-[11px] text-text-muted">
                    {formatDuration(request.duration)}
                  </span>
                  <span className="w-16 shrink-0 text-right font-mono text-[11px] text-text-subtle">
                    {formatBytes(request.responseSize)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
