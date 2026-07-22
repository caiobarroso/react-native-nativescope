import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  PROTOCOL_VERSION,
  parseMessage,
  serializeMessage,
  type AnyMessage,
} from "@rnsi/protocol";
import { startLocalServer } from "./server.ts";

const TOKEN = "test-token";
let server: { close: () => void } | null = null;
let port = 0;

async function startServer(extra?: {
  heartbeatIntervalMs?: number;
  logWindowMs?: number;
  log?: (line: string) => void;
}): Promise<void> {
  port = 20000 + Math.floor(Math.random() * 10000);
  server = await startLocalServer({
    port,
    sessionToken: TOKEN,
    uiDir: null,
    project: { name: "test", flavor: "unknown", providers: [] },
    log: () => {},
    ...extra,
  });
}

afterEach(() => {
  server?.close();
  server = null;
});

function connect(options?: { autoPong?: boolean }): Promise<WebSocket> {
  return new Promise((resolveWs, rejectWs) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, options);
    ws.once("open", () => resolveWs(ws));
    ws.once("error", rejectWs);
  });
}

function nextMessage(ws: WebSocket): Promise<AnyMessage> {
  return new Promise((resolveMsg, rejectMsg) => {
    ws.once("message", (data) => {
      const parsed = parseMessage(data.toString());
      if (parsed.ok) resolveMsg(parsed.message);
      else rejectMsg(new Error(parsed.error));
    });
  });
}

function hello(role: "studio" | "runtime", token = TOKEN, deviceId?: string): AnyMessage {
  return {
    kind: "hello",
    protocolVersion: PROTOCOL_VERSION,
    role,
    sessionToken: token,
    client: { name: "test", platform: "node", ...(deviceId ? { deviceId } : {}) },
  };
}

