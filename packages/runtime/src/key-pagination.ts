/**
 * Paginação por cursor sobre nomes de chave (plano de grandes volumes, §A1).
 *
 * A enumeração de nomes é o único primitivo barato que todo provider
 * key-value oferece (getAllKeys devolve só strings). A janela é recortada
 * AQUI, antes de qualquer leitura de valor — ler valores custa I/O e
 * memória, então só a página pedida é materializada.
 *
 * Ordenação por comparação UTF-16 pura (`<`), não localeCompare: o cursor
 * precisa ser determinístico entre chamadas e independente de locale.
 */

export const DEFAULT_KEY_PAGE_LIMIT = 200;
export const MAX_KEY_PAGE_LIMIT = 500;

/** Lotes de leitura de valor: entre um e outro, a JS thread respira. */
export const KEY_READ_BATCH = 50;

export interface KeyPageWindow {
  /** Chaves da página, já ordenadas. */
  pageKeys: string[];
  /** Cursor para a próxima página; null quando esta é a última. */
  nextAfterKey: string | null;
  /** Total de chaves na instância. */
  total: number;
}

export interface KeyPageOptions {
  afterKey?: string;
  limit?: number;
}

export function pageOfKeys(keys: readonly string[], options?: KeyPageOptions): KeyPageWindow {
  const sorted = [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const limit = Math.min(Math.max(options?.limit ?? DEFAULT_KEY_PAGE_LIMIT, 1), MAX_KEY_PAGE_LIMIT);

  // Primeiro índice com chave > afterKey (busca binária — 1M de chaves ok).
  let start = 0;
  const after = options?.afterKey;
  if (after !== undefined) {
    let low = 0;
    let high = sorted.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if ((sorted[mid] as string) <= after) low = mid + 1;
      else high = mid;
    }
    start = low;
  }

  const pageKeys = sorted.slice(start, start + limit);
  return {
    pageKeys,
    nextAfterKey:
      start + pageKeys.length < sorted.length
        ? (pageKeys[pageKeys.length - 1] ?? null)
        : null,
    total: sorted.length,
  };
}

/**
 * Devolve o controle ao event loop. Usado entre lotes de leitura para que
 * o inspector nunca segure a JS thread do app por mais que uma fatia curta.
 */
export function breathe(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
