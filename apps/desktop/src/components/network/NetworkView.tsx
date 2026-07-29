import { Radio } from "lucide-react";
import { useNetwork } from "../../lib/network-store.ts";
import { useLayout } from "../../lib/layout.ts";
import { ResizeHandle } from "../ResizeHandle.tsx";
import { NetworkFilters } from "./NetworkFilters.tsx";
import { NetworkList } from "./NetworkList.tsx";
import { NetworkDetail } from "./NetworkDetail.tsx";

/** Área principal do módulo de Network: filtros + lista (redimensionável) + detalhe. */
export function NetworkView() {
  const width = useLayout((s) => s.panels.networkList.size);
  const requestCount = useNetwork((s) => s.requests.length);
  const paused = useNetwork((s) => s.capturePaused);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <NetworkFilters />
      {requestCount === 0 ? (
        <NetworkEmptyState paused={paused} />
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1">
          <div
            className="relative flex min-h-0 shrink-0 flex-col"
            style={{ width }}
          >
            <NetworkList />
            <ResizeHandle panelId="networkList" edge="right" />
          </div>
          <NetworkDetail />
        </div>
      )}
    </div>
  );
}

function NetworkEmptyState({ paused }: { paused: boolean }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center border-t border-border px-6 py-12 text-center">
      <div className="flex max-w-[320px] flex-col items-center gap-2">
        <Radio size={22} strokeWidth={1.5} className="text-text-subtle" />
        <p className="text-[13px] font-medium text-text-muted">
          {paused
            ? "Network capture is paused"
            : "Waiting for network activity"}
        </p>
        <p className="text-[11px] leading-relaxed text-text-subtle">
          {paused
            ? "Resume capture when you are ready to record new requests."
            : "Make a fetch or XHR request in your app and it will appear here, newest first."}
        </p>
      </div>
    </div>
  );
}