describe("local server", () => {
  it("aceita hello com token válido", async () => {
    await startServer();
    const ws = await connect();
    ws.send(serializeMessage(hello("studio")));
    const ack = await nextMessage(ws);
    expect(ack.kind).toBe("hello-ack");
    ws.close();
  });

  it("rejeita token inválido", async () => {
    await startServer();
    const ws = await connect();
    ws.send(serializeMessage(hello("studio", "wrong")));
    const rejectMsg = await nextMessage(ws);
    expect(rejectMsg.kind).toBe("hello-reject");
    if (rejectMsg.kind === "hello-reject") {
      expect(rejectMsg.error.code).toBe("unauthorized");
    }
  });

  it("rejeita versão de protocolo incompatível", async () => {
    await startServer();
    const ws = await connect();
    ws.send(
      serializeMessage({ ...hello("runtime"), protocolVersion: 999 } as AnyMessage),
    );
    const rejectMsg = await nextMessage(ws);
    expect(rejectMsg.kind).toBe("hello-reject");
    if (rejectMsg.kind === "hello-reject") {
      expect(rejectMsg.error.code).toBe("version-mismatch");
    }
  });

  it("faz bridge de command studio→runtime e result runtime→studio", async () => {
    await startServer();

    const studio = await connect();
    studio.send(serializeMessage(hello("studio")));
    await nextMessage(studio); // ack

    const runtime = await connect();
    runtime.send(serializeMessage(hello("runtime", TOKEN, "dev-a")));
    await nextMessage(runtime); // ack

    // studio recebe session.connected (com o deviceId) quando o runtime chega
    const connected = await nextMessage(studio);
    expect(connected.kind).toBe("event");
    if (connected.kind === "event" && connected.type === "session.connected") {
      expect(connected.payload.deviceId).toBe("dev-a");
    }

    // command flui para o runtime (roteado pelo deviceId)
    const commandFromStudio: AnyMessage = {
      kind: "command",
      protocolVersion: PROTOCOL_VERSION,
      requestId: "r1",
      deviceId: "dev-a",
      type: "provider.list",
      payload: {},
    };
    const receivedByRuntime = nextMessage(runtime);
    studio.send(serializeMessage(commandFromStudio));
    const forwardedCommand = await receivedByRuntime;
    expect(forwardedCommand).toMatchObject({
      ...commandFromStudio,
      requestId: expect.stringMatching(/^bridge-/),
    });
    if (forwardedCommand.kind !== "command") throw new Error("expected command");

    // result volta para o studio
    const resultFromRuntime: AnyMessage = {
      kind: "command-result",
      requestId: forwardedCommand.requestId,
      ok: true,
      result: { providers: [] },
    };
    const receivedByStudio = nextMessage(studio);
    runtime.send(serializeMessage(resultFromRuntime));
    expect(await receivedByStudio).toEqual({ ...resultFromRuntime, requestId: "r1" });

    studio.close();
    runtime.close();
  });

  it("mantém múltiplos studios conectados e roteia respostas para a aba correta", async () => {
    await startServer();

    const studioA = await connect();
    studioA.send(serializeMessage(hello("studio")));
    await nextMessage(studioA);

    const studioB = await connect();
    studioB.send(serializeMessage(hello("studio")));
    await nextMessage(studioB);

    const connectedA = nextMessage(studioA);
    const connectedB = nextMessage(studioB);
    const runtime = await connect();
    runtime.send(serializeMessage(hello("runtime", TOKEN, "dev-a")));
    await nextMessage(runtime);
    expect((await connectedA).kind).toBe("event");
    expect((await connectedB).kind).toBe("event");

    const commandA: AnyMessage = {
      kind: "command",
      protocolVersion: PROTOCOL_VERSION,
      requestId: "req-1",
      deviceId: "dev-a",
      type: "provider.list",
      payload: {},
    };
    const commandB: AnyMessage = { ...commandA, requestId: "req-1" };

    const runtimeCommandA = nextMessage(runtime);
    studioA.send(serializeMessage(commandA));
    const forwardedA = await runtimeCommandA;
    expect(forwardedA.kind).toBe("command");

    const runtimeCommandB = nextMessage(runtime);
    studioB.send(serializeMessage(commandB));
    const forwardedB = await runtimeCommandB;
    expect(forwardedB.kind).toBe("command");

    if (forwardedA.kind !== "command" || forwardedB.kind !== "command") {
      throw new Error("expected commands");
    }
    expect(forwardedA.requestId).not.toBe(forwardedB.requestId);

    const resultA = nextMessage(studioA);
    const resultB = nextMessage(studioB);
    runtime.send(
      serializeMessage({
        kind: "command-result",
        requestId: forwardedA.requestId,
        ok: true,
        result: { providers: [{ tab: "A" }] },
      }),
    );
    runtime.send(
      serializeMessage({
        kind: "command-result",
        requestId: forwardedB.requestId,
        ok: true,
        result: { providers: [{ tab: "B" }] },
      }),
    );

    expect(await resultA).toEqual({
      kind: "command-result",
      requestId: "req-1",
      ok: true,
      result: { providers: [{ tab: "A" }] },
    });
    expect(await resultB).toEqual({
      kind: "command-result",
      requestId: "req-1",
      ok: true,
      result: { providers: [{ tab: "B" }] },
    });

    const streamCommandA: AnyMessage = {
      kind: "command",
      protocolVersion: PROTOCOL_VERSION,
      requestId: "stream-request",
      deviceId: "dev-a",
      type: "key-value.export",
      payload: { providerId: "mmkv", instanceId: "cache" },
    };
    const streamCommandB: AnyMessage = { ...streamCommandA };
    const forwardedStreamAPromise = nextMessage(runtime);
    studioA.send(serializeMessage(streamCommandA));
    const forwardedStreamA = await forwardedStreamAPromise;
    const forwardedStreamBPromise = nextMessage(runtime);
    studioB.send(serializeMessage(streamCommandB));
    const forwardedStreamB = await forwardedStreamBPromise;
    if (forwardedStreamA.kind !== "command" || forwardedStreamB.kind !== "command") {
      throw new Error("expected stream commands");
    }

    const streamResultA = nextMessage(studioA);
    runtime.send(
      serializeMessage({
        kind: "command-result",
        requestId: forwardedStreamA.requestId,
        ok: true,
        result: { streamId: "stream-a" },
      }),
    );
    const streamResultB = nextMessage(studioB);
    runtime.send(
      serializeMessage({
        kind: "command-result",
        requestId: forwardedStreamB.requestId,
        ok: true,
        result: { streamId: "stream-b" },
      }),
    );
    // O id que chega no studio é GLOBAL (reescrito pelo bridge), não o local.
    const resA = await streamResultA;
    const resB = await streamResultB;
    if (resA.kind !== "command-result" || !resA.ok) throw new Error("expected result A");
    if (resB.kind !== "command-result" || !resB.ok) throw new Error("expected result B");
    const globalA = (resA.result as { streamId: string }).streamId;
    const globalB = (resB.result as { streamId: string }).streamId;
    expect(globalA).not.toBe("stream-a");
    expect(globalA).not.toBe(globalB);

    const chunkA = nextMessage(studioA);
    const chunkB = nextMessage(studioB);
    runtime.send(
      serializeMessage({
        kind: "event",
        protocolVersion: PROTOCOL_VERSION,
        timestamp: Date.now(),
        type: "stream.chunk",
        payload: { streamId: "stream-a", seq: 0, data: "A" },
      }),
    );
    runtime.send(
      serializeMessage({
        kind: "event",
        protocolVersion: PROTOCOL_VERSION,
        timestamp: Date.now(),
        type: "stream.chunk",
        payload: { streamId: "stream-b", seq: 0, data: "B" },
      }),
    );
    expect(await chunkA).toMatchObject({ type: "stream.chunk", payload: { streamId: globalA, data: "A" } });
    expect(await chunkB).toMatchObject({ type: "stream.chunk", payload: { streamId: globalB, data: "B" } });

    studioA.close();
    studioB.close();
    runtime.close();
  });

  it("avisa o studio quando o runtime desconecta", async () => {
    await startServer();

    const studio = await connect();
    studio.send(serializeMessage(hello("studio")));
    await nextMessage(studio);

    const runtime = await connect();
    runtime.send(serializeMessage(hello("runtime")));
    await nextMessage(runtime);
    await nextMessage(studio); // session.connected

    const disconnected = nextMessage(studio);
    runtime.close();
    const event = await disconnected;
    expect(event.kind).toBe("event");
    if (event.kind === "event") expect(event.type).toBe("session.disconnected");

    studio.close();
  });
});

