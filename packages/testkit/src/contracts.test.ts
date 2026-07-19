import type { StorageValue } from "@rnsi/protocol";
import { createMemoryAdapter, createAsyncStorageAdapter } from "@rnsi/runtime";
import { describeKeyValueAdapterContract } from "./key-value-contract.ts";
import { createFakeAsyncStorage } from "./fakes/async-storage.ts";

// ---------------------------------------------------------------------------
// Memory (o fake da Fase 0 também obedece o contrato)
// ---------------------------------------------------------------------------

describeKeyValueAdapterContract({
  name: "Memory",
  createHarness() {
    const adapter = createMemoryAdapter();
    return {
      adapter,
      instanceId: "default",
      async writeFromApp(instanceId, key, value) {
        adapter.writeFromApp(instanceId, key, value);
      },
    };
  },
});

// ---------------------------------------------------------------------------
// AsyncStorage — instrumentado exatamente como o shim do Metro faz:
// toda escrita no storage dispara notifyAppWrite após o método real.
// ---------------------------------------------------------------------------

function rawOf(value: StorageValue): string {
  switch (value.type) {
    case "string":
    case "json":
    case "buffer":
      return value.value;
    case "number":
    case "boolean":
      return String(value.value);
    case "null":
      return "";
  }
}

describeKeyValueAdapterContract({
  name: "AsyncStorage",
  createHarness() {
    const storage = createFakeAsyncStorage();
    const adapter = createAsyncStorageAdapter(storage);

    // Instrumentação idêntica à do shim: chama notifyAppWrite de forma
    // síncrona logo após o método original resolver.
    const realSetItem = storage.setItem.bind(storage);
    storage.setItem = async (key, value) => {
      await realSetItem(key, value);
      void adapter.notifyAppWrite(key, "set");
    };
    const realRemoveItem = storage.removeItem.bind(storage);
    storage.removeItem = async (key) => {
      await realRemoveItem(key);
      void adapter.notifyAppWrite(key, "removed");
    };

    return {
      adapter,
      instanceId: "default",
      async writeFromApp(_instanceId, key, value) {
        // O app escreve chamando o AsyncStorage instrumentado, como no device.
        if (value === null) await storage.removeItem(key);
        else await storage.setItem(key, rawOf(value));
        // dá o microtask para o notifyAppWrite assíncrono concluir
        await new Promise((r) => setTimeout(r, 0));
      },
    };
  },
});
