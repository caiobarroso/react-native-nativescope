import { describe, expect, it } from "vitest";
import {
  parseMessage,
  serializeMessage,
  commandMessageSchema,
  storageValueSchema,
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
});

describe("storageValueSchema", () => {
  it("exige coerência entre type e value", () => {
    expect(storageValueSchema.safeParse({ type: "number", value: "123" }).success).toBe(false);
    expect(storageValueSchema.safeParse({ type: "number", value: 123 }).success).toBe(true);
    expect(storageValueSchema.safeParse({ type: "boolean", value: true }).success).toBe(true);
    expect(storageValueSchema.safeParse({ type: "null", value: null }).success).toBe(true);
  });
});