describe("heartbeat", () => {
  it("derruba runtime que não responde ao ping (conexão meia-aberta)", async () => {
    await startServer({ heartbeatIntervalMs: 50 });

    // autoPong:false simula device morto/dormindo: recebe o ping e não responde.
    const runtime = await connect({ autoPong: false });
    runtime.send(serializeMessage(hello("runtime")));
    await nextMessage(runtime); // hello-ack

    // Sem pong nem tráfego: em poucos ticks o servidor faz terminate().
    await new Promise<void>((resolve) => runtime.once("close", () => resolve()));
    expect(runtime.readyState).toBe(WebSocket.CLOSED);
  });

  it("mantém runtime que responde ao ping (auto-pong padrão)", async () => {
    await startServer({ heartbeatIntervalMs: 50 });

    const runtime = await connect(); // auto-pong ligado (padrão do ws)
    runtime.send(serializeMessage(hello("runtime")));
    await nextMessage(runtime); // hello-ack

    // Vários ticks sem tráfego, só o auto-pong nativo: deve seguir aberto.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(runtime.readyState).toBe(WebSocket.OPEN);
    runtime.close();
  });
});

describe("multi-device", () => {
  it("dois devices coexistem e comandos roteiam por deviceId", async () => {
    await startServer();

    const studio = await connect();
    studio.send(serializeMessage(hello("studio")));
    await nextMessage(studio); // ack

    const runtimeA = await connect();
    runtimeA.send(serializeMessage(hello("runtime", TOKEN, "dev-a")));
    await nextMessage(runtimeA); // ack
    const connA = await nextMessage(studio);

    const runtimeB = await connect();
    runtimeB.send(serializeMessage(hello("runtime", TOKEN, "dev-b")));
    await nextMessage(runtimeB); // ack
    const connB = await nextMessage(studio);

    // Dois session.connected distintos — nenhum expulsou o outro.
    expect(connA.kind).toBe("event");
    if (connA.kind === "event" && connA.type === "session.connected") {
      expect(connA.payload.deviceId).toBe("dev-a");
    }
    expect(connB.kind).toBe("event");
    if (connB.kind === "event" && connB.type === "session.connected") {
      expect(connB.payload.deviceId).toBe("dev-b");
    }

    // Comando p/ dev-b chega no runtimeB (roteado por deviceId), e o resultado volta.
    const onB = nextMessage(runtimeB);
    studio.send(
      serializeMessage({
        kind: "command",
        protocolVersion: PROTOCOL_VERSION,
        requestId: "rb",
        deviceId: "dev-b",
        type: "provider.list",
        payload: {},
      }),
    );
    const fwdB = await onB;
    expect(fwdB.kind).toBe("command");
    if (fwdB.kind !== "command") throw new Error("expected command");
    expect(fwdB.deviceId).toBe("dev-b");

    const resB = nextMessage(studio);
    runtimeB.send(
      serializeMessage({
        kind: "command-result",
        requestId: fwdB.requestId,
        ok: true,
        result: { providers: [] },
      }),
    );
    expect(await resB).toEqual({
      kind: "command-result",
      requestId: "rb",
      ok: true,
      result: { providers: [] },
    });

    studio.close();
    runtimeA.close();
    runtimeB.close();
  });

  it("self-replace: mesmo deviceId reconecta e o socket antigo cai", async () => {
    await startServer();

    const studio = await connect();
    studio.send(serializeMessage(hello("studio")));
    await nextMessage(studio);

    const first = await connect();
    first.send(serializeMessage(hello("runtime", TOKEN, "dev-x")));
    await nextMessage(first); // ack
    await nextMessage(studio); // session.connected

    // Segundo runtime com o MESMO deviceId → o servidor fecha só o socket velho dele.
    const firstClosed = new Promise<void>((resolve) => first.once("close", () => resolve()));
    const second = await connect();
    second.send(serializeMessage(hello("runtime", TOKEN, "dev-x")));
    await nextMessage(second); // ack
    await firstClosed;
    expect(first.readyState).toBe(WebSocket.CLOSED);

    studio.close();
    second.close();
  });

  it("disconnect é por-device: um cai, o outro segue roteando", async () => {
    await startServer();

    const studio = await connect();
    studio.send(serializeMessage(hello("studio")));
    await nextMessage(studio);

    const runtimeA = await connect();
    runtimeA.send(serializeMessage(hello("runtime", TOKEN, "dev-a")));
    await nextMessage(runtimeA);
    await nextMessage(studio); // connected A

    const runtimeB = await connect();
    runtimeB.send(serializeMessage(hello("runtime", TOKEN, "dev-b")));
    await nextMessage(runtimeB);
    await nextMessage(studio); // connected B

    // A cai → o studio recebe disconnected SÓ de dev-a.
    const disc = nextMessage(studio);
    runtimeA.close();
    const discEvent = await disc;
    expect(discEvent.kind).toBe("event");
    if (discEvent.kind === "event" && discEvent.type === "session.disconnected") {
      expect(discEvent.payload.deviceId).toBe("dev-a");
    }

    // B segue roteando normalmente.
    const onB = nextMessage(runtimeB);
    studio.send(
      serializeMessage({
        kind: "command",
        protocolVersion: PROTOCOL_VERSION,
        requestId: "rb2",
        deviceId: "dev-b",
        type: "provider.list",
        payload: {},
      }),
    );
    const fwdB = await onB;
    expect(fwdB.kind).toBe("command");

    studio.close();
    runtimeB.close();
  });
});

