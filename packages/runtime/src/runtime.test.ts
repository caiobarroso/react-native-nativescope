import { describe, expect, it, vi } from "vitest";
import {
  KEY_VALUE_PREVIEW_LIMIT,
  PROTOCOL_VERSION,
  STREAM_CHUNK_SIZE,
  parseMessage,
  serializeMessage,
  type AnyMessage,
  type CommandMessage,
  type EventMessage,
} from "@rnsi/protocol";
import { createMemoryAdapter } from "./memory-adapter.ts";
import { createMMKVAdapter, type MMKVInstanceLike } from "./adapters/mmkv.ts";
import { createRegistry } from "./registry.ts";
import { startRuntime } from "./bootstrap.ts";
import { handleCommand } from "./command-handler.ts";
import { createStreamHub, fnv1a32 } from "./streams.ts";
import { createCoalescer } from "./event-coalescer.ts";
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
      expect(get.result).toEqual({
        value: { type: "json", value: '{"n":1}' },
        truncated: false,
        totalSize: 7,
      });
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

  it("get trunca valores acima do limite e anuncia o tamanho real", async () => {
    const registry = createRegistry();
    registry.register(createMemoryAdapter());
    const target = { providerId: "memory", instanceId: "default" };
    const big = "x".repeat(KEY_VALUE_PREVIEW_LIMIT + 10);

    await handleCommand(
      registry,
      command({
        type: "key-value.set",
        payload: { ...target, key: "big", value: { type: "string", value: big } },
      }),
    );
    const get = await handleCommand(
      registry,
      command({ type: "key-value.get", payload: { ...target, key: "big" } }),
    );
    expect(get.ok).toBe(true);
    if (get.ok) {
      const result = get.result as { value: { value: string }; truncated: boolean; totalSize: number };
      expect(result.truncated).toBe(true);
      expect(result.totalSize).toBe(big.length);
      expect(result.value.value).toHaveLength(KEY_VALUE_PREVIEW_LIMIT);
    }
  });

  it("get-full entrega 100% do valor em chunks com checksum válido", async () => {
    const registry = createRegistry();
    registry.register(createMemoryAdapter());
    const target = { providerId: "memory", instanceId: "default" };
    const big = "abc123".repeat(30_000); // ~180 KB → 3 chunks

    await handleCommand(
      registry,
      command({
        type: "key-value.set",
        payload: { ...target, key: "big", value: { type: "string", value: big } },
      }),
    );

    const events: EventMessage[] = [];
    const streams = createStreamHub((event) => events.push(event));
    const result = await handleCommand(
      registry,
      command({ type: "key-value.get-full", payload: { ...target, key: "big" } }),
      { streams },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { streamId, totalSize } = result.result as { streamId: string; totalSize: number };
    expect(totalSize).toBe(big.length);

    // Espera o job de streaming (breathe entre chunks) terminar.
    await vi.waitFor(() => {
      expect(
        events.some((e) => e.type === "stream.end" && e.payload.streamId === streamId),
      ).toBe(true);
    });

    const chunks = events.filter(
      (e): e is Extract<EventMessage, { type: "stream.chunk" }> => e.type === "stream.chunk",
    );
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.payload.data.length).toBeLessThanOrEqual(STREAM_CHUNK_SIZE);
    }
    const data = chunks.map((c) => c.payload.data).join("");
    expect(data).toBe(big);

    const end = events.find(
      (e): e is Extract<EventMessage, { type: "stream.end" }> => e.type === "stream.end",
    );
    expect(end?.payload.ok).toBe(true);
    expect(end?.payload.checksum).toBe(fnv1a32(big).toString(16));
  });

  it("stream.cancel interrompe a transmissão", async () => {
    const events: EventMessage[] = [];
    const streams = createStreamHub((event) => events.push(event));
    const streamId = streams.streamText("y".repeat(STREAM_CHUNK_SIZE * 5));
    streams.cancel(streamId);
    // Dá tempo para o job rodar (e provar que NÃO emitiu nada).
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events.filter((e) => e.type === "stream.chunk")).toHaveLength(0);
    expect(events.filter((e) => e.type === "stream.end")).toHaveLength(0);
  });

  it("key-value.search varre no device e devolve só matches", async () => {
    const registry = createRegistry();
    registry.register(createMemoryAdapter());
    const target = { providerId: "memory", instanceId: "default" };
    for (let i = 0; i < 20; i += 1) {
      await handleCommand(
        registry,
        command({
          type: "key-value.set",
          payload: {
            ...target,
            key: `item.${i}`,
            value: { type: "string", value: i === 7 ? "agulha no palheiro" : `valor ${i}` },
          },
        }),
      );
    }
    const result = await handleCommand(
      registry,
      command({ type: "key-value.search", payload: { ...target, query: "agulha" } }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const { entries, complete, scanned } = result.result as {
        entries: Array<{ key: string }>;
        complete: boolean;
        scanned: number;
      };
      expect(entries.map((e) => e.key)).toEqual(["item.7"]);
      expect(complete).toBe(true);
      expect(scanned).toBe(20);
    }
  });

  it("key-value.export flui NDJSON com 100% dos valores via stream", async () => {
    const registry = createRegistry();
    registry.register(createMemoryAdapter());
    const target = { providerId: "memory", instanceId: "default" };
    const big = "b".repeat(STREAM_CHUNK_SIZE + 100); // força mais de um chunk
    await handleCommand(
      registry,
      command({
        type: "key-value.set",
        payload: { ...target, key: "big", value: { type: "string", value: big } },
      }),
    );
    await handleCommand(
      registry,
      command({
        type: "key-value.set",
        payload: { ...target, key: "small", value: { type: "number", value: 42 } },
      }),
    );

    const events: EventMessage[] = [];
    const streams = createStreamHub((event) => events.push(event));
    const result = await handleCommand(
      registry,
      command({ type: "key-value.export", payload: { ...target } }),
      { streams },
    );
    expect(result.ok).toBe(true);

    await vi.waitFor(() => {
      expect(events.some((e) => e.type === "stream.end")).toBe(true);
    });
    const data = events
      .filter((e): e is Extract<EventMessage, { type: "stream.chunk" }> => e.type === "stream.chunk")
      .map((e) => e.payload.data)
      .join("");
    const lines = data.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ key: "big", type: "string", value: big });
    expect(lines[1]).toEqual({ key: "small", type: "number", value: 42 });
    const end = events.find(
      (e): e is Extract<EventMessage, { type: "stream.end" }> => e.type === "stream.end",
    );
    expect(end?.payload.ok).toBe(true);
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

describe("coalescer de eventos (ADR-0001)", () => {
  it("primeira mudança sai imediata; rajada vira UM trailing com coalescedCount", async () => {
    const delivered: Array<{ item: string; count: number }> = [];
    const coalescer = createCoalescer<string>((item, count) => delivered.push({ item, count }), {
      windowMs: 10,
    });

    coalescer.push("k", "v1");
    expect(delivered).toEqual([{ item: "v1", count: 1 }]); // leading, síncrono

    coalescer.push("k", "v2");
    coalescer.push("k", "v3");
    coalescer.push("k", "v4");
    expect(delivered).toHaveLength(1); // ainda na janela

    await vi.waitFor(() => expect(delivered).toHaveLength(2));
    // trailing: estado mais recente + quantas mudanças ele representa
    expect(delivered[1]).toEqual({ item: "v4", count: 3 });
  });

  it("chaves distintas não se fundem", () => {
    const delivered: string[] = [];
    const coalescer = createCoalescer<string>((item) => delivered.push(item), { windowMs: 50 });
    coalescer.push("a", "1");
    coalescer.push("b", "2");
    expect(delivered).toEqual(["1", "2"]);
  });

  it("teto de pendentes força flush imediato (backpressure)", () => {
    const delivered: Array<{ item: string; count: number }> = [];
    const coalescer = createCoalescer<string>((item, count) => delivered.push({ item, count }), {
      windowMs: 60_000,
      maxPending: 3,
    });
    coalescer.push("a", "a1");
    coalescer.push("a", "a2"); // trailing pendente de "a"
    coalescer.push("b", "b1");
    coalescer.push("c", "c1"); // atinge o teto → flush síncrono
    expect(delivered).toEqual([
      { item: "a1", count: 1 },
      { item: "b1", count: 1 },
      { item: "c1", count: 1 },
      { item: "a2", count: 1 },
    ]);
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
