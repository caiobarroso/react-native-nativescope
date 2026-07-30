import { describe, expect, it } from "vitest";
import { CELL_PREVIEW_LIMIT } from "@rnsi/protocol";
import { createExpoSqliteAdapter, type SQLiteDatabaseLike } from "@rnsi/runtime";
import { createNodeSqlite } from "./fakes/sqlite.ts";

/**
 * BLOB no caminho de leitura.
 *
 * Estes testes existem porque nenhuma tabela do projeto (nem nos testes, nem no
 * playground) tinha coluna BLOB — então o ramo de blob do adapter nunca foi
 * exercitado, e escondia dois bugs: `btoa` não existe no React Native (o
 * fallback devolvia bytes crus rotulados como base64) e um `ArrayBuffer` cru,
 * que é o que o op-sqlite devolve, virava a string "[object ArrayBuffer]".
 */

const SETUP = `
  CREATE TABLE files (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    payload BLOB
  );
`;

/** Oráculo independente da nossa implementação. */
function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/**
 * Reembrulha um banco real trocando a FORMA com que o driver devolve BLOBs.
 * O SQL continua real (node:sqlite); só o tipo do valor muda — que é
 * exatamente a diferença entre expo-sqlite (Uint8Array) e op-sqlite
 * (ArrayBuffer).
 */
function reshapeBlobs(
  base: SQLiteDatabaseLike,
  reshape: (bytes: Uint8Array) => unknown,
): SQLiteDatabaseLike {
  return {
    async getAllAsync(sql, params) {
      const rows = await base.getAllAsync(sql, params);
      return rows.map((row) => {
        const out: Record<string, unknown> = {};
        for (const [column, value] of Object.entries(row)) {
          out[column] = value instanceof Uint8Array ? reshape(value) : value;
        }
        return out;
      });
    },
    runAsync: (sql, params) => base.runAsync(sql, params),
  };
}

function setup(
  payload: Uint8Array,
  reshape?: (bytes: Uint8Array) => unknown,
): ReturnType<typeof createExpoSqliteAdapter> {
  const node = createNodeSqlite(SETUP);
  node.raw.prepare("INSERT INTO files (name, payload) VALUES (?, ?)").run("a.bin", payload);
  const adapter = createExpoSqliteAdapter();
  adapter.registerDatabase("app.db", reshape ? reshapeBlobs(node, reshape) : node);
  return adapter;
}

/** O valor completo da célula — `rows()` trunca no preview, `cell()` não. */
async function readCell(
  adapter: ReturnType<typeof createExpoSqliteAdapter>,
): Promise<{ data: string; kind: string } | null> {
  return adapter.cell("app.db", "files", { rowid: 1 }, "payload");
}

describe("sqlite adapter — BLOB", () => {
  it("Uint8Array vira base64 válido (oráculo: Buffer do Node)", async () => {
    const payload = new Uint8Array([0, 1, 127, 128, 254, 255, 65, 66, 67]);
    const cell = await readCell(setup(payload));

    expect(cell).toEqual({ data: base64(payload), kind: "blob" });
  });

  it("ArrayBuffer cru vira base64 — não a string '[object ArrayBuffer]'", async () => {
    const payload = new Uint8Array([10, 20, 30, 40, 250]);
    // É assim que o op-sqlite entrega BLOB: `new ArrayBuffer(size)` + memcpy.
    const cell = await readCell(setup(payload, (bytes) => bytes.buffer.slice(0)));

    expect(cell).toEqual({ data: base64(payload), kind: "blob" });
    expect(cell?.data).not.toContain("ArrayBuffer");
  });

  it("view parcial usa só os bytes da view, não o buffer inteiro", async () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    // Uma view dos bytes 2..5 sobre um buffer maior. Sem respeitar
    // byteOffset/byteLength, o base64 sairia com os 8 bytes.
    const cell = await readCell(
      setup(payload, (bytes) => new Uint8Array(bytes.buffer, 2, 3)),
    );

    expect(cell?.data).toBe(base64(new Uint8Array([3, 4, 5])));
  });

  it("outra ArrayBufferView (Uint16Array) também é lida como bytes", async () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const cell = await readCell(setup(payload, (bytes) => new Uint16Array(bytes.buffer)));

    expect(cell?.data).toBe(base64(payload));
  });

  it.each([1, 2, 3, 4, 5, 6])("padding correto com %i byte(s)", async (size) => {
    const payload = new Uint8Array(Array.from({ length: size }, (_, i) => i * 37));
    const cell = await readCell(setup(payload));

    expect(cell?.data).toBe(base64(payload));
  });

  it("blob vazio devolve null (SQLite trata x'' como zero bytes)", async () => {
    const cell = await readCell(setup(new Uint8Array([])));

    // node:sqlite devolve um Uint8Array de tamanho 0 → base64 vazio.
    expect(cell?.data).toBe("");
  });

  it("blob grande atravessa o limite de bloco (3072 bytes) sem corromper", async () => {
    // Tamanhos escolhidos em volta da fronteira de bloco e com resto != 0,
    // que é onde um encoder chunked erra o padding se juntar mal os pedaços.
    for (const size of [3071, 3072, 3073, 6145, 10_000]) {
      const payload = new Uint8Array(Array.from({ length: size }, (_, i) => i % 256));
      const cell = await readCell(setup(payload));

      expect(cell?.data, `size=${size}`).toBe(base64(payload));
    }
  });

  it("preview trunca e marca a coluna; cell devolve 100%", async () => {
    const payload = new Uint8Array(Array.from({ length: 8_000 }, (_, i) => i % 256));
    const adapter = setup(payload);

    const page = await adapter.rows("app.db", "files", { limit: 10, offset: 0 });
    const cellPreview = page.rows[0]?.cells["payload"];

    expect(page.rows[0]?.truncatedColumns).toEqual(["payload"]);
    expect(cellPreview).not.toBeNull();
    expect(typeof cellPreview === "object" && cellPreview !== null).toBe(true);
    if (typeof cellPreview === "object" && cellPreview !== null) {
      expect(cellPreview.blobBase64.length).toBe(CELL_PREVIEW_LIMIT);
      // O preview é um prefixo honesto do valor completo.
      expect(base64(payload).startsWith(cellPreview.blobBase64)).toBe(true);
    }

    const full = await readCell(adapter);
    expect(full?.data).toBe(base64(payload));
  });

  it("não depende de btoa — funciona com globalThis.btoa ausente", async () => {
    const original = globalThis.btoa;
    // @ts-expect-error — simula o React Native, que não polifila btoa.
    delete globalThis.btoa;
    try {
      const payload = new Uint8Array([200, 201, 202, 203]);
      const cell = await readCell(setup(payload));
      expect(cell?.data).toBe(base64(payload));
    } finally {
      globalThis.btoa = original;
    }
  });
});
