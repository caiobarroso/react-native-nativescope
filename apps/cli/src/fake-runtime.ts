import { DatabaseSync } from "node:sqlite";
import { WebSocket } from "ws";
import { NETWORK_BODY_INLINE_LIMIT } from "@rnsi/protocol";
import {
  startRuntime,
  createMemoryAdapter,
  createExpoSqliteAdapter,
  createOpSqliteAdapter,
} from "@rnsi/runtime";
import type { WebSocketLike, SQLiteDatabaseLike } from "@rnsi/runtime";

/** Semente GB-scale (plano de grandes volumes §E): prova os orçamentos ao vivo. */
function seedScale(
  raw: DatabaseSync,
  adapter: ReturnType<typeof createMemoryAdapter>,
): void {
  // 5.000 chaves pequenas + valores grandes (o preview/get-full/export em ação)
  for (let i = 0; i < 5000; i += 1) {
    adapter.writeFromApp("default", `bulk.item.${String(i).padStart(4, "0")}`, {
      type: "json",
      value: JSON.stringify({
        index: i,
        status: i % 3 === 0 ? "done" : "pending",
      }),
    });
  }
  adapter.writeFromApp("default", "huge.payload", {
    type: "json",
    value: JSON.stringify({ blob: "x".repeat(2 * 1024 * 1024) }), // ~2 MB
  });
  adapter.writeFromApp("default", "huge.text", {
    type: "string",
    value: "linha de log repetida para simular dump grande\n".repeat(20_000), // ~900 KB
  });

  // 100k linhas de uma vez (CTE recursiva — rápido) + uma célula de ~1 MB
  raw.exec(`
    CREATE TABLE events (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      payload TEXT
    );
    INSERT INTO events (kind, payload)
    WITH RECURSIVE cnt(v) AS (SELECT 1 UNION ALL SELECT v + 1 FROM cnt WHERE v < 100000)
    SELECT 'event-' || (v % 7), 'payload ' || v FROM cnt;
  `);
  raw
    .prepare("INSERT INTO events (kind, payload) VALUES ('gigante', ?)")
    .run("dado-enorme ".repeat(90_000)); // ~1 MB numa célula
}

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
      const result = raw
        .prepare(sql)
        .run(...(params as Array<string | number | null>));
      return {
        changes: Number(result.changes),
        lastInsertRowId: Number(result.lastInsertRowid),
      };
    },
  };
  return { db, raw };
}

/**
 * Segundo banco, com coluna BLOB, para o Studio poder ser validado com DOIS
 * providers de banco ao mesmo tempo sem precisar de device — inclusive o
 * caminho de blob, que nenhum outro fixture exercita.
 */
