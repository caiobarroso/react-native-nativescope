import { describe, expect, it } from "vitest";
import type { TableSchema } from "@rnsi/protocol";
import { sameTableSchemas } from "./table-schema-eq.ts";

function table(overrides: Partial<TableSchema> = {}): TableSchema {
  return {
    name: "items",
    columns: [
      { name: "id", declaredType: "INTEGER", notNull: true, pkIndex: 1 },
      { name: "name", declaredType: "TEXT", notNull: false, pkIndex: 0 },
    ],
    rowCount: 3,
    identity: "rowid",
    ...overrides,
  };
}

describe("sameTableSchemas", () => {
  it("reconhece duas cópias estruturalmente iguais", () => {
    // É o caso comum: o zod reparseia a resposta a cada refresh, então os
    // objetos são sempre novos mesmo quando o schema não mudou.
    expect(sameTableSchemas([table()], [table()])).toBe(true);
  });

  it("undefined nunca é igual — primeira carga sempre propaga", () => {
    expect(sameTableSchemas(undefined, [table()])).toBe(false);
  });

  it.each([
    ["contagem", table({ rowCount: 4 })],
    ["marca de estimativa", table({ rowCountIsEstimate: true })],
    ["identidade", table({ identity: "none" })],
    ["kind", table({ kind: "view" })],
    ["unavailable", table({ unavailable: "boom" })],
    ["nome", table({ name: "outro" })],
    ["colunas", table({ columns: [{ name: "id", declaredType: "INTEGER", notNull: true, pkIndex: 1 }] })],
    ["tipo de coluna", table({ columns: [
      { name: "id", declaredType: "TEXT", notNull: true, pkIndex: 1 },
      { name: "name", declaredType: "TEXT", notNull: false, pkIndex: 0 },
    ] })],
  ])("detecta mudança de %s", (_label, changed) => {
    expect(sameTableSchemas([table()], [changed])).toBe(false);
  });

  it("detecta mudança de gravabilidade de view", () => {
    const before = table({ kind: "view", writable: { insert: true, update: true, delete: true } });
    const after = table({ kind: "view", writable: { insert: true, update: false, delete: true } });
    expect(sameTableSchemas([before], [after])).toBe(false);
  });

  it("detecta mudança de dependências", () => {
    const before = table({ kind: "view", dependsOn: ["a"] });
    const after = table({ kind: "view", dependsOn: ["a", "b"] });
    expect(sameTableSchemas([before], [after])).toBe(false);
  });

  it("detecta tabela nova ou removida", () => {
    expect(sameTableSchemas([table()], [table(), table({ name: "outra" })])).toBe(false);
    expect(sameTableSchemas([table(), table({ name: "outra" })], [table()])).toBe(false);
  });
});
