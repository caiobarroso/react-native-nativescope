import type { KeyEntry, StorageValue, ChangeSource } from "@rnsi/protocol";
import type { KeyValueAdapter, KeyValueChange } from "./adapter.ts";
import { pageOfKeys } from "./key-pagination.ts";

const PREVIEW_MAX = 120;

export function toKeyEntry(key: string, value: StorageValue): KeyEntry {
  const serialized =
    value.type === "null" ? "null" : String(value.value satisfies string | number | boolean);
  return {
    key,
    valueType: value.type,
    approxSize: new TextEncoder().encode(serialized).length,
    preview:
      serialized.length > PREVIEW_MAX ? `${serialized.slice(0, PREVIEW_MAX)}…` : serialized,
  };
}

/**
 * Adapter key-value em memória.
 *
 * Serve a Fase 0 (provar o fio de ponta a ponta sem provider real) e depois
 * vira o fake dos contract tests em packages/testkit. Escritas locais via
 * `writeFromApp` simulam o app mexendo no storage — é o que o fake-runtime
 * da CLI usa para gerar atividade.
 */
export function createMemoryAdapter(options: {
  providerId?: string;
  label?: string;
  instances?: string[];
  seed?: Record<string, Record<string, StorageValue>>;
} = {}): KeyValueAdapter & {
  writeFromApp(instanceId: string, key: string, value: StorageValue | null): void;
} {
  const providerId = options.providerId ?? "memory";
  const label = options.label ?? "Memory";
  const instanceIds = options.instances ?? ["default"];

  const stores = new Map<string, Map<string, StorageValue>>();
  for (const id of instanceIds) {
    stores.set(id, new Map(Object.entries(options.seed?.[id] ?? {})));
  }

  const listeners = new Map<string, Set<(change: KeyValueChange) => void>>();

  function store(instanceId: string): Map<string, StorageValue> {
    const s = stores.get(instanceId);
    if (!s) throw new Error(`unknown instance: ${instanceId}`);
    return s;
  }

  function emit(instanceId: string, change: KeyValueChange): void {
    for (const listener of listeners.get(instanceId) ?? []) listener(change);
  }

  function write(
    instanceId: string,
    key: string,
    value: StorageValue | null,
    source: ChangeSource,
  ): void {
    const s = store(instanceId);
    const existed = s.has(key);
    if (value === null) {
      if (!existed) return;
      s.delete(key);
      emit(instanceId, { key, change: "removed", source, entry: null });
      return;
    }
    s.set(key, value);
    emit(instanceId, {
      key,
      change: existed ? "updated" : "created",
      source,
      entry: toKeyEntry(key, value),
    });
  }

  return {
    providerId,
    label,
    capabilities: ["key-value.read", "key-value.write", "key-value.watch"],

    instances() {
      return instanceIds.map((instanceId) => ({ instanceId, label: instanceId }));
    },

    async listKeys(instanceId, options) {
      const s = store(instanceId);
      const { pageKeys, nextAfterKey, total } = pageOfKeys([...s.keys()], options);
      return {
        entries: pageKeys.map((key) => toKeyEntry(key, s.get(key) as StorageValue)),
        nextAfterKey,
        total,
      };
    },

    async get(instanceId, key) {
      return store(instanceId).get(key) ?? null;
    },

    async set(instanceId, key, value) {
      write(instanceId, key, value, "studio");
    },

    async remove(instanceId, key) {
      write(instanceId, key, null, "studio");
    },

    subscribe(instanceId, listener) {
      store(instanceId); // valida a instância
      let set = listeners.get(instanceId);
      if (!set) {
        set = new Set();
        listeners.set(instanceId, set);
      }
      set.add(listener);
      return () => set.delete(listener);
    },

    writeFromApp(instanceId, key, value) {
      write(instanceId, key, value, "app");
    },
  };
}
