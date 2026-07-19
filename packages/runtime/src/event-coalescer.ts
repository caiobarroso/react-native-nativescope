/**
 * Coalescing de eventos (plano de grandes volumes §A4, ADR-0001).
 *
 * Um app write-heavy pode escrever milhares de vezes por segundo na mesma
 * chave/tabela. Encaminhar cada escrita como um evento WS individual
 * afogaria o transporte e o Studio. Estratégia leading + trailing:
 *
 * - a PRIMEIRA mudança de uma chave sai imediatamente (realtime preservado);
 * - mudanças seguintes dentro da janela são fundidas: ao fechar a janela sai
 *   UM evento com o estado mais recente e `coalescedCount` dizendo quantas
 *   mudanças ele representa — a timeline nunca mente sobre a quantidade.
 *
 * Backpressure: o mapa de pendentes tem teto; estourou, flush imediato.
 * Memória O(chaves distintas na janela), sempre limitada.
 */

const DEFAULT_WINDOW_MS = 100;
const DEFAULT_MAX_PENDING = 500;

export interface Coalescer<T> {
  push(key: string, item: T): void;
  /** Entrega tudo que está pendente agora (usado nos testes e no teto). */
  flush(): void;
}

export function createCoalescer<T>(
  deliver: (item: T, coalescedCount: number) => void,
  options?: { windowMs?: number; maxPending?: number },
): Coalescer<T> {
  const windowMs = options?.windowMs ?? DEFAULT_WINDOW_MS;
  const maxPending = options?.maxPending ?? DEFAULT_MAX_PENDING;

  /** count 0 = janela aberta sem trailing (o leading já saiu). */
  const pending = new Map<string, { latest: T | null; count: number }>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const entries = [...pending.entries()];
    pending.clear();
    for (const [, entry] of entries) {
      if (entry.count > 0 && entry.latest !== null) {
        deliver(entry.latest, entry.count);
      }
    }
  }

  function scheduleFlush(): void {
    if (timer === null) {
      timer = setTimeout(flush, windowMs);
    }
  }

  return {
    push(key, item) {
      const entry = pending.get(key);
      if (entry) {
        entry.latest = item;
        entry.count += 1;
        return;
      }
      // Leading edge: a primeira mudança é realtime de verdade.
      deliver(item, 1);
      pending.set(key, { latest: null, count: 0 });
      scheduleFlush();
      if (pending.size >= maxPending) flush();
    },
    flush,
  };
}
