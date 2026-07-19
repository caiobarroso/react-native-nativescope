import { DatabaseSync } from "node:sqlite";
import { WebSocket } from "ws";
import {
  startRuntime,
  createMemoryAdapter,
  createExpoSqliteAdapter,
} from "@rnsi/runtime";
import type { WebSocketLike, SQLiteDatabaseLike } from "@rnsi/runtime";

/** SQLite REAL em memória (node:sqlite) atrás da interface do expo-sqlite. */
function createFakeDatabase(): { db: SQLiteDatabaseLike; raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE visits (
      id INTEGER PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      pdv TEXT,
      startedAt TEXT,
      finishedAt TEXT
    );
    INSERT INTO visits (status, pdv, startedAt, finishedAt) VALUES
      ('done', 'Carrefour', '08:00', '08:37'),
      ('pending', 'Pague Menos', NULL, NULL),
      ('done', 'Atacadão', '09:05', '09:44');

    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO tasks (title, done) VALUES
      ('Conferir gôndola', 1),
      ('Foto da fachada', 0),
      ('Ruptura de estoque', 0);
  `);
  const db: SQLiteDatabaseLike = {
    async getAllAsync(sql, params = []) {
      return raw
        .prepare(sql)
        .all(...(params as Array<string | number | null>))
        .map((row) => ({ ...(row as Record<string, unknown>) }));
    },
    async runAsync(sql, params = []) {
      const result = raw.prepare(sql).run(...(params as Array<string | number | null>));
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
  };
  return { db, raw };
}

/**
 * Runtime falso para desenvolvimento e E2E da UI sem device.
 *
 * Sobe o runtime real (mesmo código que roda no app) com um adapter de
 * memória, e simula atividade de app: token renovando, fila de sync
 * crescendo e drenando, feature flag alternando.
 */
export function startFakeRuntime(options: { port: number; sessionToken: string }) {
  const adapter = createMemoryAdapter({
    providerId: "async-storage",
    label: "AsyncStorage",
    seed: {
      default: {
        "auth.token": { type: "string", value: "eyJhbGciOiJIUzI1NiJ9.fake" },
        "user.profile": {
          type: "json",
          value: JSON.stringify({ name: "Caio", premium: false }),
        },
        "feature.flags": {
          type: "json",
          value: JSON.stringify({ newCheckout: true, darkLaunch: false }),
        },
        "sync.queue": { type: "json", value: "[]" },
        "device.info": { type: "json", value: JSON.stringify({ model: "Pixel 8" }) },
        "onboarding.done": { type: "boolean", value: true },
        "session.count": { type: "number", value: 7 },
      },
    },
  });

  // MMKV simulado: duas instâncias, valores tipados de verdade.
  const mmkv = createMemoryAdapter({
    providerId: "mmkv",
    label: "MMKV",
    instances: ["default", "user-cache"],
    seed: {
      default: {
        "app.launchCount": { type: "number", value: 41 },
        "app.lastVersion": { type: "string", value: "2.7.1" },
        "flags.newNavigation": { type: "boolean", value: true },
      },
      "user-cache": {
        "cache.avatarUrl": { type: "string", value: "https://cdn.example/u/caio.png" },
        "cache.ttl": { type: "number", value: 3600 },
      },
    },
  });

  // SQLite simulado: banco real em memória, estilo app-proline.
  const { db, raw } = createFakeDatabase();
  const sqlite = createExpoSqliteAdapter();
  sqlite.registerDatabase("proline.db", db);

  const runtime = startRuntime({
    url: `ws://127.0.0.1:${options.port}`,
    sessionToken: options.sessionToken,
    client: { name: "app-playground (fake)", platform: "android" },
    createWebSocket: (url) => new WebSocket(url) as unknown as WebSocketLike,
  });

  runtime.registry.register(adapter);
  runtime.registry.register(mmkv);
  runtime.registry.register(sqlite);

  let sessionCount = 7;
  let launchCount = 41;
  let queue: string[] = [];

  const timers = [
    // token renova a cada 8s
    setInterval(() => {
      adapter.writeFromApp("default", "auth.token", {
        type: "string",
        value: `eyJhbGciOiJIUzI1NiJ9.${Math.random().toString(36).slice(2)}`,
      });
    }, 8000),

    // fila de sync cresce e drena
    setInterval(() => {
      if (queue.length >= 3) {
        queue = [];
      } else {
        queue.push(`visit-${Date.now()}`);
      }
      adapter.writeFromApp("default", "sync.queue", {
        type: "json",
        value: JSON.stringify(queue),
      });
    }, 5000),

    // contador de sessão
    setInterval(() => {
      sessionCount += 1;
      adapter.writeFromApp("default", "session.count", {
        type: "number",
        value: sessionCount,
      });
    }, 13000),

    // MMKV: launch count subindo — atividade em outro provider
    setInterval(() => {
      launchCount += 1;
      mmkv.writeFromApp("default", "app.launchCount", {
        type: "number",
        value: launchCount,
      });
    }, 11000),

    // SQLite: o "app" insere visitas e conclui pendentes
    setInterval(() => {
      const pdvs = ["Assaí", "Extra", "Dia", "Sam's Club"];
      const insert = raw
        .prepare("INSERT INTO visits (status, pdv) VALUES ('pending', ?)")
        .run(pdvs[Math.floor(Math.random() * pdvs.length)] ?? "Assaí");
      // simula o hook nativo do expo-sqlite disparando
      sqlite.notifyNativeChange("proline.db", "visits", Number(insert.lastInsertRowid));
    }, 9000),
  ];

  return {
    close() {
      for (const t of timers) clearInterval(t);
      runtime.close();
    },
  };
}
