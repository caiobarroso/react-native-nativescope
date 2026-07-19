import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useStudio } from "../lib/store.ts";

const CHANGE_LABEL = {
  created: "criado",
  updated: "atualizado",
  removed: "removido",
} as const;

const CHANGE_COLOR = {
  created: "text-created",
  updated: "text-updated",
  removed: "text-deleted",
} as const;

/**
 * A faixa de Atividade: persistente, dockada, atravessa todos os storages
 * (plano §5.1). Nunca um destino de navegação — está sempre aqui embaixo,
 * como o Console do Chrome DevTools.
 */
export function ActivityStrip() {
  const activity = useStudio((s) => s.activity);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section
      className={`flex shrink-0 flex-col border-t border-border bg-surface ${
        collapsed ? "" : "h-44"
      }`}
    >
      <header className="flex h-8 shrink-0 items-center gap-2 px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          Atividade
        </span>
        {activity.length > 0 && (
          <span className="text-[11px] text-text-subtle">{activity.length}</span>
        )}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="ml-auto rounded p-1 text-text-subtle hover:bg-surface-hover hover:text-text"
          title={collapsed ? "Expandir" : "Recolher"}
        >
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </header>

      {!collapsed && (
        <ol className="flex-1 overflow-y-auto px-1 pb-1">
          {activity.length === 0 && (
            <li className="px-2 py-3 text-text-subtle">
              Mudanças no storage do app aparecem aqui em tempo real.
            </li>
          )}
          {activity.map((item) => (
            <li
              key={item.id}
              className="flex h-7 items-center gap-3 rounded px-2 font-mono text-[12px] hover:bg-surface-hover"
            >
              <time className="shrink-0 tabular-nums text-text-subtle">
                {new Date(item.timestamp).toLocaleTimeString("pt-BR")}
              </time>
              <span className="w-24 shrink-0 truncate text-text-muted">
                {item.providerLabel}
              </span>
              <span className="min-w-0 flex-1 truncate">{item.key}</span>
              <span className={`shrink-0 ${CHANGE_COLOR[item.change]}`}>
                {CHANGE_LABEL[item.change]}
              </span>
              {/* origem: ponto coral preenchido = Studio; neutro = app (§4.4) */}
              <span
                title={item.source === "studio" ? "alterado pelo Studio" : "alterado pelo app"}
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  item.source === "studio" ? "bg-accent" : "bg-text-subtle"
                }`}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
