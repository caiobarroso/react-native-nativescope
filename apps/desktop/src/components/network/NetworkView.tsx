import { useLayout } from "../../lib/layout.ts";
import { ResizeHandle } from "../ResizeHandle.tsx";
import { NetworkFilters } from "./NetworkFilters.tsx";
import { NetworkList } from "./NetworkList.tsx";
import { NetworkDetail } from "./NetworkDetail.tsx";

/** Área principal do módulo de Network: filtros + lista (redimensionável) + detalhe. */
export function NetworkView() {
  const width = useLayout((s) => s.panels.networkList.size);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <NetworkFilters />
      <div className="flex min-h-0 min-w-0 flex-1">
        <div className="relative flex min-h-0 shrink-0 flex-col" style={{ width }}>
          <NetworkList />
          <ResizeHandle panelId="networkList" edge="right" />
        </div>
        <NetworkDetail />
      </div>
    </div>
  );
}
