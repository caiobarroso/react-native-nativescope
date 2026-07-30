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
      const existing = adapters.get(adapter.providerId);
      if (existing) {
        // Registrar o MESMO adapter duas vezes é rotina: shim reavaliado por
        // Fast Refresh, import duplicado. Dois adapters DIFERENTES disputando
        // o mesmo providerId é bug de quem escreveu o provider novo, e o
        // sintoma — o segundo simplesmente não aparece no Studio — não tem
        // nada que aponte para a causa.
        if (existing !== adapter) {
          console.warn(
            `[nativescope] providerId duplicado: "${adapter.providerId}" já está ` +
              `registrado como "${existing.label}". O segundo adapter ("${adapter.label}") ` +
              `foi ignorado — cada provider precisa de um providerId único.`,
          );
        }
        return;
      }
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
