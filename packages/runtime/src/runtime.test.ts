import { describe, expect, it, vi } from "vitest";
import {
  PROTOCOL_VERSION,
  parseMessage,
  serializeMessage,
  type AnyMessage,
  type CommandMessage,
} from "@rnsi/protocol";
import { createMemoryAdapter } from "./memory-adapter.ts";
import { createMMKVAdapter, type MMKVInstanceLike } from "./adapters/mmkv.ts";
import { createRegistry } from "./registry.ts";
import { startRuntime } from "./bootstrap.ts";
import { handleCommand } from "./command-handler.ts";
import type { WebSocketLike } from "./transport.ts";

function command(partial: Pick<CommandMessage, "type" | "payload">): CommandMessage {
  return {
    kind: "command",
    protocolVersion: PROTOCOL_VERSION,
    requestId: "req-1",
    ...partial,
  } as CommandMessage;
}

describe("memory adapter", () => {
  it("faz CRUD e distingue created/updated/removed", async () => {
    const adapter = createMemoryAdapter();
    const changes: string[] = [];
    adapter.subscribe("default", (c) => changes.push(`${c.change}:${c.key}:${c.source}`));

    await adapter.set("default", "a", { type: "string", value: "1" });
    await adapter.set("default", "a", { type: "string", value: "2" });
    adapter.writeFromApp("default", "b", { type: "number", value: 42 });
    await adapter.remove("default", "a");

    expect(changes).toEqual([
      "created:a:studio",
      "updated:a:studio",
      "created:b:app",
      "removed:a:studio",
    ]);
    expect(await adapter.get("default", "a")).toBeNull();
    expect(await adapter.get("default", "b")).toEqual({ type: "number", value: 42 });
  });

  it("remover chave inexistente não emite evento", async () => {
    const adapter = createMemoryAdapter();
    const listener = vi.fn();
    adapter.subscribe("default", listener);
    await adapter.remove("default", "ghost");
    expect(listener).not.toHaveBeenCalled();
  });

  it("rejeita instância desconhecida", async () => {
    const adapter = createMemoryAdapter({ instances: ["only"] });
    await expect(adapter.listKeys("nope")).rejects.toThrow("unknown instance");
  });
});

describe("registry", () => {
  it("registra uma vez só e notifica listeners", () => {
    const registry = createRegistry();
    const seen: string[] = [];
    registry.onRegister((a) => seen.push(a.providerId));

    const adapter = createMemoryAdapter({ providerId: "mmkv", label: "MMKV" });
    registry.register(adapter);
    registry.register(adapter); // idempotente

    expect(seen).toEqual(["mmkv"]);
    expect(registry.describe()).toHaveLength(1);
    expect(registry.describe()[0]?.label).toBe("MMKV");
  });
});

describe("command handler", () => {
  it("lista providers", async () => {
    const registry = createRegistry();
    registry.register(createMemoryAdapter({ providerId: "async-storage", label: "AsyncStorage" }));

    const result = await handleCommand(
      registry,
      command({ type: "provider.list", payload: {} }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const { providers } = result.result as { providers: Array<{ label: string }> };
      expect(providers[0]?.label).toBe("AsyncStorage");
    }
  });

  it("executa set/get/list/remove de ponta a ponta", async () => {
    const registry = createRegistry();
    registry.register(createMemoryAdapter());
    const target = { providerId: "memory", instanceId: "default" };

    const set = await handleCommand(
      registry,
      command({
        type: "key-value.set",
        payload: { ...target, key: "user", value: { type: "json", value: '{"n":1}' } },
      }),
    );
    expect(set.ok).toBe(true);

    const get = await handleCommand(
      registry,
      command({ type: "key-value.get", payload: { ...target, key: "user" } }),
    );
    expect(get.ok).toBe(true);
    if (get.ok) {
      expect(get.result).toEqual({ value: { type: "json", value: '{"n":1}' } });
    }

    const list = await handleCommand(
      registry,
      command({ type: "key-value.list", payload: { ...target } }),
    );
    expect(list.ok).toBe(true);
    if (list.ok) {
      const { entries } = list.result as { entries: Array<{ key: string }> };
      expect(entries.map((e) => e.key)).toEqual(["user"]);
    }
  });

  it("erro estruturado para provider desconhecido — nunca lança", async () => {
    const registry = createRegistry();
    const result = await handleCommand(
      registry,
      command({
        type: "key-value.get",
        payload: { providerId: "ghost", instanceId: "default", key: "x" },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unknown-provider");
  });
});

class FakeSocket implements WebSocketLike {
  sent: string[] = [];
  private listeners = new Map<string, Set<(event?: { data: unknown }) => void>>();

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.emit("close");
  }

  addEventListener(
    type: "open" | "close" | "error" | "message",
    listener: (() => void) | ((event: { data: unknown }) => void),
  ): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener as (event?: { data: unknown }) => void);
    this.listeners.set(type, listeners);
  }

  emit(type: string, event?: { data: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function decode(raw: string): AnyMessage {
  const parsed = parseMessage(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.message;
}

function createNativeMmkv(): MMKVInstanceLike {
  const data = new Map<string, string | number | boolean | ArrayBuffer>();
  const listeners = new Set<(key: string) => void>();
  return {
    getAllKeys: () => [...data.keys()],
    contains: (key) => data.has(key),
    getString: (key) => {
      const value = data.get(key);
      return typeof value === "string" ? value : undefined;
    },
    getNumber: (key) => {
      const value = data.get(key);
      return typeof value === "number" ? value : undefined;
    },
    getBoolean: (key) => {
      const value = data.get(key);
      return typeof value === "boolean" ? value : undefined;
    },
    set(key, value) {
      data.set(key, value);
      for (const listener of listeners) listener(key);
    },
    delete(key) {
      data.delete(key);
      for (const listener of listeners) listener(key);
    },
    addOnValueChangedListener(listener) {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
  };
}

describe("runtime", () => {
  it("assina instâncias que aparecem depois do provider", () => {
    const sockets: FakeSocket[] = [];
    const runtime = startRuntime({
      url: "ws://test",
      sessionToken: "token",
      client: { name: "test-runtime", platform: "node" },
      createWebSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
    const socket = sockets[0];
    expect(socket).toBeDefined();
    if (!socket) throw new Error("socket não criado");

    socket.emit("open");
    socket.emit("message", {
      data: serializeMessage({
        kind: "hello-ack",
        protocolVersion: PROTOCOL_VERSION,
        sessionId: "s1",
      }),
    });

    const adapter = createMMKVAdapter();
    runtime.registry.register(adapter);
    adapter.registerInstance("settings", createNativeMmkv());
    void adapter.set("settings", "theme", { type: "string", value: "dark" });

    const messages = socket.sent.map(decode);
    expect(messages.some((message) => message.kind === "hello")).toBe(true);
    expect(
      messages.some(
        (message) =>
          message.kind === "event" &&
          message.type === "provider.registered" &&
          message.payload.provider.instances.some((i) => i.instanceId === "settings"),
      ),
    ).toBe(true);
    expect(
      messages.some(
        (message) =>
          message.kind === "event" &&
          message.type === "key-value.changed" &&
          message.payload.instanceId === "settings" &&
          message.payload.key === "theme",
      ),
    ).toBe(true);

    runtime.close();
  });
});
