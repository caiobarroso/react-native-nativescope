import { describe, expect, it } from "vitest";
import {
  parseMessage,
  serializeMessage,
  commandMessageSchema,
  storageValueSchema,
  tableSchema,
  rowRefSchema,
  PROTOCOL_VERSION,
  type AnyMessage,
} from "./index.ts";

describe("parseMessage", () => {
  it("rejeita JSON inválido", () => {
    const result = parseMessage("{nope");
    expect(result.ok).toBe(false);
  });

  it("rejeita JSON válido que não é mensagem do protocolo", () => {
    const result = parseMessage(JSON.stringify({ foo: "bar" }));
    expect(result.ok).toBe(false);
  });

  it("aceita um hello de runtime", () => {
    const hello: AnyMessage = {
      kind: "hello",
      protocolVersion: PROTOCOL_VERSION,
      role: "runtime",
      sessionToken: "abc123",
      client: { name: "app-proline", platform: "ios" },
    };
    const result = parseMessage(serializeMessage(hello));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).toEqual(hello);
  });

  it("rejeita hello sem token", () => {
    const raw = JSON.stringify({
      kind: "hello",
      protocolVersion: PROTOCOL_VERSION,
      role: "runtime",
      sessionToken: "",
      client: { name: "x", platform: "ios" },
    });
    expect(parseMessage(raw).ok).toBe(false);
  });

  it("faz roundtrip de um command key-value.set", () => {
    const command: AnyMessage = {
      kind: "command",
      protocolVersion: PROTOCOL_VERSION,
      requestId: "req-1",
      type: "key-value.set",
      payload: {
        providerId: "async-storage",
        instanceId: "default",
        key: "user.profile",
        value: { type: "json", value: JSON.stringify({ name: "Caio" }) },
      },
    };
    const result = parseMessage(serializeMessage(command));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).toEqual(command);
  });

  it("faz roundtrip de um event key-value.changed", () => {
    const event: AnyMessage = {
      kind: "event",
      protocolVersion: PROTOCOL_VERSION,
      timestamp: Date.now(),
      type: "key-value.changed",
      payload: {
        providerId: "mmkv",
        instanceId: "default",
        key: "auth.token",
        change: "removed",
        source: "app",
        entry: null,
      },
    };
    const result = parseMessage(serializeMessage(event));
    expect(result.ok).toBe(true);
  });

  it("faz roundtrip de um hello com deviceId e label (multi-device)", () => {
    const hello: AnyMessage = {
      kind: "hello",
      protocolVersion: PROTOCOL_VERSION,
      role: "runtime",
      sessionToken: "abc123",
      client: {
        name: "react-native-app",
        platform: "ios",
        deviceId: "d-abc",
        label: "iOS",
        features: { storageReactQuerySync: true },
      },
    };
    const result = parseMessage(serializeMessage(hello));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).toEqual(hello);
  });

  it("carrega deviceId no command (roteamento stateless)", () => {
    const command: AnyMessage = {
      kind: "command",
      protocolVersion: PROTOCOL_VERSION,
      requestId: "req-1",
      deviceId: "d-abc",
      type: "provider.list",
      payload: {},
    };
    const result = parseMessage(serializeMessage(command));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).toEqual(command);
  });

  it("carrega deviceId no envelope e no payload de session.connected", () => {
    const event: AnyMessage = {
      kind: "event",
      protocolVersion: PROTOCOL_VERSION,
      timestamp: Date.now(),
      deviceId: "d-abc",
      type: "session.connected",
      payload: {
        sessionId: "session-1",
        client: { name: "react-native-app", platform: "android" },
        providers: [],
        deviceId: "d-abc",
        label: "Android",
      },
    };
    const result = parseMessage(serializeMessage(event));
    expect(result.ok).toBe(true);
    if (
      result.ok &&
      result.message.kind === "event" &&
      result.message.type === "session.connected"
    ) {
      expect(result.message.deviceId).toBe("d-abc");
      expect(result.message.payload.deviceId).toBe("d-abc");
      expect(result.message.payload.label).toBe("Android");
    }
  });

  it("carrega o status de refresh do app em session.connected", () => {
    const event: AnyMessage = {
      kind: "event",
      protocolVersion: PROTOCOL_VERSION,
      timestamp: Date.now(),
      deviceId: "d-abc",
      type: "session.connected",
      payload: {
        sessionId: "session-1",
        client: {
          name: "react-native-app",
          platform: "android",
          features: { storageReactQuerySync: true },
        },
        providers: [],
        deviceId: "d-abc",
        label: "Android",
      },
    };
    const result = parseMessage(serializeMessage(event));
    expect(result.ok).toBe(true);
    if (
      result.ok &&
      result.message.kind === "event" &&
      result.message.type === "session.connected"
    ) {
      expect(result.message.payload.client.features?.storageReactQuerySync).toBe(true);
    }
  });
});

