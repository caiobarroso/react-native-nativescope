import { describe, expect, it } from "vitest";
import type { StorageValue } from "@rnsi/protocol";
import type { KeyValueAdapter, KeyValueChange } from "@rnsi/runtime";

/**
 * Contract tests de key-value (plano §15.3).
 *
 * A mesma suíte valida todo adapter da categoria — AsyncStorage, MMKV e os
 * que vierem. É o que transforma "adicionar provider sem reescrever" de
 * slogan em fato verificável: se passa aqui, o resto do sistema funciona.
 */

export interface KeyValueAdapterHarness {
  adapter: KeyValueAdapter;
  /** Simula o APP escrevendo no storage (fora do Studio). `null` remove. */
  writeFromApp(instanceId: string, key: string, value: StorageValue | null): Promise<void>;
  /** Instância garantida de existir. */
  instanceId: string;
}

export function describeKeyValueAdapterContract(options: {
  name: string;
  createHarness: () => Promise<KeyValueAdapterHarness> | KeyValueAdapterHarness;
}): void {
  const { name, createHarness } = options;

  describe(`contrato key-value: ${name}`, () => {
    async function setup() {
      const harness = await createHarness();
      const changes: KeyValueChange[] = [];
      harness.adapter.subscribe(harness.instanceId, (change) => changes.push(change));
      return { ...harness, changes };
    }

    it("declara as capabilities de key-value", async () => {
      const { adapter } = await setup();
      expect(adapter.capabilities).toContain("key-value.read");
      expect(adapter.capabilities).toContain("key-value.write");
      expect(adapter.capabilities).toContain("key-value.watch");
      expect(adapter.instances().length).toBeGreaterThan(0);
    });

    it("lista chaves em ordem estável", async () => {
      const { adapter, instanceId } = await setup();
      await adapter.set(instanceId, "b.key", { type: "string", value: "2" });
      await adapter.set(instanceId, "a.key", { type: "string", value: "1" });
      const page = await adapter.listKeys(instanceId);
      expect(page.entries.map((e) => e.key)).toEqual(["a.key", "b.key"]);
      expect(page.total).toBe(2);
      expect(page.nextAfterKey).toBeNull();
    });

    it("pagina por cursor: páginas O(limit), cursor estável, total constante", async () => {
      const { adapter, instanceId } = await setup();
      const keys = ["k.a", "k.b", "k.c", "k.d", "k.e"];
      for (const key of keys) {
        await adapter.set(instanceId, key, { type: "string", value: key });
      }

      const first = await adapter.listKeys(instanceId, { limit: 2 });
      expect(first.entries.map((e) => e.key)).toEqual(["k.a", "k.b"]);
      expect(first.total).toBe(5);
      expect(first.nextAfterKey).toBe("k.b");

      const second = await adapter.listKeys(instanceId, {
        afterKey: first.nextAfterKey as string,
        limit: 2,
      });
      expect(second.entries.map((e) => e.key)).toEqual(["k.c", "k.d"]);
      expect(second.nextAfterKey).toBe("k.d");

      const last = await adapter.listKeys(instanceId, {
        afterKey: second.nextAfterKey as string,
        limit: 2,
      });
      expect(last.entries.map((e) => e.key)).toEqual(["k.e"]);
      expect(last.nextAfterKey).toBeNull();
    });

    it("cursor além do fim devolve página vazia, não erro", async () => {
      const { adapter, instanceId } = await setup();
      await adapter.set(instanceId, "só.uma", { type: "string", value: "x" });
      const page = await adapter.listKeys(instanceId, { afterKey: "zzz.depois.do.fim" });
      expect(page.entries).toEqual([]);
      expect(page.nextAfterKey).toBeNull();
      expect(page.total).toBe(1);
    });

    it("lê o que escreveu, preservando o tipo", async () => {
      const { adapter, instanceId } = await setup();
      const cases: StorageValue[] = [
        { type: "string", value: "texto" },
        { type: "json", value: JSON.stringify({ nested: { deep: true }, n: 1 }) },
      ];
      for (const value of cases) {
        await adapter.set(instanceId, `key.${value.type}`, value);
        const read = await adapter.get(instanceId, `key.${value.type}`);
        expect(read).toEqual(value);
      }
    });

    it("distingue a string '123' de conteúdo JSON", async () => {
      const { adapter, instanceId } = await setup();
      await adapter.set(instanceId, "s", { type: "string", value: "plain text" });
      const read = await adapter.get(instanceId, "s");
      expect(read?.type).toBe("string");
    });

    it("get de chave inexistente devolve null, não erro", async () => {
      const { adapter, instanceId } = await setup();
      expect(await adapter.get(instanceId, "ghost")).toBeNull();
    });

    it("cria, atualiza e remove com os eventos certos", async () => {
      const { adapter, instanceId, changes } = await setup();

      await adapter.set(instanceId, "k", { type: "string", value: "v1" });
      await adapter.set(instanceId, "k", { type: "string", value: "v2" });
      await adapter.remove(instanceId, "k");

      expect(changes.map((c) => c.change)).toEqual(["created", "updated", "removed"]);
      expect(await adapter.get(instanceId, "k")).toBeNull();
      const { entries } = await adapter.listKeys(instanceId);
      expect(entries.find((e) => e.key === "k")).toBeUndefined();
    });

    it("não duplica eventos", async () => {
      const { adapter, instanceId, changes } = await setup();
      await adapter.set(instanceId, "único", { type: "string", value: "x" });
      expect(changes).toHaveLength(1);
    });

    it("escrita do Studio sai com source studio; do app, com source app", async () => {
      const { adapter, instanceId, changes, writeFromApp } = await setup();

      await adapter.set(instanceId, "do.studio", { type: "string", value: "s" });
      await writeFromApp(instanceId, "do.app", { type: "string", value: "a" });

      const bySource = Object.fromEntries(changes.map((c) => [c.key, c.source]));
      expect(bySource["do.studio"]).toBe("studio");
      expect(bySource["do.app"]).toBe("app");
    });

    it("remoção vinda do app também sai como app", async () => {
      const { instanceId, changes, writeFromApp } = await setup();
      await writeFromApp(instanceId, "k", { type: "string", value: "v" });
      await writeFromApp(instanceId, "k", null);
      const removal = changes.find((c) => c.change === "removed");
      expect(removal?.source).toBe("app");
    });

    it("supressão de eco não engole a escrita seguinte do app na mesma chave", async () => {
      const { adapter, instanceId, changes, writeFromApp } = await setup();

      // Studio escreve, app escreve NA MESMA chave logo depois:
      await adapter.set(instanceId, "k", { type: "string", value: "studio" });
      await writeFromApp(instanceId, "k", { type: "string", value: "app" });

      expect(changes.map((c) => c.source)).toEqual(["studio", "app"]);
    });

    it("entry do evento traz preview e tamanho coerentes", async () => {
      const { adapter, instanceId, changes } = await setup();
      await adapter.set(instanceId, "k", { type: "string", value: "hello" });
      const entry = changes[0]?.entry;
      expect(entry?.key).toBe("k");
      expect(entry?.preview).toContain("hello");
      expect(entry?.approxSize).toBeGreaterThan(0);
    });

    it("instância desconhecida é erro estruturado, e o adapter continua íntegro", async () => {
      const { adapter, instanceId } = await setup();
      await expect(adapter.listKeys("instância-fantasma")).rejects.toThrow();
      // consistência após falha:
      await adapter.set(instanceId, "ainda.funciona", { type: "string", value: "sim" });
      expect(await adapter.get(instanceId, "ainda.funciona")).toEqual({
        type: "string",
        value: "sim",
      });
    });

    it("unsubscribe para de receber eventos", async () => {
      const harness = await createHarness();
      const received: KeyValueChange[] = [];
      const unsubscribe = harness.adapter.subscribe(harness.instanceId, (c) =>
        received.push(c),
      );
      await harness.adapter.set(harness.instanceId, "a", { type: "string", value: "1" });
      unsubscribe();
      await harness.adapter.set(harness.instanceId, "b", { type: "string", value: "2" });
      expect(received).toHaveLength(1);
    });
  });
}
