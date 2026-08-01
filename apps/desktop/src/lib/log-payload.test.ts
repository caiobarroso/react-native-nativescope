import { describe, expect, it } from "vitest";
import type { LogArg } from "@rnsi/protocol";
import { describeLogPayload } from "./log-payload.ts";

function arg(value: unknown, overrides: Partial<LogArg> = {}): LogArg {
  return {
    kind: "json",
    preview: "",
    json: JSON.stringify(value, null, 2),
    truncated: false,
    ...overrides,
  };
}

describe("describeLogPayload", () => {
  it("um objeto de uma chave escalar não precisa de workspace", () => {
    // O caso que motivou isto: `console.log("...", { ts })` abria abas,
    // breadcrumb e busca de campos para mostrar um campo que já estava
    // inteiro na linha da mensagem.
    const payload = describeLogPayload(arg({ ts: "01/08/2026, 11:34:05" }));

    expect(payload).toEqual({
      shape: "compact",
      fields: [{ key: "ts", value: "01/08/2026, 11:34:05" }],
    });
  });

  it("mistura de escalares curtos continua compacta", () => {
    const payload = describeLogPayload(arg({ id: 42, ok: true, name: "checkout", nada: null }));

    expect(payload).toEqual({
      shape: "compact",
      fields: [
        { key: "id", value: "42" },
        { key: "ok", value: "true" },
        { key: "name", value: "checkout" },
        { key: "nada", value: "null" },
      ],
    });
  });

  it("aninhamento manda para o workspace — aí existe o que navegar", () => {
    expect(describeLogPayload(arg({ user: { id: 1 } }))).toEqual({ shape: "rich" });
    expect(describeLogPayload(arg({ tags: ["a"] }))).toEqual({ shape: "rich" });
  });

  it("muitas chaves mandam para o workspace — a busca passa a pagar o custo", () => {
    const wide = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`k${i}`, i]));
    expect(describeLogPayload(arg(wide))).toEqual({ shape: "rich" });

    const narrow = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`k${i}`, i]));
    expect(describeLogPayload(arg(narrow)).shape).toBe("compact");
  });

  it("valor longo demais não cabe numa linha de tabela", () => {
    expect(describeLogPayload(arg({ sql: "x".repeat(81) })).shape).toBe("rich");
    expect(describeLogPayload(arg({ sql: "x".repeat(80) })).shape).toBe("compact");
  });

  it("capado no device vai para o workspace — o Raw mostra onde cortou", () => {
    expect(describeLogPayload(arg({ a: 1 }, { truncated: true }))).toEqual({ shape: "rich" });
  });

  it("array de escalares curtos vira tabela indexada", () => {
    expect(describeLogPayload(arg(["a", "b"]))).toEqual({
      shape: "compact",
      fields: [
        { key: "0", value: "a" },
        { key: "1", value: "b" },
      ],
    });
  });

  it("escalar solto é uma linha sem chave", () => {
    expect(describeLogPayload(arg("2026-08-01T11:34:05.236Z"))).toEqual({
      shape: "compact",
      fields: [{ key: "", value: "2026-08-01T11:34:05.236Z" }],
    });
  });

  it("objeto vazio é compacto e vazio — não abre workspace para mostrar nada", () => {
    expect(describeLogPayload(arg({}))).toEqual({ shape: "compact", fields: [] });
  });

  it("JSON inválido cai no workspace em vez de sumir", () => {
    expect(describeLogPayload(arg(null, { json: "{ isto não é json" }))).toEqual({ shape: "rich" });
    expect(describeLogPayload(arg(null, { json: null }))).toEqual({ shape: "rich" });
  });
});
