import { describe, expect, it } from "vitest";
import { createSqliteAdapter, type DatabaseChange } from "@rnsi/runtime";
import { createNodeSqlite } from "./fakes/sqlite.ts";

/**
 * O 4º parâmetro `operation` dos notify* e a coerção ao enum do protocolo.
 *
 * A coerção não é cosmética: um valor fora do enum viaja no `database.changed`
 * e faz o `safeParse` do Studio rejeitar a mensagem INTEIRA — o realtime morre
 * sem log e sem erro. Como todo provider de banco passa por aqui, a blindagem
 * mora no core.
 */
function setup(): {
  adapter: ReturnType<typeof createSqliteAdapter>;
  changes: DatabaseChange[];
} {
  const db = createNodeSqlite("CREATE TABLE t (v TEXT);");
  const adapter = createSqliteAdapter({ providerId: "test-sqlite", label: "Test" });
  adapter.registerDatabase("db", db);
  const changes: DatabaseChange[] = [];
  adapter.subscribe("db", (c) => changes.push(c));
  return { adapter, changes };
}

describe("sqlite core — identidade e operação", () => {
  it("providerId e label vêm do parâmetro, não hardcoded", () => {
    const adapter = createSqliteAdapter({ providerId: "op-sqlite", label: "OP-SQLite" });

    expect(adapter.providerId).toBe("op-sqlite");
    expect(adapter.label).toBe("OP-SQLite");
    expect(adapter.capabilities).toEqual([
      "database.query",
      "database.mutate",
      "database.watch",
    ]);
  });

  it("chamada com 3 args (expo-sqlite) continua caindo em unknown", () => {
    const { adapter, changes } = setup();
    adapter.notifyNativeChange("db", "t", 1);

    expect(changes).toEqual([
      { table: "t", rowId: 1, operation: "unknown", source: "app" },
    ]);
  });

  it.each([
    ["INSERT", "insert"],
    ["UPDATE", "update"],
    ["DELETE", "delete"],
    ["insert", "insert"],
  ])("operação %s do updateHook chega como %s", (raw, expected) => {
    const { adapter, changes } = setup();
    adapter.notifyNativeChange("db", "t", 1, raw);

    expect(changes[0]?.operation).toBe(expected);
  });

  it.each(["", "TRUNCATE", "weird", undefined])(
    "operação fora do enum (%s) é coagida para unknown",
    (raw) => {
      const { adapter, changes } = setup();
      adapter.notifyNativeChange("db", "t", 1, raw);

      expect(changes[0]?.operation).toBe("unknown");
    },
  );

  it("notifyAppMutation também aceita e normaliza a operação", () => {
    const { adapter, changes } = setup();
    adapter.notifyAppMutation("db", "t", null, "DELETE");

    expect(changes).toEqual([
      { table: "t", rowId: null, operation: "delete", source: "app" },
    ]);
  });
});
