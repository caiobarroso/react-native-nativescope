import {
  createExpoSqliteAdapter,
  createOpSqliteAdapter,
  createSqliteAdapter,
  createOpSqliteInstance,
  isDdl,
  mutationTable,
} from "@rnsi/runtime";
import { describeDatabaseAdapterContract } from "./database-contract.ts";
import type { SqliteAdapter } from "@rnsi/runtime";
import { createNodeSqlite } from "./fakes/sqlite.ts";
import { createFakeOpSqlite } from "./fakes/op-sqlite.ts";

/**
 * O mesmo contrato rodando nos quatro caminhos que existem em produção.
 *
 * Rodar em op-sqlite não é redundância: ali o SQL passa pela bridge de
 * `execute`, com instrumentação de statement e updateHook multiplexado por
 * cima. É onde uma diferença de driver aparece — e antes deste arquivo cada
 * driver era provado por uma suíte concreta própria, então divergência entre
 * eles só aparecia no device de alguém.
 */

/** O farejamento de SQL que todo shim faz, idêntico em todos os drivers. */
function sniff(adapter: SqliteAdapter, instanceId: string, sql: string): void {
  const table = mutationTable(sql) ?? "*";
  if (isDdl(sql)) adapter.notifySchemaChanged(instanceId, table);
  if (/^\s*(insert|replace|update|delete|create|drop|alter)\b/i.test(sql)) {
    adapter.notifyAppMutation(instanceId, table, null);
  }
}

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
      notify: (sql) => sniff(adapter, "app.db", sql),
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
      // O DML já chegou pelo updateHook do fake; o que falta é o DDL, que o
      // hook nativo por definição não vê.
      notify: (sql) => {
        if (isDdl(sql)) adapter.notifySchemaChanged("app.db", mutationTable(sql) ?? "*");
      },
    };
  },
});

/**
 * O expo como o shim REGISTRA de verdade: `hasChangeListener: true` e o
 * `runAsync` instrumentado no próprio objeto, farejando o SQL.
 *
 * Registrar sem `hasChangeListener` — como a variante acima faz — deixava o
 * caminho do eco (`pendingStudioWrites`) inteiramente fora do contrato, embora
 * seja o caminho de produção. O que este harness NÃO modela é o
 * `addDatabaseChangeListener` nativo, que notifica pela tabela física; esse
 * lado é provado no harness do op-sqlite, cujo fake simula o hook de verdade.
 */
describeDatabaseAdapterContract({
  name: "expo-sqlite (com hook, como o shim registra)",
  createHarness: (setupSql) => {
    const db = createNodeSqlite(setupSql);
    const adapter = createExpoSqliteAdapter();

    // Espelha apps/cli/metro/shims/expo-sqlite.js: wrap in-place, mesmas
    // funções de farejamento, e só então registra.
    const originalRun = db.runAsync.bind(db);
    db.runAsync = async (sql, params) => {
      const result = await originalRun(sql, params);
      sniff(adapter, "app.db", sql);
      return result;
    };
    adapter.registerDatabase("app.db", db, { hasChangeListener: true });

    return {
      adapter,
      instanceId: "app.db",
      exec: async (sql) => {
        await db.runAsync(sql);
      },
      query: (sql) => db.getAllAsync(sql),
      // O wrap in-place já notificou dentro do exec — notificar de novo aqui
      // seria inventar um evento que o driver não produz.
      notify: () => {},
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
      notify: (sql) => sniff(adapter, "app.db", sql),
    };
  },
});
