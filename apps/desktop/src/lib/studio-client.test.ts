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

/** Páginas restantes que o "device" ainda vai entregar numa varredura. */
let scanPagesLeft = 0;

function resultFor(type: string | undefined): unknown {
  switch (type) {
    case "provider.list":
      return { providers: [] };
    case "key-value.get-full":
      return { streamId: nextStreamId, valueType: "string", totalSize: 0 };
    case "database.cell":
      return { streamId: nextStreamId, kind: "text", totalSize: 0 };
    case "key-value.list": {
      // Teto de páginas para que um abort quebrado falhe o teste por asserção,
      // e não por loop infinito.
      scanPagesLeft -= 1;
      return {
        entries: [{ key: `k-${scanPagesLeft}`, valueType: "string", approxSize: 10 }],
        nextAfterKey: scanPagesLeft > 0 ? `k-${scanPagesLeft}` : null,
        total: 100,
      };
    }
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

const { connect, getFullValue, getFullCell, scanAllKeys } = await import("./studio-client.ts");
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

describe("contrato de cancelamento", () => {
  const ROW = { rowid: 1 } as never;

  /** O que um caller escreve quando segue o padrão do fetch. */
  const isAbort = (error: unknown): boolean => (error as Error | null)?.name === "AbortError";

  it("getFullValue: signal já abortado rejeita com AbortError", async () => {
    const controller = new AbortController();
    controller.abort();

    const box = watch(getFullValue("mmkv", "default", "k", { signal: controller.signal }));
    await tick();

    expect(isAbort(box.value)).toBe(true);
  });

  it("getFullValue: abort em voo rejeita com AbortError — o MESMO tipo", async () => {
    const controller = new AbortController();
    const box = watch(getFullValue("mmkv", "default", "k", { signal: controller.signal }));
    await tick();
    expect(box.settled).toBe(false);

    controller.abort();
    await tick();

    // Antes daqui este caminho rejeitava com Error("cancelled"), e só o de cima
    // com AbortError — então `err.name === "AbortError"` dava false num
    // cancelamento legítimo.
    expect(isAbort(box.value)).toBe(true);
  });

  it("getFullCell: os dois caminhos também", async () => {
    const pre = new AbortController();
    pre.abort();
    const boxPre = watch(getFullCell("sqlite", "db", "t", ROW, "col", { signal: pre.signal }));
    await tick();

    const live = new AbortController();
    const boxLive = watch(getFullCell("sqlite", "db", "t", ROW, "col", { signal: live.signal }));
    await tick();
    live.abort();
    await tick();

    expect(isAbort(boxPre.value)).toBe(true);
    expect(isAbort(boxLive.value)).toBe(true);
  });

  it("scanAllKeys: cancelar rejeita em vez de devolver meio relatório", async () => {
    scanPagesLeft = 20;
    const controller = new AbortController();
    let pages = 0;

    const box = watch(
      scanAllKeys(
        "mmkv",
        "default",
        () => {
          pages += 1;
          if (pages === 2) controller.abort();
        },
        { signal: controller.signal },
      ),
    );
    await tick();

    // Antes voltava { complete: false } — a mesma forma de "bateu na trava de
    // 5M chaves". Um relatório de 2 páginas ficava indistinguível do relatório
    // legítimo de uma instância gigante.
    expect(isAbort(box.value)).toBe(true);
    expect(pages).toBe(2);
  });

  it("scanAllKeys: varredura que termina sozinha segue devolvendo complete", async () => {
    scanPagesLeft = 3;
    const box = watch(scanAllKeys("mmkv", "default", () => {}));
    await tick();

    expect(box.value).toEqual({ complete: true, scanned: 3, total: 100 });
  });

  it("falha de verdade continua sendo falha — não vira AbortError", async () => {
    const box = await openStream();

    socket!.deliver({
      ...EVENT,
      deviceId: DEVICE_ID,
      type: "stream.end",
      payload: { streamId: nextStreamId, ok: false, chunkCount: 0, error: "disk read failed" },
    });
    await tick();

    expect(isAbort(box.value)).toBe(false);
    expect((box.value as Error).message).toBe("disk read failed");
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
