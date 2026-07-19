import { describe, expect, it } from "vitest";
import {
  createAsyncStorageAdapter,
  createExpoSqliteAdapter,
  handleCommand,
  createRegistry,
  KEY_READ_BATCH,
} from "@rnsi/runtime";
import { KEY_VALUE_PREVIEW_LIMIT, PROTOCOL_VERSION, type CommandMessage } from "@rnsi/protocol";
import { createFakeAsyncStorage } from "./fakes/async-storage.ts";
import { createNodeSqlite } from "./fakes/sqlite.ts";

/**
 * Testes de ORÇAMENTO (plano de grandes volumes §1/§E): garantem que os
 * limites que sustentam "GB sem desespero" não regridem em silêncio.
 */

const RESPONSE_BUDGET = 256 * 1024;

function command(partial: Pick<CommandMessage, "type" | "payload">): CommandMessage {
  return {
    kind: "command",
    protocolVersion: PROTOCOL_VERSION,
    requestId: "req-budget",
    ...partial,
  } as CommandMessage;
}

describe("orçamentos de escala", () => {
  it("listKeys lê APENAS a página pedida, em lotes ≤ KEY_READ_BATCH", async () => {
    const storage = createFakeAsyncStorage();
    const batchSizes: number[] = [];
    let valuesRead = 0;
    const instrumented = {
      ...storage,
      multiGet: async (keys: readonly string[]) => {
        batchSizes.push(keys.length);
        valuesRead += keys.length;
        return storage.multiGet(keys);
      },
    };
    for (let i = 0; i < 300; i += 1) {
      await storage.setItem(`k.${String(i).padStart(3, "0")}`, `valor ${i}`);
    }

    const adapter = createAsyncStorageAdapter(instrumented);
    const page = await adapter.listKeys("default", { limit: 200 });

    expect(page.entries).toHaveLength(200);
    expect(page.total).toBe(300);
    // Nunca materializa o dataset: só a página, e em lotes curtos.
    expect(valuesRead).toBe(200);
    expect(Math.max(...batchSizes)).toBeLessThanOrEqual(KEY_READ_BATCH);
  });

  it("resposta de listKeys fica dentro do orçamento mesmo com valores de MB", async () => {
    const storage = createFakeAsyncStorage();
    const megabyte = "v".repeat(1024 * 1024);
    for (let i = 0; i < 100; i += 1) {
      await storage.setItem(`big.${String(i).padStart(3, "0")}`, megabyte);
    }
    const registry = createRegistry();
    registry.register(createAsyncStorageAdapter(storage));

    const result = await handleCommand(
      registry,
      command({
        type: "key-value.list",
        payload: { providerId: "async-storage", instanceId: "default", limit: 100 },
      }),
    );
    expect(result.ok).toBe(true);
    // 100 valores de 1 MB no device → resposta de previews, não de dados.
    expect(JSON.stringify(result).length).toBeLessThan(RESPONSE_BUDGET);
  });

  it("resposta de key-value.get nunca excede o orçamento de mensagem", async () => {
    const storage = createFakeAsyncStorage();
    await storage.setItem("dump", "x".repeat(8 * 1024 * 1024)); // 8 MB no device
    const registry = createRegistry();
    registry.register(createAsyncStorageAdapter(storage));

    const result = await handleCommand(
      registry,
      command({
        type: "key-value.get",
        payload: { providerId: "async-storage", instanceId: "default", key: "dump" },
      }),
    );
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThan(RESPONSE_BUDGET);
    if (result.ok) {
      const { truncated, totalSize } = result.result as { truncated: boolean; totalSize: number };
      expect(truncated).toBe(true);
      expect(totalSize).toBe(8 * 1024 * 1024);
    }
  });

  it("preview de get respeita exatamente KEY_VALUE_PREVIEW_LIMIT", async () => {
    const storage = createFakeAsyncStorage();
    await storage.setItem("dump", "x".repeat(KEY_VALUE_PREVIEW_LIMIT * 2));
    const adapter = createAsyncStorageAdapter(storage);
    const registry = createRegistry();
    registry.register(adapter);
    const result = await handleCommand(
      registry,
      command({
        type: "key-value.get",
        payload: { providerId: "async-storage", instanceId: "default", key: "dump" },
      }),
    );
    if (result.ok) {
      const { value } = result.result as { value: { value: string } };
      expect(value.value).toHaveLength(KEY_VALUE_PREVIEW_LIMIT);
    }
  });

  it("keyset é estável sob escrita concorrente: sem duplicatas nem pulos", async () => {
    const db = createNodeSqlite(`
      CREATE TABLE stream_rows (id INTEGER PRIMARY KEY, label TEXT);
      INSERT INTO stream_rows (label)
      WITH RECURSIVE cnt(v) AS (SELECT 1 UNION ALL SELECT v + 1 FROM cnt WHERE v < 10)
      SELECT 'linha ' || v FROM cnt;
    `);
    const adapter = createExpoSqliteAdapter();
    adapter.registerDatabase("scale.db", db);

    const first = await adapter.rows("scale.db", "stream_rows", { limit: 4, offset: 0 });
    const lastRef = first.rows[first.rows.length - 1]?.ref;
    if (!lastRef || !("rowid" in lastRef)) throw new Error("ref esperada");

    // O app escreve ENTRE as páginas — o clássico que quebra OFFSET.
    await db.runAsync("INSERT INTO stream_rows (label) VALUES ('nova durante paginação')");
    await db.runAsync("DELETE FROM stream_rows WHERE id = 2"); // some da página já vista

    const second = await adapter.rows("scale.db", "stream_rows", {
      limit: 100,
      offset: 0,
      afterRowid: lastRef.rowid,
    });

    const firstIds = first.rows.map((r) => (r.ref && "rowid" in r.ref ? r.ref.rowid : -1));
    const secondIds = second.rows.map((r) => (r.ref && "rowid" in r.ref ? r.ref.rowid : -1));
    // Sem sobreposição com a página anterior…
    expect(secondIds.filter((id) => firstIds.includes(id))).toHaveLength(0);
    // …sem pular nenhuma linha antiga restante, e a nova aparece.
    expect(secondIds).toEqual([5, 6, 7, 8, 9, 10, 11]);
  });
});