function createFakePhotos(): { db: SQLiteDatabaseLike; raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      thumb BLOB,
      likes INTEGER NOT NULL DEFAULT 0
    );
  `);
  const insert = raw.prepare("INSERT INTO photos (title, thumb, likes) VALUES (?, ?, ?)");
  const thumb = (seed: number, size: number): Uint8Array =>
    new Uint8Array(Array.from({ length: size }, (_, i) => (i * seed + 7) % 256));
  insert.run("praia", thumb(3, 96), 12);
  insert.run("serra", thumb(5, 8_000), 4); // grande: trunca no preview
  insert.run("sem thumb", null, 0);

  const db: SQLiteDatabaseLike = {
    async getAllAsync(sql, params = []) {
      return raw
        .prepare(sql)
        .all(...(params as Array<string | number | null>))
        .map((row) => ({ ...(row as Record<string, unknown>) }));
    },
    async runAsync(sql, params = []) {
      const result = raw.prepare(sql).run(...(params as Array<string | number | null>));
      return {
        changes: Number(result.changes),
        lastInsertRowId: Number(result.lastInsertRowid),
      };
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
export function startFakeRuntime(options: {
  port: number;
  sessionToken: string;
  /** true: semente GB-scale — 100k linhas SQLite, 5k chaves, valores de MB. */
  scale?: boolean;
  /** Plataforma reportada no hello; default "android". Um segundo fake com
   * --platform ios testa multi-device. */
  platform?: string;
  /** Id do device; default derivado da plataforma. */
  deviceId?: string;
}) {
  const platform = options.platform ?? "android";
  const deviceId = options.deviceId ?? `fake-${platform}`;
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
        "device.info": {
          type: "json",
          value: JSON.stringify({ model: "Pixel 8" }),
        },
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
        "cache.avatarUrl": {
          type: "string",
          value: "https://cdn.example/u/caio.png",
        },
        "cache.ttl": { type: "number", value: 3600 },
      },
    },
  });

  // SQLite simulado: banco real em memória, estilo app-proline.
  const { db, raw } = createFakeDatabase();
  const sqlite = createExpoSqliteAdapter();
  sqlite.registerDatabase("proline.db", db);

  // Segundo provider de banco: prova que o Studio lida com N SQLites e permite
  // validar a UI multi-provider (e o caminho de BLOB) sem device.
  const { db: photosDb, raw: photosRaw } = createFakePhotos();
  const opSqlite = createOpSqliteAdapter();
  opSqlite.registerDatabase("photos.db", photosDb, { hasChangeListener: true });

  if (options.scale) seedScale(raw, adapter);

  const runtime = startRuntime({
    url: `ws://127.0.0.1:${options.port}`,
    sessionToken: options.sessionToken,
    client: {
      name: "app-playground (fake)",
      platform,
      deviceId,
      label:
        platform === "ios"
          ? "iOS"
          : platform === "android"
            ? "Android"
            : platform,
    },
    createWebSocket: (url) => new WebSocket(url) as unknown as WebSocketLike,
  });

  runtime.registry.register(adapter);
  runtime.registry.register(mmkv);
  runtime.registry.register(sqlite);
  runtime.registry.register(opSqlite);

  // Network simulado (envelope L3) — popula a aba Network do Studio sem device.
  type NetSpec = {
    method: string;
    pathq: string;
    status: number;
    duration: number;
    request?: string;
    response?: string;
  };
  const netOrigin = "https://api.app.com";
  const netSpecs: NetSpec[] = [
    {
      method: "GET",
      pathq: "/products?page=1",
      status: 200,
      duration: 142,
      response: JSON.stringify(
        {
          page: 1,
          items: [
            { id: 1, name: "Arroz 5kg", price: 24.9 },
            { id: 2, name: "Feijão 1kg", price: 8.5 },
          ],
        },
        null,
        2,
      ),
    },
    {
      method: "GET",
      pathq: "/products?page=2",
      status: 200,
      duration: 128,
      response: JSON.stringify(
        { page: 2, items: [{ id: 3, name: "Café 500g", price: 18 }] },
        null,
        2,
      ),
    },
    {
      method: "GET",
      pathq: "/products?page=3",
      status: 200,
      duration: 173,
      response: JSON.stringify({ page: 3, items: [] }, null, 2),
    },
    {
      method: "POST",
      pathq: "/login",
      status: 200,
      duration: 306,
      request: JSON.stringify(
        { email: "caio@example.com", password: "•••••••" },
        null,
        2,
      ),
      response: JSON.stringify(
        {
          token: "eyJhbGciOiJIUzI1NiJ9.fake",
          user: { id: 7, name: "Caio", premium: false },
        },
        null,
        2,
      ),
    },
    {
      method: "GET",
      pathq: "/profile",
      status: 200,
      duration: 88,
      response: JSON.stringify(
        {
          id: 7,
          name: "Caio",
          email: "caio@example.com",
          roles: ["admin"],
          settings: { theme: "dark", notifications: true },
        },
        null,
        2,
      ),
    },
    {
      method: "GET",
      pathq: "/feed",
      status: 200,
      duration: 214,
      response: JSON.stringify(
        {
          items: Array.from({ length: 12 }, (_, i) => ({
            id: i + 1,
            title: `Post ${i + 1}`,
            likes: (i * 7) % 50,
          })),
        },
        null,
        2,
      ),
    },
    {
      method: "POST",
      pathq: "/graphql",
      status: 200,
      duration: 118,
      request: JSON.stringify({
        operationName: "GetViewer",
        query: `query GetViewer($includeTeams: Boolean!) {
  viewer {
    id
    name
    email
    teams @include(if: $includeTeams) {
      id
      name
      role
    }
  }
}`,
        variables: { includeTeams: true },
      }),
      response: JSON.stringify(
        {
          data: {
            viewer: {
              id: "usr_7",
              name: "Caio",
              email: "caio@example.com",
              teams: [
                { id: "team_1", name: "Mobile", role: "OWNER" },
                { id: "team_2", name: "Product", role: "MEMBER" },
              ],
            },
          },
        },
        null,
        2,
      ),
    },
    {
      method: "POST",
      pathq: "/graphql",
      status: 200,
      duration: 184,
      request: JSON.stringify({
        operationName: "UpdateNotificationSettings",
        query: `mutation UpdateNotificationSettings($input: NotificationSettingsInput!) {
  updateNotificationSettings(input: $input) {
    settings {
      email
      push
      digest
    }
    updatedAt
  }
}`,
        variables: {
          input: { email: true, push: false, digest: "WEEKLY" },
        },
      }),
      response: JSON.stringify(
        {
          data: {
            updateNotificationSettings: {
              settings: {
                email: true,
                push: false,
                digest: "WEEKLY",
              },
              updatedAt: "2026-07-29T14:30:00.000Z",
            },
          },
        },
        null,
        2,
      ),
    },
    {
      method: "POST",
      pathq: "/graphql",
      status: 200,
      duration: 247,
      request: JSON.stringify({
        operationName: "CreateCheckout",
        query: `mutation CreateCheckout($cartId: ID!) {
  createCheckout(cartId: $cartId) {
    id
    status
  }
}`,
        variables: { cartId: "cart_expired" },
      }),
      response: JSON.stringify(
        {
          data: { createCheckout: null },
          errors: [
            {
              message: "The cart has expired",
              path: ["createCheckout"],
              extensions: { code: "CART_EXPIRED" },
            },
          ],
        },
        null,
        2,
      ),
    },
    {
      method: "GET",
      pathq: "/orders/9182",
      status: 404,
      duration: 61,
      response: JSON.stringify(
        { error: "not_found", message: "Order 9182 does not exist" },
        null,
        2,
      ),
    },
    {
      method: "POST",
      pathq: "/checkout",
      status: 500,
      duration: 523,
      request: JSON.stringify({ cart: [1, 2, 3], coupon: "SAVE10" }),
      response: JSON.stringify(
        { error: "internal", message: "Payment provider timeout" },
        null,
        2,
      ),
    },
    {
      // Corpo grande de propósito: é o caso em que "Load full body" tem de sair
      // por stream. Antes ele voltava inteiro num command-result e o runtime
      // gritava "frame exceeds the wire budget" no terminal do app.
      method: "GET",
      pathq: "/reports/export?range=90d",
      status: 200,
      duration: 1840,
      response: JSON.stringify(
        {
          range: "90d",
          rows: Array.from({ length: 4000 }, (_, i) => ({
            id: i + 1,
            sku: `SKU-${String(i + 1).padStart(6, "0")}`,
            label: `Item de relatório ${i + 1} com descrição longa para inflar o corpo`,
            revenue: Number(((i * 137) % 9999) + 0.99),
            region: ["norte", "nordeste", "sudeste", "sul", "centro-oeste"][i % 5],
          })),
        },
        null,
        2,
      ),
    },
  ];
  /** Preview no evento; o resto vem por get-body. Espelha maxBodyPreview do device. */
  const NET_PREVIEW_CHARS = 4 * 1024;
  const netStatusText: Record<number, string> = {
    200: "OK",
    404: "Not Found",
    500: "Internal Server Error",
  };
  let netId = 1;
  let netCursor = 0;
  const emittedById = new Map<string, Record<string, unknown>>();
  /**
   * Corpo ÍNTEGRO por request, para o get-body ter o que devolver — inclusive
   * acima do limite inline, que é o caminho de stream. Sem isto o fake não
   * exercitava o "load full body" de corpo grande, que é justamente onde o
   * command-result estourava o orçamento de fio.
   */
  const fullBodies = new Map<string, { request: string | null; response: string | null }>();
  const emitRequest = (spec: NetSpec): void => {
    const q = spec.pathq.indexOf("?");
    const path = q === -1 ? spec.pathq : spec.pathq.slice(0, q);
    const query = q === -1 ? null : spec.pathq.slice(q + 1);
    const now = Date.now();
    const resText = spec.response ?? "";
    const reqText = spec.request ?? null;
    const record: Record<string, unknown> = {
      id: `fake-net-${netId++}`,
      method: spec.method,
      url: netOrigin + spec.pathq,
      origin: netOrigin,
      path,
      query,
      status: spec.status,
      statusText: netStatusText[spec.status] ?? "",
      ok: spec.status >= 200 && spec.status < 300,
      error: null,
      startedAt: now - spec.duration,
      endedAt: now,
      duration: spec.duration,
      requestSize: reqText ? Buffer.byteLength(reqText) : 0,
      responseSize: Buffer.byteLength(resText),
      requestHeaders:
        spec.method === "POST"
          ? {
              "Content-Type": "application/json",
              Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.fake",
            }
          : {
              Accept: "application/json",
              Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.fake",
            },
      responseHeaders: {
        "content-type": "application/json; charset=utf-8",
        "content-length": String(Buffer.byteLength(resText)),
      },
      // Preview capado como no device: o EVENTO também tem orçamento de fio, e
      // o corpo íntegro vem sob demanda por get-body.
      requestBody: reqText
        ? {
            text: reqText.slice(0, NET_PREVIEW_CHARS),
            size: Buffer.byteLength(reqText),
            truncated: reqText.length > NET_PREVIEW_CHARS,
            contentType: "application/json",
            kind: "json",
          }
        : null,
      responseBody: resText
        ? {
            text: resText.slice(0, NET_PREVIEW_CHARS),
            size: Buffer.byteLength(resText),
            truncated: resText.length > NET_PREVIEW_CHARS,
            contentType: "application/json",
            kind:
              resText.trimStart().startsWith("{") ||
              resText.trimStart().startsWith("[")
                ? "json"
                : "text",
          }
        : null,
    };
    emittedById.set(record.id as string, record);
    fullBodies.set(record.id as string, { request: reqText, response: resText || null });
    runtime.sendModuleEvent("network", "request", record);

    // Efeito de storage correlacionado — o "app" escreve logo após certas
    // respostas, para demonstrar o storage-impact (correlação temporal).
    if (spec.pathq.startsWith("/login") || spec.pathq.startsWith("/profile")) {
      const kind = spec.pathq.startsWith("/login") ? "login" : "profile";
      setTimeout(() => {
        try {
          if (kind === "login") {
            adapter.writeFromApp("default", "auth.token", {
              type: "string",
              value: `eyJhbGciOiJIUzI1NiJ9.${Math.random().toString(36).slice(2)}`,
            });
            mmkv.writeFromApp("default", "auth.user", {
              type: "json",
              value: JSON.stringify({ id: 7, name: "Caio", premium: false }),
            });
          } else {
            adapter.writeFromApp("default", "user.profile", {
              type: "json",
              value: JSON.stringify({
                name: "Caio",
                premium: false,
                seenAt: Date.now(),
              }),
            });
          }
        } catch {
          /* instrumentação do fake nunca propaga */
        }
      }, 40);
    }
  };

  // Replay simulado: reexecuta a partir do capturado + overrides, emitindo uma
  // nova request (replayOf) — espelha o módulo real no device (que é testado à
  // parte). get-body devolve indisponível (o fake não guarda corpo íntegro).
  runtime.onModuleCommand("network", (command, data, context) => {
    const input = (data && typeof data === "object" ? data : {}) as {
      id?: string;
      overrides?: {
        query?: string | null;
        headers?: Record<string, string>;
        removedHeaders?: string[];
        body?: string | null;
      };
    };
    if (command === "replay") {
      const orig = input.id ? emittedById.get(input.id) : undefined;
      if (!orig) return { id: null };
      const overrides = input.overrides ?? {};
      const query =
        overrides.query !== undefined
          ? overrides.query
          : (orig.query as string | null);
      const url =
        netOrigin +
        (orig.path as string) +
        (query ? `?${query.replace(/^\?/, "")}` : "");
      let headers = { ...(orig.requestHeaders as Record<string, string>) };
      for (const name of overrides.removedHeaders ?? []) {
        const lower = name.toLowerCase();
        headers = Object.fromEntries(
          Object.entries(headers).filter(
            ([key]) => key.toLowerCase() !== lower,
          ),
        );
      }
      headers = { ...headers, ...(overrides.headers ?? {}) };
      const bodyText =
        overrides.body !== undefined
          ? overrides.body
          : ((orig.requestBody as { text?: string } | null)?.text ?? null);
      const now = Date.now();
      const newId = `fake-net-${netId++}`;
      const record: Record<string, unknown> = {
        ...orig,
        id: newId,
        replayOf: input.id,
        url,
        query: query ?? null,
        requestHeaders: headers,
        startedAt: now - 120,
        endedAt: now,
        duration: 120,
        requestBody: bodyText
          ? {
              text: bodyText,
              size: Buffer.byteLength(bodyText),
              truncated: false,
              contentType: "application/json",
              kind: "json",
            }
          : null,
      };
      emittedById.set(newId, record);
      runtime.sendModuleEvent("network", "request", record);
      return { id: newId };
    }
    if (command === "get-body") {
      const stored = input.id ? fullBodies.get(input.id) : undefined;
      const side = (data as { side?: unknown })?.side === "request" ? "request" : "response";
      const text = stored ? stored[side] : null;
      if (text === null || text === undefined) return { available: false, body: null };
      const body = {
        text,
        size: Buffer.byteLength(text),
        truncated: false,
        contentType: "application/json",
        kind: text.trimStart().startsWith("{") || text.trimStart().startsWith("[")
          ? ("json" as const)
          : ("text" as const),
      };
      // Mesma regra do módulo real: acima do limite inline o corpo vai por
      // stream, e o command-result leva só metadados.
      if (text.length <= NETWORK_BODY_INLINE_LIMIT) return { available: true, body };
      return {
        available: true,
        body: { ...body, text: "" },
        streamId: context.streamText(text),
        totalSize: text.length,
      };
    }
    return null;
  });

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
      // simula o hook nativo do expo-sqlite disparando — sem a operação, que é
      // o que aquele hook realmente entrega
      sqlite.notifyNativeChange(
        "proline.db",
        "visits",
        Number(insert.lastInsertRowid),
      );
    }, 9000),

    // OP-SQLite: o "app" curte e publica fotos. Ao contrário do expo, o
    // updateHook do op-sqlite informa a operação, então a timeline mostra
    // INSERT/UPDATE de verdade em vez de "unknown".
    setInterval(() => {
      const rows = photosRaw.prepare("SELECT id FROM photos ORDER BY id").all();
      if (rows.length > 0 && Math.random() > 0.4) {
        const target = rows[Math.floor(Math.random() * rows.length)] as { id: number };
        photosRaw.prepare("UPDATE photos SET likes = likes + 1 WHERE id = ?").run(target.id);
        opSqlite.notifyNativeChange("photos.db", "photos", target.id, "UPDATE");
        return;
      }
      const titles = ["pôr do sol", "trilha", "centro", "cachoeira"];
      const inserted = photosRaw
        .prepare("INSERT INTO photos (title, likes) VALUES (?, 0)")
        .run(titles[Math.floor(Math.random() * titles.length)] ?? "foto");
      opSqlite.notifyNativeChange(
        "photos.db",
        "photos",
        Number(inserted.lastInsertRowid),
        "INSERT",
      );
    }, 7000),

    // Network: burst inicial (após o handshake) + tráfego contínuo determinístico
    // (round-robin) — cada reload do Studio reenche rápido e previsível.
    setTimeout(() => {
      for (const spec of netSpecs) emitRequest(spec);
    }, 900),
    setInterval(() => {
      emitRequest(netSpecs[netCursor % netSpecs.length]!);
      netCursor += 1;
    }, 2000),
  ];

  return {
    close() {
      for (const t of timers) clearInterval(t);
      runtime.close();
    },
  };
}