describe("ruído de rejeição", () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** Um handshake que será recusado; resolve quando o reject chega. */
  async function badHandshake(options?: { origin?: string }): Promise<void> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, options);
    await new Promise<void>((res, rej) => {
      ws.once("open", () => res());
      ws.once("error", rej);
    });
    const rejected = nextMessage(ws);
    ws.send(serializeMessage(hello("studio", "token-de-outra-execucao")));
    await rejected;
    ws.close();
  }

  it("identifica quem foi recusado e sugere a ação", async () => {
    const lines: string[] = [];
    await startServer({ log: (line) => lines.push(line) });

    await badHandshake({ origin: `http://127.0.0.1:${port}` });

    expect(lines).toHaveLength(1);
    // Sem isto, aba antiga do Studio era indistinguível de device com bundle velho.
    expect(lines[0]).toContain("unauthorized");
    expect(lines[0]).toContain("studio test (node)");
    expect(lines[0]).toContain("127.0.0.1");
    expect(lines[0]).toContain("origin http://127.0.0.1:");
    expect(lines[0]).toContain("close it and open the Studio URL");
    // O token recebido NUNCA aparece no log.
    expect(lines[0]).not.toContain("token-de-outra-execucao");
  });

  it("um cliente teimoso rende uma linha por janela, não uma por tentativa", async () => {
    const lines: string[] = [];
    await startServer({ log: (line) => lines.push(line), logWindowMs: 60 });

    for (let i = 0; i < 6; i += 1) await badHandshake();
    expect(lines).toHaveLength(1); // 6 tentativas, 1 linha

    await sleep(120);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("+5 more in the last");
  });

  it("origem fora da allowlist também é agregada", async () => {
    const lines: string[] = [];
    await startServer({ log: (line) => lines.push(line), logWindowMs: 60 });

    for (let i = 0; i < 3; i += 1) {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin: "http://evil.example" });
      await new Promise<void>((res) => {
        ws.once("error", () => res());
        ws.once("close", () => res());
      });
    }

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("origin http://evil.example not in allowlist");
  });
});

