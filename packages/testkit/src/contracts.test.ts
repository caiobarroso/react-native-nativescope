import { describe, expect, it } from "vitest";
import type { StorageValue } from "@rnsi/protocol";
import {
  createMemoryAdapter,
  createAsyncStorageAdapter,
  createMMKVAdapter,
} from "@rnsi/runtime";
import { describeKeyValueAdapterContract } from "./key-value-contract.ts";
import { createFakeAsyncStorage } from "./fakes/async-storage.ts";
import { createFakeMMKV } from "./fakes/mmkv.ts";

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

// ---------------------------------------------------------------------------
// MMKV — o app escreve direto na instância; o listener nativo (fake fiel)
// dispara para toda escrita, e a origem é resolvida por pendentes.
// ---------------------------------------------------------------------------

describeKeyValueAdapterContract({
  name: "MMKV",
  createHarness() {
    const instance = createFakeMMKV();
    const adapter = createMMKVAdapter();
    adapter.registerInstance("default", instance);
    return {
      adapter,
      instanceId: "default",
      async writeFromApp(_instanceId, key, value) {
        if (value === null) {
          instance.delete(key);
          return;
        }
        switch (value.type) {
          case "string":
          case "json":
            instance.set(key, value.value);
            break;
          case "number":
          case "boolean":
            instance.set(key, value.value);
            break;
          default:
            throw new Error(`tipo não suportado no harness: ${value.type}`);
        }
      },
    };
  },
});

// Específicos do MMKV, além do contrato comum:

describe("MMKV: tipos e instâncias", () => {
  it("preserva number e boolean de verdade — não como string", async () => {
    const instance = createFakeMMKV();
    const adapter = createMMKVAdapter();
    adapter.registerInstance("default", instance);

    await adapter.set("default", "n", { type: "number", value: 42.5 });
    await adapter.set("default", "b", { type: "boolean", value: true });

    expect(await adapter.get("default", "n")).toEqual({ type: "number", value: 42.5 });
    expect(await adapter.get("default", "b")).toEqual({ type: "boolean", value: true });
  });

  it("instâncias são isoladas e listadas em ordem", async () => {
    const adapter = createMMKVAdapter();
    adapter.registerInstance("user", createFakeMMKV());
    adapter.registerInstance("cache", createFakeMMKV());

    await adapter.set("user", "só.no.user", { type: "string", value: "x" });

    expect(adapter.instances().map((i) => i.instanceId)).toEqual(["cache", "user"]);
    expect(await adapter.listKeys("cache")).toHaveLength(0);
    expect(await adapter.listKeys("user")).toHaveLength(1);
  });

  it("registro de instância é idempotente por id", () => {
    const adapter = createMMKVAdapter();
    const first = createFakeMMKV();
    adapter.registerInstance("default", first);
    adapter.registerInstance("default", createFakeMMKV());
    expect(adapter.instances()).toHaveLength(1);
    expect(adapter.hasInstance("default")).toBe(true);
  });

  it("avisa quando uma nova instância aparece", () => {
    const adapter = createMMKVAdapter();
    const seen: string[][] = [];
    adapter.onInstancesChanged?.(() => {
      seen.push(adapter.instances().map((i) => i.instanceId));
    });

    adapter.registerInstance("settings", createFakeMMKV());
    adapter.registerInstance("settings", createFakeMMKV());
    adapter.registerInstance("cache", createFakeMMKV());

    expect(seen).toEqual([["settings"], ["cache", "settings"]]);
  });

  it("string com cara de JSON é inferida como json; inválida fica string", async () => {
    const instance = createFakeMMKV();
    const adapter = createMMKVAdapter();
    adapter.registerInstance("default", instance);

    instance.set("valid", '{"a":1}');
    instance.set("invalid", "{quebrado");

    expect((await adapter.get("default", "valid"))?.type).toBe("json");
    expect((await adapter.get("default", "invalid"))?.type).toBe("string");
  });
});

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
