import { useLayout } from "../../lib/layout.ts";
import { ResizeHandle } from "../ResizeHandle.tsx";
import { LogsFilters } from "./LogsFilters.tsx";
import { LogsList } from "./LogsList.tsx";
import { LogDetail } from "./LogDetail.tsx";

/** Área principal do módulo de Logs: filtros + lista (redimensionável) + detalhe. */
export function LogsView() {
  const width = useLayout((s) => s.panels.logsList.size);
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <LogsFilters />
      <div className="flex min-h-0 min-w-0 flex-1">
        <div className="relative flex min-h-0 shrink-0 flex-col" style={{ width }}>
          <LogsList />
          <ResizeHandle panelId="logsList" edge="right" />
        </div>
        <LogDetail />
      </div>
    </div>
  );
}
