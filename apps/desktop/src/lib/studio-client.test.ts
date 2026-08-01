/**
 * Testes do cliente do Studio — o único ponto da UI que toca o fio.
 *
 * O módulo tem estado global (socket, `pending`, `activeStreams`), então o
 * harness monta um WebSocket falso em `globalThis` ANTES do import e dirige o
 * handshake na mão. Cada teste conversa pelo mesmo socket; os fatos assertados
 * são sempre observáveis de fora (a promise que o chamador recebeu).
 */
import { beforeAll, describe, expect, it } from "vitest";

type Listener = ((event: { data: unknown }) => void) | (() => void);

let socket: FakeSocket | null = null;

/** streamId devolvido pelo próximo get-full/cell — o serviço emite ids globais. */
let nextStreamId = "gstream-1";

class FakeSocket {
  listeners = new Map<string, Listener[]>();
  /** Frames que o Studio mandou, já desserializados. */
  sent: Array<{ kind: string; type?: string; payload?: unknown }> = [];

  constructor(_url: string) {
    socket = this;
  }

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  emit(type: string, payload?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      (listener as (event?: unknown) => void)(payload);
    }
  }

  /** Injeta uma mensagem serviço→Studio. */
  deliver(message: unknown): void {
    this.emit("message", { data: JSON.stringify(message) });
  }

  send(raw: string): void {
    const frame = JSON.parse(raw) as { kind: string; requestId?: string; type?: string };
    this.sent.push(frame);
    if (frame.kind !== "command" || frame.requestId === undefined) return;
    // Responder TODO comando é o que mantém o teste honesto: um pending
    // pendurado viraria unhandled rejection quando o timeout de 4s estourasse.
    queueMicrotask(() => {
      this.deliver({
        kind: "command-result",
        requestId: frame.requestId,
        ok: true,
        result: resultFor(frame.type),
      });
    });
  }

  close(): void {}
}

function resultFor(type: string | undefined): unknown {
  switch (type) {
    case "provider.list":
      return { providers: [] };
    case "key-value.get-full":
      return { streamId: nextStreamId, valueType: "string", totalSize: 0 };
    case "database.cell":
      return { streamId: nextStreamId, kind: "text", totalSize: 0 };
    default:
      return {};
  }
}

const g = globalThis as Record<string, unknown>;
g.WebSocket = FakeSocket;
g.window = {
  location: { search: "?token=test", port: "1420", host: "127.0.0.1:4783" },
  localStorage: { getItem: () => null, setItem: () => {} },
};

const { connect, getFullValue, getFullCell } = await import("./studio-client.ts");
const { useStudio } = await import("./store.ts");

const EVENT = { kind: "event", protocolVersion: 1, timestamp: 0 } as const;
const DEVICE_ID = "device-a";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

/** Observa uma promise sem consumi-la: queremos saber SE e COM O QUÊ ela settla. */
function watch(promise: Promise<unknown>): { settled: boolean; value: unknown } {
  const box = { settled: false, value: undefined as unknown };
  promise.then(
    (value) => Object.assign(box, { settled: true, value }),
    (error) => Object.assign(box, { settled: true, value: error }),
  );
  return box;
}

function connectDevice(deviceId: string): void {
  socket!.deliver({
    ...EVENT,
    type: "session.connected",
    payload: {
      sessionId: `s-${deviceId}`,
      deviceId,
      client: { name: "playground", platform: "ios" },
      providers: [],
    },
  });
}

/**
 * Abre um stream e devolve o observador do chamador, já com o stream
 * registrado. Embrulhado em objeto de propósito: devolver a promise crua de
 * uma função `async` faria o `await` da chamadora esperar o stream inteiro.
 */
async function openStream(key = "grande"): Promise<{ settled: boolean; value: unknown }> {
  const box = watch(getFullValue("mmkv", "default", key));
  await tick();
  return box;
}

