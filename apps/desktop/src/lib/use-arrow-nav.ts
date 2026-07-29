import { useEffect, useRef } from "react";

/** Item selecionável na ordem de exibição + o índice pra rolar até ele. */
export interface ArrowNavItem {
  id: string;
  /** Índice no virtualizer (pode diferir da posição em `items` quando a lista
   *  tem linhas não-selecionáveis, ex.: cabeçalhos de grupo no network). */
  index: number;
}

/**
 * Navegação por teclado (↑/↓) numa lista selecionável — o padrão de devtool
 * (a aba Network do Chrome DevTools faz igual). Um único listener global que:
 *  - ignora quando o foco está num campo editável (input/textarea/CodeMirror);
 *  - ignora com modificadores ou quando `enabled` é falso (overlay aberto etc.);
 *  - move a seleção pro item anterior/seguinte e rola ele pra dentro da viewport.
 *
 * Usa uma ref pro estado mais recente, então o listener é registrado uma vez só.
 */
export function useArrowNav({
  enabled,
  items,
  selectedId,
  onSelect,
  scrollToIndex,
}: {
  enabled: boolean;
  items: ArrowNavItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  scrollToIndex: (index: number) => void;
}): void {
  const latest = useRef({ enabled, items, selectedId, onSelect, scrollToIndex });
  latest.current = { enabled, items, selectedId, onSelect, scrollToIndex };

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const state = latest.current;
      if (!state.enabled) return;
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;

      // Não sequestra as setas enquanto o usuário digita/edita.
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el?.isContentEditable
      ) {
        return;
      }

      const { items, selectedId, onSelect, scrollToIndex } = state;
      if (items.length === 0) return;

      const current = items.findIndex((item) => item.id === selectedId);
      const next =
        current === -1
          ? event.key === "ArrowDown"
            ? 0
            : items.length - 1
          : event.key === "ArrowDown"
            ? Math.min(current + 1, items.length - 1)
            : Math.max(current - 1, 0);

      event.preventDefault(); // sem isto a viewport rolaria junto com a seleção
      if (next === current) return;
      const target = items[next];
      if (!target) return;
      onSelect(target.id);
      scrollToIndex(target.index);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
