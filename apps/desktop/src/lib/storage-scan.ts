/**
 * Motor da visão geral: varre o metadado da instância e agrega POR TAMANHO,
 * num acumulador de tamanho fixo. A garantia central de fluidez mora aqui —
 * o redutor nunca segura o dataset; ele dobra cada chave em contadores
 * limitados (Map de namespaces, histograma por tipo, top-N min-heap simples,
 * totais) e esquece a entry. Dá igual pra 1 mil ou 10 milhões de chaves:
 * memória O(nº de namespaces distintos), não O(nº de chaves).
 *
 * O redutor é puro e testável em isolamento; runStorageScan só o costura ao
 * scanAllKeys do cliente.
 */
import {
  scanAllKeys,
  type ScanEntry,
  type ScanPageMeta,
} from "./studio-client.ts";
import { deriveNamespace } from "./namespace.ts";

export interface NamespaceStat {
  label: string;
  /** Prefixo literal para o drill (vazio = drill desabilitado). */
  prefix: string;
  /** Primeira chave vista no grupo; usada para abrir namespaces de item único. */
  sampleKey: string;
  count: number;
  bytes: number;
}

export interface TypeStat {
  type: string;
  count: number;
  bytes: number;
}

export interface TopKey {
  key: string;
  valueType: string;
  bytes: number;
}

export interface StorageReport {
  /** Chaves efetivamente varridas e dobradas no relatório. */
  totalKeys: number;
  /** Soma dos approxSize (aproximado — o nome do campo não mente). */
  totalBytes: number;
  namespaces: NamespaceStat[];
  types: TypeStat[];
  topKeys: TopKey[];
  /** true quando havia mais namespaces que o teto e o resto virou «outros». */
  truncatedNamespaces: boolean;
  /** true quando a varredura cobriu tudo (não cancelada, não travada no teto). */
  complete: boolean;
  /** Total anunciado pelo device — pode ser > totalKeys num scan parcial. */
  total: number;
}

export interface ScanProgress {
  scanned: number;
  total: number;
}

/** Teto de namespaces distintos rastreados; o excedente cai em «outros». */
const MAX_NAMESPACES = 4000;
/** Quantas chaves individuais mais pesadas guardar. */
const TOP_N = 20;
const OVERFLOW_LABEL = "«outros»";

export interface StorageReducer {
  add(entry: ScanEntry): void;
  count(): number;
  snapshot(meta: { complete: boolean; total: number }): StorageReport;
}

export function createStorageReducer(): StorageReducer {
  const namespaces = new Map<string, NamespaceStat>();
  const types = new Map<string, TypeStat>();
  const topKeys: TopKey[] = []; // ordenado desc por bytes, no máximo TOP_N
  let totalKeys = 0;
  let totalBytes = 0;
  let truncated = false;

  function bumpNamespace(entry: ScanEntry): void {
    const { label, prefix } = deriveNamespace(entry.key);
    let stat = namespaces.get(label);
    if (stat === undefined) {
      if (namespaces.size >= MAX_NAMESPACES) {
        // Estourou o teto: agrega no balde «outros» em vez de crescer sem fim.
        truncated = true;
        stat = namespaces.get(OVERFLOW_LABEL);
        if (stat === undefined) {
          stat = { label: OVERFLOW_LABEL, prefix: "", sampleKey: entry.key, count: 0, bytes: 0 };
          namespaces.set(OVERFLOW_LABEL, stat);
        }
      } else {
        stat = { label, prefix, sampleKey: entry.key, count: 0, bytes: 0 };
        namespaces.set(label, stat);
      }
    }
    stat.count += 1;
    stat.bytes += entry.approxSize;
  }

  function bumpType(entry: ScanEntry): void {
    let stat = types.get(entry.valueType);
    if (stat === undefined) {
      stat = { type: entry.valueType, count: 0, bytes: 0 };
      types.set(entry.valueType, stat);
    }
    stat.count += 1;
    stat.bytes += entry.approxSize;
  }

  function offerTopKey(entry: ScanEntry): void {
    const full = topKeys.length >= TOP_N;
    // Rejeição barata: se já está cheio e não bate o menor, nem insere.
    if (full && entry.approxSize <= (topKeys[topKeys.length - 1] as TopKey).bytes) return;
    const candidate: TopKey = {
      key: entry.key,
      valueType: entry.valueType,
      bytes: entry.approxSize,
    };
    let i = topKeys.length;
    while (i > 0 && (topKeys[i - 1] as TopKey).bytes < candidate.bytes) i -= 1;
    topKeys.splice(i, 0, candidate);
    if (topKeys.length > TOP_N) topKeys.pop();
  }

  return {
    add(entry) {
      totalKeys += 1;
      totalBytes += entry.approxSize;
      bumpNamespace(entry);
      bumpType(entry);
      offerTopKey(entry);
    },
    count() {
      return totalKeys;
    },
    snapshot(meta) {
      return {
        totalKeys,
        totalBytes,
        namespaces: [...namespaces.values()],
        types: [...types.values()],
        topKeys: [...topKeys],
        truncatedNamespaces: truncated,
        complete: meta.complete,
        total: meta.total,
      };
    },
  };
}

/**
 * Roda uma varredura completa e devolve o relatório agregado. O fold acontece
 * a cada página (barato, O(página)); o round-trip do WebSocket é o yield entre
 * páginas. Cancelável e com progresso.
 */
export async function runStorageScan(
  providerId: string,
  instanceId: string,
  opts?: { signal?: AbortSignal; onProgress?: (p: ScanProgress) => void },
): Promise<StorageReport> {
  const reducer = createStorageReducer();
  let total = 0;
  const onPage = (entries: ScanEntry[], meta: ScanPageMeta): void => {
    total = meta.total;
    for (const entry of entries) reducer.add(entry);
    opts?.onProgress?.({ scanned: reducer.count(), total });
  };
  const result = await scanAllKeys(
    providerId,
    instanceId,
    onPage,
    opts?.signal ? { signal: opts.signal } : undefined,
  );
  return reducer.snapshot({ complete: result.complete, total: result.total || total });
}
