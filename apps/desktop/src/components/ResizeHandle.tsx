import { useCallback, useEffect, useRef, useState } from "react";
import { PANELS, useLayout, type PanelId } from "../lib/layout.ts";

/**
 * A borda onde o painel encosta no centro. `right`/`left` redimensionam
 * largura; `top` redimensiona altura (a faixa de atividade, dockada embaixo).
 */
type Edge = "right" | "left" | "top";

/**
 * Alça de redimensionar — fina, coral no hover/drag, como o foco (§4).
 * Fica absoluta sobre a borda do painel, então não desloca o layout.
 * Ponteiro com pointer capture (segue o arraste mesmo fora da alça) e
 * teclado (setas, com Shift para passo maior). Duplo-clique reseta.
 */
export function ResizeHandle({ panelId, edge }: { panelId: PanelId; edge: Edge }) {
  const size = useLayout((s) => s.panels[panelId].size);
  const setSize = useLayout((s) => s.setSize);
  const nudge = useLayout((s) => s.nudge);
  const reset = useLayout((s) => s.reset);
  const [dragging, setDragging] = useState(false);
  const start = useRef({ pos: 0, size: 0 });

  const spec = PANELS[panelId];
  const isX = edge !== "top";
  // right cresce ao arrastar para +x; left/top crescem ao arrastar para -.
  const grows = edge === "left" || edge === "top" ? -1 : 1;

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      start.current = { pos: isX ? e.clientX : e.clientY, size };
      setDragging(true);
    },
    [isX, size],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      const now = isX ? e.clientX : e.clientY;
      setSize(panelId, start.current.size + (now - start.current.pos) * grows);
    },
    [dragging, isX, grows, panelId, setSize],
  );

  const end = useCallback((e: React.PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = (e.shiftKey ? 48 : 16) * grows;
      const key = e.key;
      if (isX && (key === "ArrowLeft" || key === "ArrowRight")) {
        e.preventDefault();
        nudge(panelId, key === "ArrowRight" ? step : -step);
      } else if (!isX && (key === "ArrowUp" || key === "ArrowDown")) {
        e.preventDefault();
        // top: ArrowUp aumenta a altura (a alça sobe, a faixa cresce)
        nudge(panelId, key === "ArrowUp" ? -step : step);
      }
    },
    [isX, grows, panelId, nudge],
  );

  // Enquanto arrasta, trava o cursor e a seleção de texto na página inteira.
  useEffect(() => {
    if (!dragging) return;
    const { style } = document.body;
    const prevCursor = style.cursor;
    const prevSelect = style.userSelect;
    style.cursor = isX ? "col-resize" : "row-resize";
    style.userSelect = "none";
    return () => {
      style.cursor = prevCursor;
      style.userSelect = prevSelect;
    };
  }, [dragging, isX]);

  const position =
    edge === "right"
      ? "right-0 top-0 h-full w-1.5 translate-x-1/2"
      : edge === "left"
        ? "left-0 top-0 h-full w-1.5 -translate-x-1/2"
        : "left-0 top-0 w-full h-1.5 -translate-y-1/2";

  const line = isX
    ? "inset-y-0 left-1/2 w-px -translate-x-1/2"
    : "inset-x-0 top-1/2 h-px -translate-y-1/2";

  return (
    <div
      role="separator"
      aria-orientation={isX ? "vertical" : "horizontal"}
      aria-label="Resize panel"
      aria-valuenow={size}
      aria-valuemin={spec.min}
      aria-valuemax={spec.max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => reset(panelId)}
      onKeyDown={onKeyDown}
      title="Drag to resize · double-click to reset"
      className={`group absolute z-20 touch-none ${position} ${
        isX ? "cursor-col-resize" : "cursor-row-resize"
      }`}
    >
      <span
        className={`pointer-events-none absolute rounded-full transition-colors ${line} ${
          dragging ? "bg-accent" : "bg-transparent group-hover:bg-accent/60"
        }`}
      />
    </div>
  );
}
