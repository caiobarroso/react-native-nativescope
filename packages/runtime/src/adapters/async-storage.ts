import type { KeyEntry, StorageValue, ChangeSource } from "@rnsi/protocol";
import type { KeyValueAdapter, KeyValueChange } from "../adapter.ts";
import {
  KEY_READ_BATCH,
  breathe,
  pageOfSortedKeys,
  sortKeys,
} from "../key-pagination.ts";

/**
 * Interface mínima do AsyncStorage que o adapter precisa. Igual à API real —
 * o shim passa o módulo verdadeiro; os testes passam o fake do testkit.
 */
export interface AsyncStorageApi {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
  multiGet(keys: readonly string[]): Promise<ReadonlyArray<[string, string | null]>>;
}

const PREVIEW_MAX = 120;
const ECHO_TTL_MS = 500;
const INSTANCE_ID = "default";
const PENDING_WRITE_LIMIT = 2_000;

/** Tudo no AsyncStorage é string; JSON é inferido pelo conteúdo. */
function classify(raw: string): { type: "string" | "json"; value: string } {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return { type: "json", value: raw };
    } catch {
      /* string mesmo */
    }
  }
  return { type: "string", value: raw };
}

function toEntry(key: string, raw: string, lean = false): KeyEntry {
  const { type } = classify(raw);
  return {
    key,
    valueType: type,
    approxSize: raw.length,
    preview: lean ? "" : raw.length > PREVIEW_MAX ? `${raw.slice(0, PREVIEW_MAX)}…` : raw,
  };
}

function serialize(value: StorageValue): string {
  switch (value.type) {
    case "string":
    case "json":
      return value.value;
    case "number":
    case "boolean":
      return String(value.value);
    case "null":
      return "";
    case "buffer":
      return value.value;
  }
}

export interface AsyncStorageAdapter extends KeyValueAdapter {
  /**
   * Chamado pelo shim quando o APP escreve. O adapter resolve a origem
   * (eco de escrita do Studio vs. escrita genuína do app) e emite o evento.
   */
  notifyAppWrite(key: string, kind: "set" | "removed"): Promise<void>;
}