beforeAll(async () => {
  connect();
  socket!.emit("open");
  socket!.deliver({ kind: "hello-ack", protocolVersion: 1, service: { name: "test" } });
  connectDevice(DEVICE_ID);
  await tick();
});

describe("morte do device em foco", () => {
  it("derruba o stream em voo em vez de deixá-lo expirar em 15s", async () => {
    const box = await openStream();
    expect(box.settled).toBe(false); // stream pendurado, esperando chunks

    socket!.deliver({
      ...EVENT,
      type: "session.disconnected",
      payload: { sessionId: `s-${DEVICE_ID}`, deviceId: DEVICE_ID },
    });
    await tick();

    // Sem o failInFlight, isto só settlava 15s depois, com "the app stopped
    // responding" — mensagem falsa: o app não travou, ele reiniciou.
    expect(box.settled).toBe(true);
    expect((box.value as Error).message).toBe("the app disconnected");

    connectDevice(DEVICE_ID);
    await tick();
  });

  it("não derruba nada quando quem cai é OUTRO device", async () => {
    const box = await openStream();

    socket!.deliver({
      ...EVENT,
      type: "session.disconnected",
      payload: { sessionId: "s-outro", deviceId: "device-b" },
    });
    await tick();

    expect(box.settled).toBe(false);

    // Encerra o stream para não vazar entre testes.
    socket!.deliver({
      ...EVENT,
      type: "stream.end",
      payload: { streamId: nextStreamId, ok: true, chunkCount: 0 },
    });
    await tick();
    expect(box.settled).toBe(true);
  });

  it("vale para comandos em voo também, não só para streams", async () => {
    // getFullCell resolve o comando e depois pendura no stream; o que
    // interessa aqui é que o caminho inteiro morre junto com o device.
    const promise = getFullCell("sqlite", "db", "t", { rowid: 1 } as never, "col");
    await tick();
    const box = watch(promise);

    socket!.deliver({
      ...EVENT,
      type: "session.disconnected",
      payload: { sessionId: `s-${DEVICE_ID}`, deviceId: DEVICE_ID },
    });
    await tick();

    expect(box.settled).toBe(true);
    expect((box.value as Error).message).toBe("the app disconnected");

    connectDevice(DEVICE_ID);
    await tick();
    expect(useStudio.getState().selectedDeviceId).toBe(DEVICE_ID);
  });
});

describe("origem do chunk", () => {
  function chunk(data: string, deviceId?: string): void {
    socket!.deliver({
      ...EVENT,
      ...(deviceId !== undefined ? { deviceId } : {}),
      type: "stream.chunk",
      payload: { streamId: nextStreamId, seq: 0, data },
    });
  }

  function end(deviceId?: string): void {
    socket!.deliver({
      ...EVENT,
      ...(deviceId !== undefined ? { deviceId } : {}),
      type: "stream.end",
      payload: { streamId: nextStreamId, ok: true, chunkCount: 1 },
    });
  }

  it("não costura no stream um chunk carimbado por OUTRO device", async () => {
    const box = await openStream();

    chunk("VEIO-DO-DEVICE-ERRADO", "device-intruso");
    chunk("legítimo", DEVICE_ID);
    end(DEVICE_ID);
    await tick();

    expect(box.settled).toBe(true);
    expect(box.value).toEqual({ type: "string", value: "legítimo" });
  });

  it("aceita chunk sem carimbo — truncar um valor é pior que a guarda redundante", async () => {
    const box = await openStream();

    chunk("sem-carimbo");
    end();
    await tick();

    expect(box.settled).toBe(true);
    expect(box.value).toEqual({ type: "string", value: "sem-carimbo" });
  });

  it("também ignora o stream.end de outro device — o stream segue vivo", async () => {
    const box = await openStream();

    end("device-intruso");
    await tick();
    expect(box.settled).toBe(false);

    chunk("chegou depois", DEVICE_ID);
    end(DEVICE_ID);
    await tick();
    expect(box.value).toEqual({ type: "string", value: "chegou depois" });
  });
});
