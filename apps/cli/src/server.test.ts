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

async function startServer(): Promise<void> {
  port = 20000 + Math.floor(Math.random() * 10000);
  server = await startLocalServer({
    port,
    sessionToken: TOKEN,
    uiDir: null,
    project: { name: "test", flavor: "unknown", providers: [] },
    log: () => {},
  });
}

afterEach(() => {
  server?.close();
  server = null;
});

function connect(): Promise<WebSocket> {
  return new Promise((resolveWs, rejectWs) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
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

function hello(role: "studio" | "runtime", token = TOKEN): AnyMessage {
  return {
    kind: "hello",
    protocolVersion: PROTOCOL_VERSION,
    role,
    sessionToken: token,
    client: { name: "test", platform: "node" },
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
    runtime.send(serializeMessage(hello("runtime")));
    await nextMessage(runtime); // ack

    // studio recebe session.connected quando o runtime chega
    const connected = await nextMessage(studio);
    expect(connected.kind).toBe("event");
    if (connected.kind === "event") expect(connected.type).toBe("session.connected");

    // command flui para o runtime
    const commandFromStudio: AnyMessage = {
      kind: "command",
      protocolVersion: PROTOCOL_VERSION,
      requestId: "r1",
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
    runtime.send(serializeMessage(hello("runtime")));
    await nextMessage(runtime);
    expect((await connectedA).kind).toBe("event");
    expect((await connectedB).kind).toBe("event");

    const commandA: AnyMessage = {
      kind: "command",
      protocolVersion: PROTOCOL_VERSION,
      requestId: "req-1",
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
    await streamResultA;
    await streamResultB;

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
    expect(await chunkA).toMatchObject({ type: "stream.chunk", payload: { streamId: "stream-a" } });
    expect(await chunkB).toMatchObject({ type: "stream.chunk", payload: { streamId: "stream-b" } });

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
