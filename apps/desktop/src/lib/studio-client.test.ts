/**
 * Testes do cliente do Studio — o único ponto da UI que toca o fio.
 *
 * O módulo tem estado global (socket, `pending`, `activeStreams`), então o
 * harness monta um WebSocket falso em `globalThis` ANTES do import e dirige o
 * handshake na mão. Cada teste conversa pelo mesmo socket; os fatos assertados
 * são sempre observáveis de fora (a promise que o chamador recebeu).
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fnv1a32 } from "@rnsi/runtime";

/** Checksum que o device calcularia para esta sequência de chunks. */
function checksumOf(...chunks: string[]): string {
  return chunks.reduce((hash, chunk) => fnv1a32(chunk, hash), 0x811c9dc5).toString(16);
}

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
    case "database.export":
    case "key-value.export":
      return { streamId: nextStreamId };
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

const { connect, getFullValue, getFullCell, scanAllKeys, exportInstance, loadRows } = await import(
  "./studio-client.ts"
);
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
      payload: { streamId: nextStreamId, ok: true, chunkCount: 0, checksum: checksumOf() },
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

describe("resposta fora do protocolo", () => {
  it("degrada como antes, mas deixa rastro no console", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // O fake responde `{}` para database.rows — não casa com o schema.
      const rows = await loadRows("p", "i", "tabela", { limit: 50, offset: 0 });

      // O contrato do chamador não muda: null, a tela mostra "sem linhas".
      expect(rows).toBe(null);
      // Mas agora dá para saber POR QUÊ. Antes o sintoma era idêntico ao de uma
      // tabela legitimamente vazia, e o bug ia parar no lugar errado.
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("database.rows"));
    } finally {
      warn.mockRestore();
    }
  });
});

describe("export com o disco falhando", () => {
  /** Sink que morre no write nº `dieAt`, como um disco que enche no meio. */
  function dyingSink(dieAt: number) {
    const written: string[] = [];
    let failure: Error | null = null;
    return {
      written,
      get failure() {
        return failure;
      },
      write(chunk: string) {
        if (failure) return;
        written.push(chunk);
        if (written.length === dieAt) failure = new Error("No space left on device");
      },
    };
  }

  it("para a transferência no primeiro write que falha, com o erro do disco", async () => {
    const sink = dyingSink(2);
    const box = watch(exportInstance({ kind: "database", providerId: "p", instanceId: "i", table: "t" }, sink));
    await tick();

    const chunk = (data: string): void => {
      socket!.deliver({
        ...EVENT,
        deviceId: DEVICE_ID,
        type: "stream.chunk",
        payload: { streamId: nextStreamId, seq: 0, data },
      });
    };
    chunk("linha 1\n");
    chunk("linha 2\n"); // aqui o disco morre
    chunk("linha 3\n"); // não deve nem chegar ao sink
    await tick();

    // O erro é o do sistema de arquivos, não um "cancelado" genérico: é isso
    // que o usuário precisa ler para saber que faltou espaço.
    expect((box.value as Error).message).toBe("No space left on device");
    expect(sink.written).toEqual(["linha 1\n", "linha 2\n"]);

    // E o device foi avisado para parar de ler — sem isto ele mandaria o GB
    // inteiro para um arquivo que já morreu.
    expect(socket!.sent.some((frame) => frame.type === "stream.cancel")).toBe(true);
  });

  it("export sadio segue até o fim", async () => {
    const sink = dyingSink(Number.POSITIVE_INFINITY);
    const box = watch(exportInstance({ kind: "database", providerId: "p", instanceId: "i", table: "t" }, sink));
    await tick();

    socket!.deliver({
      ...EVENT,
      deviceId: DEVICE_ID,
      type: "stream.chunk",
      payload: { streamId: nextStreamId, seq: 0, data: "linha\n" },
    });
    socket!.deliver({
      ...EVENT,
      deviceId: DEVICE_ID,
      type: "stream.end",
      payload: { streamId: nextStreamId, ok: true, chunkCount: 1, checksum: checksumOf("linha\n") },
    });
    await tick();

    expect(box.settled).toBe(true);
    expect(sink.written).toEqual(["linha\n"]);
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

  /** `accepted` = os chunks que o Studio deveria ter deixado entrar. */
  function end(deviceId: string | undefined, ...accepted: string[]): void {
    socket!.deliver({
      ...EVENT,
      ...(deviceId !== undefined ? { deviceId } : {}),
      type: "stream.end",
      payload: {
        streamId: nextStreamId,
        ok: true,
        chunkCount: accepted.length,
        checksum: checksumOf(...accepted),
      },
    });
  }

  it("não costura no stream um chunk carimbado por OUTRO device", async () => {
    const box = await openStream();

    chunk("VEIO-DO-DEVICE-ERRADO", "device-intruso");
    chunk("legítimo", DEVICE_ID);
    end(DEVICE_ID, "legítimo");
    await tick();

    expect(box.settled).toBe(true);
    expect(box.value).toEqual({ type: "string", value: "legítimo" });
  });

  it("aceita chunk sem carimbo — truncar um valor é pior que a guarda redundante", async () => {
    const box = await openStream();

    chunk("sem-carimbo");
    end(undefined, "sem-carimbo");
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
    end(DEVICE_ID, "chegou depois");
    await tick();
    expect(box.value).toEqual({ type: "string", value: "chegou depois" });
  });

  it("recusa um stream.end sem checksum em vez de entregar dado não verificado", async () => {
    const box = await openStream();

    chunk("conteúdo", DEVICE_ID);
    socket!.deliver({
      ...EVENT,
      deviceId: DEVICE_ID,
      type: "stream.end",
      payload: { streamId: nextStreamId, ok: true, chunkCount: 1 }, // sem checksum
    });
    await tick();

    // O schema aceita checksum ausente, mas o único produtor (createStreamHub)
    // sempre manda. Aceitar calado era pular a verificação justamente no
    // caminho que existe para transportar 100% do valor.
    expect((box.value as Error).message).toBe(
      "stream ended without a checksum — transfer not verifiable",
    );
  });

  it("recusa checksum que não bate", async () => {
    const box = await openStream();

    chunk("conteúdo", DEVICE_ID);
    end(DEVICE_ID, "outra-coisa");
    await tick();

    expect((box.value as Error).message).toBe("checksum mismatch — corrupted transfer");
  });
});
