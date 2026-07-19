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
    expect(await receivedByRuntime).toEqual(commandFromStudio);

    // result volta para o studio
    const resultFromRuntime: AnyMessage = {
      kind: "command-result",
      requestId: "r1",
      ok: true,
      result: { providers: [] },
    };
    const receivedByStudio = nextMessage(studio);
    runtime.send(serializeMessage(resultFromRuntime));
    expect(await receivedByStudio).toEqual(resultFromRuntime);

    studio.close();
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
