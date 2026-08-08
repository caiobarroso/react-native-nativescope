import {
  createExpoSqliteAdapter,
  createOpSqliteAdapter,
  createSqliteAdapter,
  createOpSqliteInstance,
} from "@rnsi/runtime";
import { describeDatabaseAdapterContract } from "./database-contract.ts";
import { createNodeSqlite } from "./fakes/sqlite.ts";
import { createFakeOpSqlite } from "./fakes/op-sqlite.ts";

/**
 * O mesmo contrato rodando nos três caminhos que existem em produção.
 *
 * Rodar em op-sqlite não é redundância: ali o SQL passa pela bridge de
 * `execute`, com instrumentação de statement e updateHook multiplexado por
 * cima. É onde uma diferença de driver aparece — e antes deste arquivo cada
 * driver era provado por uma suíte concreta própria, então divergência entre
 * eles só aparecia no device de alguém.
 */

describeDatabaseAdapterContract({
  name: "expo-sqlite",
  createHarness: (setupSql) => {
    const db = createNodeSqlite(setupSql);
    const adapter = createExpoSqliteAdapter();
    adapter.registerDatabase("app.db", db);
    return {
      adapter,
      instanceId: "app.db",
      exec: async (sql) => {
        await db.runAsync(sql);
      },
      query: (sql) => db.getAllAsync(sql),
    };
  },
});

describeDatabaseAdapterContract({
  name: "op-sqlite",
  createHarness: (setupSql) => {
    const fake = createFakeOpSqlite({ setupSql });
    const adapter = createOpSqliteAdapter();
    const instance = createOpSqliteInstance({ instanceId: "app.db", adapter });
    instance.attach(fake);
    adapter.registerDatabase("app.db", instance.database, {
      hasChangeListener: instance.hasChangeListener(),
    });
    return {
      adapter,
      instanceId: "app.db",
      exec: async (sql) => {
        await fake.execute(sql);
      },
      query: async (sql) => {
        const result = await fake.execute(sql);
        return (result.rows ?? []) as Array<Record<string, unknown>>;
      },
    };
  },
});

describeDatabaseAdapterContract({
  name: "core (sem identidade de driver)",
  createHarness: (setupSql) => {
    const db = createNodeSqlite(setupSql);
    const adapter = createSqliteAdapter({ providerId: "custom", label: "Custom" });
    adapter.registerDatabase("app.db", db);
    return {
      adapter,
      instanceId: "app.db",
      exec: async (sql) => {
        await db.runAsync(sql);
      },
      query: (sql) => db.getAllAsync(sql),
    };
  },
});
