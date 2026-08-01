import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

/**
 * Ancoragem na ponta de uma lista que cresce ao vivo (modelo de terminal).
 *
 * É a primeira do Studio: o Network se esquiva do problema sendo newest-first,
 * então linhas novas nascem no topo e nunca disputam a posição de scroll. Log é
 * cronológico por padrão — sem isto, cada linha nova empurraria a leitura e o
 * painel seria inutilizável ao vivo.
 *
 * Regra: fica ancorado enquanto o usuário está na ponta; ao sair dela ele assume
 * o controle e passamos a contar quantas linhas chegaram, em vez de arrastá-lo
 * de volta. Voltar à ponta reancora sozinho.
 *
 * `edge` existe porque a lista pode ser invertida pelo usuário: em `desc` a
 * linha nova nasce no índice 0, então a ponta a vigiar é o começo.
 */

/** Folga para considerar "na ponta" — scroll suave e zoom raramente batem exato. */
const EDGE_THRESHOLD_PX = 24;

export function useStickToBottom({
  scrollRef,
  count,
  scrollToIndex,
  edge = "end",
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Total de linhas visíveis. Mudou = chegou (ou saiu) log. */
  count: number;
  scrollToIndex: (index: number) => void;
  /** Onde nasce a linha nova: "end" (cronológico) ou "start" (invertido). */
  edge?: "start" | "end";
}): { pinned: boolean; pendingCount: number; scrollToEnd: () => void } {
  const [pinned, setPinned] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const pinnedRef = useRef(true);
  const previousCount = useRef(count);
  const scrollToIndexRef = useRef(scrollToIndex);
  scrollToIndexRef.current = scrollToIndex;

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const handleScroll = (): void => {
      const distance =
        edge === "start"
          ? element.scrollTop
          : element.scrollHeight - element.scrollTop - element.clientHeight;
      const next = distance <= EDGE_THRESHOLD_PX;
      if (pinnedRef.current === next) return;
      pinnedRef.current = next;
      setPinned(next);
      if (next) setPendingCount(0);
    };

    element.addEventListener("scroll", handleScroll, { passive: true });
    return () => element.removeEventListener("scroll", handleScroll);
  }, [scrollRef, edge]);

  // useLayoutEffect e não useEffect: o scroll tem que acontecer no mesmo frame
  // da linha nova, senão pisca a posição antiga antes de descer.
  useLayoutEffect(() => {
    const delta = count - previousCount.current;
    previousCount.current = count;
    if (count === 0) {
      setPendingCount(0);
      return;
    }
    if (pinnedRef.current) {
      scrollToIndexRef.current(edge === "start" ? 0 : count - 1);
      return;
    }
    if (delta > 0) setPendingCount((current) => current + delta);
  }, [count, edge]);

  const scrollToEnd = useCallback(() => {
    pinnedRef.current = true;
    setPinned(true);
    setPendingCount(0);
    if (count > 0) scrollToIndexRef.current(edge === "start" ? 0 : count - 1);
  }, [count, edge]);

  return { pinned, pendingCount, scrollToEnd };
}
