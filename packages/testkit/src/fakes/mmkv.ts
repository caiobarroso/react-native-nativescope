import type { MMKVInstanceLike } from "@rnsi/runtime";

/**
 * Fake fiel de uma instância react-native-mmkv: valores tipados por baixo,
 * listener disparando para TODA escrita (inclusive delete), leituras com
 * tipo errado devolvendo undefined — como o real.
 */
export function createFakeMMKV(): MMKVInstanceLike & {
  /** dispara os listeners como o nativo faria */
  _store: Map<string, string | number | boolean>;
} {
  const store = new Map<string, string | number | boolean>();
  const listeners = new Set<(key: string) => void>();

  function notify(key: string): void {
    for (const listener of listeners) listener(key);
  }

  return {
    _store: store,

    getAllKeys() {
      return [...store.keys()];
    },
    contains(key) {
      return store.has(key);
    },
    getString(key) {
      const v = store.get(key);
      return typeof v === "string" ? v : undefined;
    },
    getNumber(key) {
      const v = store.get(key);
      return typeof v === "number" ? v : undefined;
    },
    getBoolean(key) {
      const v = store.get(key);
      return typeof v === "boolean" ? v : undefined;
    },
    set(key, value) {
      if (value instanceof ArrayBuffer) throw new Error("buffer não suportado no fake");
      store.set(key, value);
      notify(key);
    },
    delete(key) {
      store.delete(key);
      notify(key);
    },
    addOnValueChangedListener(listener) {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
  };
}