describe("estado de providers no bridge", () => {
  function providerEvent(providerId: string, label: string): AnyMessage {
    return {
      kind: "event",
      protocolVersion: PROTOCOL_VERSION,
      timestamp: Date.now(),
      type: "provider.registered",
      payload: {
        provider: {
          providerId,
          label,
          capabilities: ["key-value.read"],
          instances: [{ instanceId: "default", label: "default" }],
        },
      },
    } as AnyMessage;
  }

  /** Coletor persistente: hello-ack e session.connected chegam no mesmo chunk,
   * então um listener por mensagem perderia o segundo. */
  function collect(ws: WebSocket): AnyMessage[] {
    const received: AnyMessage[] = [];
    ws.on("message", (data) => {
      const parsed = parseMessage(data.toString());
      if (parsed.ok) received.push(parsed.message);
    });
    return received;
  }

  const settle = () => new Promise((r) => setTimeout(r, 80));

  async function connectRuntime(deviceId: string, providers: string[]): Promise<WebSocket> {
    const ws = await connect();
    collect(ws);
    ws.send(serializeMessage(hello("runtime", TOKEN, deviceId)));
    await settle();
    for (const providerId of providers) {
      ws.send(serializeMessage(providerEvent(providerId, providerId.toUpperCase())));
    }
    await settle();
    return ws;
  }

  function connectedProviders(received: AnyMessage[]): string[] {
    const event = received.find(
      (m) => m.kind === "event" && m.type === "session.connected",
    );
    if (event?.kind !== "event" || event.type !== "session.connected") return [];
    return event.payload.providers.map((p) => p.providerId).sort();
  }

  it("entrega a lista completa a um Studio que abre DEPOIS do app", async () => {
    await startServer();
    const runtime = await connectRuntime("dev-1", ["mmkv", "sqlite"]);

    // Só agora o Studio abre. Sem o cache, ele receberia providers: [] e
    // dependeria de perguntar na hora certa para não mostrar meia tela.
    const studio = await connect();
    const received = collect(studio);
    studio.send(serializeMessage(hello("studio")));
    await settle();

    expect(connectedProviders(received)).toEqual(["mmkv", "sqlite"]);

    runtime.close();
    studio.close();
  });

  it("um contexto novo do app zera o estado do anterior", async () => {
    await startServer();

    const first = await connectRuntime("dev-1", ["mmkv"]);
    first.close();
    await settle();

    // Reload do app: mesmo device, contexto novo que não usa mais MMKV.
    const second = await connectRuntime("dev-1", ["sqlite"]);

    const studio = await connect();
    const received = collect(studio);
    studio.send(serializeMessage(hello("studio")));
    await settle();

    expect(connectedProviders(received)).toEqual(["sqlite"]);

    second.close();
    studio.close();
  });
});
