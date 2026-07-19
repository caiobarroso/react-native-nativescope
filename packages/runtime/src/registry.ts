import type { ProviderDescriptor } from "@rnsi/protocol";
import type { KeyValueAdapter } from "./adapter.ts";

/**
 * Registro de adapters do runtime. Os shims registram aqui no momento em que
 * a lib de storage é importada pelo app — o registro é consequência do
 * import, nunca uma chamada manual do usuário.
 */
export interface AdapterRegistry {
  register(adapter: KeyValueAdapter): void;
  get(providerId: string): KeyValueAdapter | undefined;
  describe(): ProviderDescriptor[];
  onRegister(listener: (adapter: KeyValueAdapter) => void): () => void;
}

export function createRegistry(): AdapterRegistry {
  const adapters = new Map<string, KeyValueAdapter>();
  const listeners = new Set<(adapter: KeyValueAdapter) => void>();

  return {
    register(adapter) {
      if (adapters.has(adapter.providerId)) return;
      adapters.set(adapter.providerId, adapter);
      for (const listener of listeners) listener(adapter);
    },

    get(providerId) {
      return adapters.get(providerId);
    },

    describe() {
      return [...adapters.values()].map((adapter) => ({
        providerId: adapter.providerId,
        label: adapter.label,
        capabilities: adapter.capabilities,
        instances: adapter.instances(),
      }));
    },

    onRegister(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
