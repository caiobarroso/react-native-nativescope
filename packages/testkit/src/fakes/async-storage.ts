/**
 * Fake fiel da API do @react-native-async-storage/async-storage.
 * Tudo é string por baixo — exatamente como no real.
 */
export interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  mergeItem(key: string, value: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
  multiGet(keys: readonly string[]): Promise<ReadonlyArray<[string, string | null]>>;
  multiSet(pairs: ReadonlyArray<[string, string]>): Promise<void>;
  multiRemove(keys: readonly string[]): Promise<void>;
  clear(): Promise<void>;
}

export function createFakeAsyncStorage(): AsyncStorageLike {
  const store = new Map<string, string>();

  return {
    async getItem(key) {
      return store.get(key) ?? null;
    },
    async setItem(key, value) {
      store.set(key, value);
    },
    async removeItem(key) {
      store.delete(key);
    },
    async mergeItem(key, value) {
      const current = store.get(key);
      if (!current) {
        store.set(key, value);
        return;
      }
      // merge raso de JSON, como o real
      store.set(key, JSON.stringify({ ...JSON.parse(current), ...JSON.parse(value) }));
    },
    async getAllKeys() {
      return [...store.keys()];
    },
    async multiGet(keys) {
      return keys.map((key) => [key, store.get(key) ?? null]);
    },
    async multiSet(pairs) {
      for (const [key, value] of pairs) store.set(key, value);
    },
    async multiRemove(keys) {
      for (const key of keys) store.delete(key);
    },
    async clear() {
      store.clear();
    },
  };
}