export function createAsyncStorageAdapter(storage: AsyncStorageApi): AsyncStorageAdapter {
  const listeners = new Set<(change: KeyValueChange) => void>();

  /** Chaves que o adapter conhece — para distinguir created de updated. */
  const knownKeys = new Set<string>();
  let primed = false;
  let sortedKeys: string[] | null = null;

  /** Supressão de eco (plano §3.4): escritas do Studio pendentes por chave. */
  const pendingStudioWrites = new Map<string, number>();

  function assertInstance(instanceId: string): void {
    if (instanceId !== INSTANCE_ID) {
      throw new Error(`unknown instance: ${instanceId}`);
    }
  }

  async function refreshKnownKeys(): Promise<void> {
    const keys = await storage.getAllKeys();
    knownKeys.clear();
    for (const key of keys) knownKeys.add(key);
    sortedKeys = sortKeys(keys);
    primed = true;
  }

  async function primeKnownKeys(): Promise<void> {
    if (!primed) await refreshKnownKeys();
  }

  function keyIndex(): string[] {
    if (sortedKeys === null) sortedKeys = sortKeys([...knownKeys]);
    return sortedKeys;
  }

  /**
   * Consumo síncrono do pendente. PRECISA ser a primeira coisa que o
   * notifyAppWrite faz (sem await antes) — é o que torna a supressão de eco
   * determinística: escrita do Studio emite exatamente uma vez, via set(),
   * e o eco da instrumentação é engolido aqui.
   */
  function consumeStudioEcho(key: string): boolean {
    const expiresAt = pendingStudioWrites.get(key);
    if (expiresAt !== undefined) {
      pendingStudioWrites.delete(key);
      if (Date.now() < expiresAt) return true;
    }
    return false;
  }

  function markStudioWrite(key: string): void {
    const now = Date.now();
    for (const [pendingKey, expiresAt] of pendingStudioWrites) {
      if (expiresAt <= now) pendingStudioWrites.delete(pendingKey);
    }
    pendingStudioWrites.delete(key);
    pendingStudioWrites.set(key, now + ECHO_TTL_MS);
    while (pendingStudioWrites.size > PENDING_WRITE_LIMIT) {
      const oldest = pendingStudioWrites.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      pendingStudioWrites.delete(oldest);
    }
  }

  function emit(change: KeyValueChange): void {
    for (const listener of listeners) listener(change);
  }

  async function emitWrite(key: string, source: ChangeSource): Promise<void> {
    const raw = await storage.getItem(key);
    if (raw === null) return;
    const change: KeyValueChange = {
      key,
      change: knownKeys.has(key) ? "updated" : "created",
      source,
      entry: toEntry(key, raw),
    };
    if (!knownKeys.has(key)) sortedKeys = null;
    knownKeys.add(key);
    emit(change);
  }

  function emitRemove(key: string, source: ChangeSource): void {
    if (!knownKeys.has(key)) return;
    knownKeys.delete(key);
    sortedKeys = null;
    emit({ key, change: "removed", source, entry: null });
  }

  return {
    providerId: "async-storage",
    label: "AsyncStorage",
    capabilities: ["key-value.read", "key-value.write", "key-value.watch"],

    instances() {
      return [{ instanceId: INSTANCE_ID, label: INSTANCE_ID }];
    },

    async listKeys(instanceId, options) {
      assertInstance(instanceId);
      // A primeira página abre um novo snapshot dos nomes. Páginas seguintes
      // reutilizam o mesmo índice ordenado até alguma escrita invalidá-lo.
      if (options?.afterKey === undefined) await refreshKnownKeys();
      else await primeKnownKeys();
      // Só nomes primeiro (barato). Valores: apenas os da página, em lotes
      // curtos com yield — um dataset de GB nunca é materializado inteiro.
      const { pageKeys, nextAfterKey, total } = pageOfSortedKeys(keyIndex(), options);
      const lean = options?.lean ?? false;
      const entries: KeyEntry[] = [];
      for (let i = 0; i < pageKeys.length; i += KEY_READ_BATCH) {
        const pairs = await storage.multiGet(pageKeys.slice(i, i + KEY_READ_BATCH));
        for (const [key, raw] of pairs) {
          if (raw !== null) entries.push(toEntry(key, raw, lean));
        }
        if (i + KEY_READ_BATCH < pageKeys.length) await breathe();
      }
      return { entries, nextAfterKey, total };
    },

    async get(instanceId, key) {
      assertInstance(instanceId);
      const raw = await storage.getItem(key);
      return raw === null ? null : classify(raw);
    },

    async set(instanceId, key, value) {
      assertInstance(instanceId);
      await primeKnownKeys();
      // O evento de escrita do Studio sai SEMPRE por aqui, uma vez só.
      // Se o storage estiver instrumentado pelo shim, o eco chega em
      // notifyAppWrite e é engolido pelo consumeStudioEcho.
      markStudioWrite(key);
      try {
        await storage.setItem(key, serialize(value));
      } finally {
        pendingStudioWrites.delete(key);
      }
      await emitWrite(key, "studio");
    },

    async remove(instanceId, key) {
      assertInstance(instanceId);
      await primeKnownKeys();
      markStudioWrite(key);
      try {
        await storage.removeItem(key);
      } finally {
        pendingStudioWrites.delete(key);
      }
      emitRemove(key, "studio");
    },

    subscribe(instanceId, listener) {
      assertInstance(instanceId);
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async notifyAppWrite(key, kind) {
      // Checagem síncrona ANTES de qualquer await — ver consumeStudioEcho.
      if (consumeStudioEcho(key)) return; // eco de escrita do Studio: set/remove já emitiu
      await primeKnownKeys();
      if (kind === "removed") emitRemove(key, "app");
      else await emitWrite(key, "app");
    },
  };
}