describe("commandMessageSchema", () => {
  it("rejeita command com type desconhecido", () => {
    const parsed = commandMessageSchema.safeParse({
      kind: "command",
      protocolVersion: PROTOCOL_VERSION,
      requestId: "r",
      type: "key-value.explode",
      payload: {},
    });
    expect(parsed.success).toBe(false);
  });

  it("rejeita payload com valor sem tipo explícito", () => {
    const parsed = commandMessageSchema.safeParse({
      kind: "command",
      protocolVersion: PROTOCOL_VERSION,
      requestId: "r",
      type: "key-value.set",
      payload: {
        providerId: "mmkv",
        instanceId: "default",
        key: "k",
        value: "solto sem type tag",
      },
    });
    expect(parsed.success).toBe(false);
  });

  it("aceita key-value.list em modo lean para varreduras de metadado", () => {
    const parsed = commandMessageSchema.safeParse({
      kind: "command",
      protocolVersion: PROTOCOL_VERSION,
      requestId: "r",
      type: "key-value.list",
      payload: {
        providerId: "mmkv",
        instanceId: "cache",
        limit: 500,
        lean: true,
      },
    });
    expect(parsed.success).toBe(true);
  });
});

describe("storageValueSchema", () => {
  it("exige coerência entre type e value", () => {
    expect(storageValueSchema.safeParse({ type: "number", value: "123" }).success).toBe(false);
    expect(storageValueSchema.safeParse({ type: "number", value: 123 }).success).toBe(true);
    expect(storageValueSchema.safeParse({ type: "boolean", value: true }).success).toBe(true);
    expect(storageValueSchema.safeParse({ type: "null", value: null }).success).toBe(true);
  });
});

describe("tableSchema e rowRefSchema — campos aditivos de VIEW", () => {
  const base = {
    name: "players",
    columns: [{ name: "id", declaredType: "INTEGER", notNull: true, pkIndex: 1 }],
    rowCount: 3,
    identity: "rowid" as const,
  };

  it("aceita um schema SEM os campos novos — runtime anterior continua válido", () => {
    const parsed = tableSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    // Ausente ⇒ tabela. O desktop trata como hoje, sem ramo especial.
    expect(parsed.success && parsed.data.kind).toBeUndefined();
    expect(parsed.success && parsed.data.writable).toBeUndefined();
  });

  it("aceita uma view gravável com tudo preenchido", () => {
    const parsed = tableSchema.safeParse({
      ...base,
      name: "todos",
      identity: "pk",
      kind: "view",
      writable: { insert: true, update: true, delete: false },
      dependsOn: ["ps_data__todos"],
    });
    expect(parsed.success).toBe(true);
  });

  it("aceita uma view cuja base sumiu", () => {
    const parsed = tableSchema.safeParse({
      ...base,
      name: "orphan",
      columns: [],
      identity: "none",
      kind: "view",
      unavailable: "no such table: main.tmp_gone",
    });
    expect(parsed.success).toBe(true);
  });

  it("recusa writable parcial — as três operações são obrigatórias juntas", () => {
    const parsed = tableSchema.safeParse({ ...base, kind: "view", writable: { update: true } });
    expect(parsed.success).toBe(false);
  });

  it.each([
    ["rowid", { rowid: 12 }],
    ["pk", { pk: { id: "t_01" } }],
    ["scan", { scan: { offset: 41, orderBy: "created_at", direction: "desc" } }],
  ])("aceita ref do tipo %s", (_label, ref) => {
    expect(rowRefSchema.safeParse(ref).success).toBe(true);
  });

  it("recusa offset negativo numa ref posicional", () => {
    expect(rowRefSchema.safeParse({ scan: { offset: -1 } }).success).toBe(false);
  });

  it("nada disso mexeu na versão do protocolo", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });
});
