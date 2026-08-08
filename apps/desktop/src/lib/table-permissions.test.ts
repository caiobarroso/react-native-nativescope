import { describe, expect, it } from "vitest";
import type { TableSchema } from "@rnsi/protocol";
import { tableLockLabel, tablePermissions } from "./table-permissions.ts";

function schema(overrides: Partial<TableSchema> = {}): TableSchema {
  return {
    name: "t",
    columns: [{ name: "id", declaredType: "INTEGER", notNull: true, pkIndex: 1 }],
    rowCount: 1,
    identity: "rowid",
    ...overrides,
  };
}

describe("tablePermissions", () => {
  it("tabela comum permite tudo, sem explicação a dar", () => {
    expect(tablePermissions(schema())).toEqual({
      update: true,
      insert: true,
      bulkDelete: true,
      deleteAll: true,
      reason: null,
    });
  });

  it("tabela sem identidade é só-leitura e diz o motivo", () => {
    const permissions = tablePermissions(schema({ identity: "none" }));
    expect(permissions.update).toBe(false);
    expect(permissions.reason).toContain("no rowid or primary key");
  });

  it("schema ainda não carregado não escreve nem explica", () => {
    expect(tablePermissions(undefined).reason).toBeNull();
    expect(tablePermissions(undefined).update).toBe(false);
  });

  it("view sem trigger é só-leitura, e o motivo é OUTRO", () => {
    const permissions = tablePermissions(
      schema({ kind: "view", identity: "none", writable: { insert: false, update: false, delete: false } }),
    );
    expect(permissions.update).toBe(false);
    // A distinção importa: "sem rowid" manda o usuário procurar uma PK que
    // nunca vai existir numa view.
    expect(permissions.reason).toContain("INSTEAD OF");
    expect(permissions.reason).not.toContain("primary key");
  });

  it("view gravável permite editar e inserir", () => {
    const permissions = tablePermissions(
      schema({ kind: "view", identity: "pk", writable: { insert: true, update: true, delete: true } }),
    );
    expect(permissions.update).toBe(true);
    expect(permissions.insert).toBe(true);
    expect(permissions.reason).toBeNull();
  });

  it("view gravável NUNCA oferece lote nem esvaziar", () => {
    const permissions = tablePermissions(
      schema({ kind: "view", identity: "pk", writable: { insert: true, update: true, delete: true } }),
    );
    // Cada linha precisa ser verificada uma a uma, e um DELETE sem WHERE
    // dispararia o trigger uma vez por linha.
    expect(permissions.bulkDelete).toBe(false);
    expect(permissions.deleteAll).toBe(false);
  });

  it("view com trigger parcial diz o que falta", () => {
    const permissions = tablePermissions(
      schema({ kind: "view", identity: "pk", writable: { insert: false, update: true, delete: false } }),
    );
    expect(permissions.update).toBe(true);
    expect(permissions.insert).toBe(false);
    expect(permissions.reason).toContain("insert or delete");
  });

  it("view com trigger mas sem chave derivável permite inserir, não editar", () => {
    const permissions = tablePermissions(
      schema({ kind: "view", identity: "none", writable: { insert: true, update: true, delete: true } }),
    );
    expect(permissions.insert).toBe(true);
    expect(permissions.update).toBe(false);
    expect(permissions.reason).toContain("OLD columns");
  });

  it("view órfã explica que a base sumiu", () => {
    const permissions = tablePermissions(
      schema({ kind: "view", identity: "none", unavailable: "no such table: main.gone" }),
    );
    expect(permissions.update).toBe(false);
    expect(permissions.reason).toContain("no such table: main.gone");
  });
});

describe("tableLockLabel", () => {
  it("não põe cadeado no que é editável", () => {
    expect(tableLockLabel(schema())).toBeNull();
    expect(
      tableLockLabel(
        schema({ kind: "view", identity: "pk", writable: { insert: true, update: true, delete: true } }),
      ),
    ).toBeNull();
  });

  it.each([
    [schema({ identity: "none" }), "no rowid or primary key"],
    [
      schema({ kind: "view", identity: "none", writable: { insert: false, update: false, delete: false } }),
      "without INSTEAD OF triggers",
    ],
    [schema({ kind: "view", identity: "none", unavailable: "boom" }), "underlying table is gone"],
  ])("explica o cadeado com o motivo certo", (input, expected) => {
    expect(tableLockLabel(input)).toContain(expected);
  });
});
