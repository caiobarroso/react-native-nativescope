import { describe, expect, it } from "vitest";
import type { LogEntry } from "@rnsi/protocol";
import type { LogsFilters } from "./logs-store.ts";
import {
  buildLogRows,
  collectNamespaces,
  countByLevel,
  highlightSegments,
  matchesFilters,
  scopeToMark,
} from "./logs-select.ts";

let seq = 0;
function entry(overrides: Partial<LogEntry> = {}): LogEntry {
  seq += 1;
  return {
    id: `l-${seq}`,
    seq,
    ts: 1000 + seq,
    level: "log",
    source: "console",
    message: "hello",
    namespace: null,
    args: [],
    stack: null,
    repeat: 1,
    truncated: false,
    ...overrides,
  };
}

const NO_FILTERS: LogsFilters = { levels: [], search: "", namespace: null };
const NO_MARK = { markedSeq: null, markedAt: null, showEarlier: false };

describe("matchesFilters", () => {
  it("filtra por nível", () => {
    const error = entry({ level: "error" });
    expect(matchesFilters(error, { ...NO_FILTERS, levels: ["error"] })).toBe(true);
    expect(matchesFilters(error, { ...NO_FILTERS, levels: ["warn"] })).toBe(false);
  });

  it("busca na mensagem, no namespace e no JSON dos args", () => {
    const item = entry({
      message: "saving user",
      namespace: "Auth",
      args: [{ kind: "json", preview: "{...}", json: '{"token":"abc123"}', truncated: false }],
    });
    expect(matchesFilters(item, { ...NO_FILTERS, search: "SAVING" })).toBe(true);
    expect(matchesFilters(item, { ...NO_FILTERS, search: "auth" })).toBe(true);
    expect(matchesFilters(item, { ...NO_FILTERS, search: "abc123" })).toBe(true);
    expect(matchesFilters(item, { ...NO_FILTERS, search: "nope" })).toBe(false);
  });
});

describe("buildLogRows", () => {
  it("funde idênticas consecutivas somando repeat", () => {
    const rows = buildLogRows(
      [
        entry({ message: "tick" }),
        entry({ message: "tick", repeat: 4 }),
        entry({ message: "other" }),
      ],
      NO_FILTERS,
      NO_MARK,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: "entry", repeat: 5 });
    expect(rows[1]).toMatchObject({ kind: "entry", repeat: 1 });
  });

  it("não funde quando o nível difere", () => {
    const rows = buildLogRows(
      [entry({ message: "same", level: "log" }), entry({ message: "same", level: "error" })],
      NO_FILTERS,
      NO_MARK,
    );
    expect(rows).toHaveLength(2);
  });

  it("calcula delta em relação à linha anterior visível", () => {
    const rows = buildLogRows(
      [entry({ ts: 1000, message: "a" }), entry({ ts: 1150, message: "b" })],
      NO_FILTERS,
      NO_MARK,
    );
    expect(rows[0]).toMatchObject({ delta: null });
    expect(rows[1]).toMatchObject({ delta: 150 });
  });

  it("esconde o que veio antes da marca e conta o escondido", () => {
    const older = entry({ message: "before" });
    const newer = entry({ message: "after" });
    const rows = buildLogRows([older, newer], NO_FILTERS, {
      markedSeq: older.seq,
      markedAt: 5000,
      showEarlier: false,
    });

    expect(rows[0]).toMatchObject({ kind: "mark", hiddenCount: 1 });
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ kind: "entry" });
  });

  it("invertido preserva os deltas calculados na ordem cronológica", () => {
    const rows = buildLogRows(
      [entry({ ts: 1000, message: "a" }), entry({ ts: 1150, message: "b" })],
      NO_FILTERS,
      NO_MARK,
      "desc",
    );

    // A linha mais nova vem primeiro, mas o delta dela continua sendo o tempo
    // desde a anterior NO TEMPO REAL — nunca negativo.
    expect(rows[0]).toMatchObject({ kind: "entry", delta: 150 });
    expect((rows[0] as { entry: { message: string } }).entry.message).toBe("b");
    expect(rows[1]).toMatchObject({ kind: "entry", delta: null });
  });

  it("invertido põe o recente acima da marca e o anterior abaixo", () => {
    const older = entry({ message: "before" });
    const newer = entry({ message: "after" });
    const rows = buildLogRows([older, newer], NO_FILTERS, {
      markedSeq: older.seq,
      markedAt: 5000,
      showEarlier: true,
    }, "desc");

    expect(rows.map((row) => row.kind)).toEqual(["entry", "mark", "entry"]);
    expect((rows[0] as { entry: { message: string } }).entry.message).toBe("after");
    expect((rows[2] as { entry: { message: string } }).entry.message).toBe("before");
  });

  it("mostra o anterior à marca quando pedido, com a régua no meio", () => {
    const older = entry({ message: "before" });
    const newer = entry({ message: "after" });
    const rows = buildLogRows([older, newer], NO_FILTERS, {
      markedSeq: older.seq,
      markedAt: 5000,
      showEarlier: true,
    });

    expect(rows.map((row) => row.kind)).toEqual(["entry", "mark", "entry"]);
    expect(rows[1]).toMatchObject({ hiddenCount: 0 });
  });
});

describe("contagens e namespaces", () => {
  it("conta por nível somando repeat", () => {
    const counts = countByLevel([
      entry({ level: "error" }),
      entry({ level: "error", repeat: 3 }),
      entry({ level: "warn" }),
    ]);
    expect(counts.error).toBe(4);
    expect(counts.warn).toBe(1);
    expect(counts.debug).toBe(0);
  });

  it("coleta namespaces distintos, ordenados", () => {
    const namespaces = collectNamespaces([
      entry({ namespace: "Payment" }),
      entry({ namespace: "Auth" }),
      entry({ namespace: "Auth" }),
      entry({ namespace: null }),
    ]);
    expect(namespaces).toEqual(["Auth", "Payment"]);
  });

  it("scopeToMark corta o que veio antes da marca", () => {
    const older = entry();
    const newer = entry();
    const scoped = scopeToMark([older, newer], {
      markedSeq: older.seq,
      markedAt: 1,
      showEarlier: false,
    });
    expect(scoped).toEqual([newer]);
  });
});

describe("highlightSegments", () => {
  it("fatia o texto nos trechos que casam, sem perder caractere", () => {
    const segments = highlightSegments("token expired, token gone", "token");
    expect(segments.filter((s) => s.match)).toHaveLength(2);
    expect(segments.map((s) => s.text).join("")).toBe("token expired, token gone");
  });

  it("busca vazia devolve o texto inteiro sem marcação", () => {
    expect(highlightSegments("abc", "  ")).toEqual([{ text: "abc", match: false }]);
  });
});
