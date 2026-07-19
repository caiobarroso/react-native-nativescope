import type { ProviderDescriptor } from "@rnsi/protocol";
import type { ProviderAdapter } from "./adapter.ts";

/**
 * Registro de adapters do runtime. Os shims registram aqui no momento em que
 * a lib de storage é importada pelo app — o registro é consequência do
 * import, nunca uma chamada manual do usuário.
 */
export interface AdapterRegistry {
  register(adapter: ProviderAdapter): void;
  get(providerId: string): ProviderAdapter | undefined;
  describe(): ProviderDescriptor[];
  onRegister(listener: (adapter: ProviderAdapter) => void): () => void;
}

export function createRegistry(): AdapterRegistry {
  const adapters = new Map<string, ProviderAdapter>();
  const listeners = new Set<(adapter: ProviderAdapter) => void>();

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
