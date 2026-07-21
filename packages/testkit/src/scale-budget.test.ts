import { describe, expect, it } from "vitest";
import {
  createAsyncStorageAdapter,
  createExpoSqliteAdapter,
  handleCommand,
  createRegistry,
  KEY_READ_BATCH,
} from "@rnsi/runtime";
import {
  KEY_VALUE_PREVIEW_LIMIT,
  PROTOCOL_VERSION,
  WIRE_MESSAGE_BUDGET,
  exceedsWireBudget,
  serializeMessage,
  wireByteSize,
  type CommandMessage,
} from "@rnsi/protocol";
import { createFakeAsyncStorage } from "./fakes/async-storage.ts";
import { createNodeSqlite } from "./fakes/sqlite.ts";

/**
 * Testes de ORÇAMENTO (plano de grandes volumes §1/§E): garantem que os
 * limites que sustentam "GB sem desespero" não regridem em silêncio.
 *
 * O orçamento de fio é medido em BYTES (wireByteSize), não em chars — um
 * valor multibyte não pode furar o teto de 256 KB por baixo do radar.
 */

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

  it("reutiliza o índice de nomes entre páginas da mesma varredura", async () => {
    const storage = createFakeAsyncStorage();
    for (let i = 0; i < 900; i += 1) {
      await storage.setItem(`k.${String(i).padStart(4, "0")}`, String(i));
    }
    let enumerations = 0;
    const instrumented = {
      ...storage,
      getAllKeys: async () => {
        enumerations += 1;
        return storage.getAllKeys();
      },
    };
    const adapter = createAsyncStorageAdapter(instrumented);

    const first = await adapter.listKeys("default", { limit: 500 });
    const afterKey = first.nextAfterKey;
    expect(afterKey).not.toBeNull();
    if (afterKey === null) throw new Error("expected a second page");
    await adapter.listKeys("default", {
      afterKey,
      limit: 500,
    });

    expect(enumerations).toBe(1);
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
    expect(exceedsWireBudget(serializeMessage(result))).toBe(false);
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
    expect(exceedsWireBudget(serializeMessage(result))).toBe(false);
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

  it("NENHUMA resposta de comando estoura o orçamento de fio, nem com valores de MB", async () => {
    // O guard de transporte (bootstrap.send / server.sendTo) usa exatamente
    // este predicado. Aqui provamos, contra os comandos patológicos, que a
    // resposta é preview + metadados — nunca o dado inteiro (a falha Flipper).
    const storage = createFakeAsyncStorage();
    for (let i = 0; i < 100; i += 1) {
      await storage.setItem(`big.${String(i).padStart(3, "0")}`, "v".repeat(1024 * 1024));
    }
    await storage.setItem("dump", "x".repeat(8 * 1024 * 1024));
    const registry = createRegistry();
    registry.register(createAsyncStorageAdapter(storage));

    const commands: CommandMessage[] = [
      command({
        type: "key-value.list",
        payload: { providerId: "async-storage", instanceId: "default", limit: 100 },
      }),
      command({
        type: "key-value.get",
        payload: { providerId: "async-storage", instanceId: "default", key: "dump" },
      }),
    ];
    for (const cmd of commands) {
      const result = await handleCommand(registry, cmd);
      expect(result.ok).toBe(true);
      expect(exceedsWireBudget(serializeMessage(result))).toBe(false);
    }
  });

  it("o orçamento é medido em bytes: um valor multibyte não fura o teto por baixo do radar", () => {
    // '💥' = 2 unidades UTF-16, 4 bytes UTF-8. Uma string logo abaixo do teto
    // em CHARS mas acima em BYTES tem de ser detectada como estouro.
    const almost = "a".repeat(WIRE_MESSAGE_BUDGET - 10); // ASCII: chars ≈ bytes
    expect(exceedsWireBudget(almost)).toBe(false);

    const multibyte = "€".repeat(WIRE_MESSAGE_BUDGET / 2); // 3 bytes/char → ~1.5×
    expect(multibyte.length).toBeLessThan(WIRE_MESSAGE_BUDGET); // caberia por chars…
    expect(wireByteSize(multibyte)).toBeGreaterThan(WIRE_MESSAGE_BUDGET); // …mas não por bytes
    expect(exceedsWireBudget(multibyte)).toBe(true);

    // Par surrogate conta 4 bytes, não 6: 2 unidades × 2 bytes/unidade.
    expect(wireByteSize("💥")).toBe(4);
  });

  it("a JS thread é solta ENTRE os lotes — trabalho do app roda no meio da varredura", async () => {
    const storage = createFakeAsyncStorage();
    for (let i = 0; i < 150; i += 1) {
      await storage.setItem(`k.${String(i).padStart(3, "0")}`, `v${i}`);
    }
    // 150 chaves / KEY_READ_BATCH(50) = 3 lotes, com breathe() entre eles.
    let batchesRun = 0;
    const instrumented = {
      ...storage,
      multiGet: async (keys: readonly string[]) => {
        batchesRun += 1;
        return storage.multiGet(keys);
      },
    };
    const adapter = createAsyncStorageAdapter(instrumented);

    // "Trabalho do app": um timer agendado ANTES da varredura. Ele só roda se a
    // JS thread for devolvida ao event loop no meio da leitura — que é a
    // garantia de fatia curta (§1). Registramos em qual lote isso aconteceu.
    let appRanAtBatch = -1;
    const appWork = new Promise<void>((resolve) =>
      setTimeout(() => {
        appRanAtBatch = batchesRun;
        resolve();
      }, 0),
    );

    await adapter.listKeys("default", { limit: 150 });
    await appWork;

    expect(batchesRun).toBe(3);
    // O timer do app rodou depois do 1º lote e antes do último — ou seja, a
    // thread não ficou presa a varredura inteira num bloco síncrono.
    expect(appRanAtBatch).toBeGreaterThanOrEqual(1);
    expect(appRanAtBatch).toBeLessThan(3);
  });
});
