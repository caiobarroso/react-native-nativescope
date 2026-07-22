import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTransport, type WebSocketLike } from "./transport.ts";

/** Socket falso dirigível por timers: cada `emit` simula um evento do WS. */
class FakeSocket implements WebSocketLike {
  private listeners = new Map<string, Set<(event?: { data: unknown }) => void>>();
  send(): void {}
  close(): void {
    this.emit("close");
  }
  addEventListener(
    type: "open" | "close" | "error" | "message",
    listener: (() => void) | ((event: { data: unknown }) => void),
  ): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener as (event?: { data: unknown }) => void);
    this.listeners.set(type, set);
  }
  emit(type: string, event?: { data: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe("transport backoff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Jitter determinístico: com random()=0, delay = base/2.
    vi.spyOn(Math, "random").mockReturnValue(0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function setup() {
    const sockets: FakeSocket[] = [];
    createTransport({
      url: "ws://test",
      createWebSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      onMessage: () => {},
      onOpen: () => {},
      onClose: () => {},
    });
    return sockets;
  }

  it("não reseta o backoff quando a conexão morre antes de STABLE_MS (mata o flap)", () => {
    const sockets = setup();
    expect(sockets).toHaveLength(1); // conexão inicial

    // Ciclo 1: abre e morre rápido (<3s). attempt=0 → base=500 → delay=250.
    sockets[0]!.emit("open");
    vi.advanceTimersByTime(500);
    sockets[0]!.emit("close");
    vi.advanceTimersByTime(249);
    expect(sockets).toHaveLength(1); // ainda não reconectou
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2); // reconectou em ~250ms

    // Ciclo 2: rápido de novo. Se o gate funciona, attempt subiu → base=1000 →
    // delay=500. (Sem o gate, o open teria zerado attempt e o delay seria 250.)
    sockets[1]!.emit("open");
    vi.advanceTimersByTime(500);
    sockets[1]!.emit("close");
    vi.advanceTimersByTime(499);
    expect(sockets).toHaveLength(2); // 250ms já passou e NÃO reconectou → delay cresceu
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
  });

  it("reseta o backoff depois da conexão provar estabilidade (>= STABLE_MS)", () => {
    const sockets = setup();

    // Fica estável por STABLE_MS → attempt zera.
    sockets[0]!.emit("open");
    vi.advanceTimersByTime(3000);
    sockets[0]!.emit("close");

    // attempt de volta a 0 → base=500 → delay=250.
    vi.advanceTimersByTime(249);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
  });
});

describe("teto do backoff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0); // delay = base/2
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** Falha a conexão N vezes e devolve o intervalo esperado até a próxima. */
  function failTimes(sockets: FakeSocket[], times: number): void {
    for (let i = 0; i < times; i += 1) {
      const socket = sockets[sockets.length - 1]!;
      socket.emit("error");
      // Avança o suficiente para qualquer teto: 30s cobre os dois estágios.
      vi.advanceTimersByTime(30_000);
    }
  }

  it("segura 5s no começo e cai para 30s depois de insistir sem sucesso", () => {
    const sockets: FakeSocket[] = [];
    createTransport({
      url: "ws://test",
      createWebSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      onMessage: () => {},
      onOpen: () => {},
      onClose: () => {},
    });

    // Estágio rápido: na 5a falha o teto de 5s já está valendo → delay 2500ms.
    failTimes(sockets, 5);
    const beforeFast = sockets.length;
    sockets[sockets.length - 1]!.emit("error");
    vi.advanceTimersByTime(2499);
    expect(sockets).toHaveLength(beforeFast); // ainda não
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(beforeFast + 1); // reconectou em 2500ms

    // Estágio lento: passadas FAST_ATTEMPTS tentativas, o teto vira 30s →
    // delay 15000ms. É o que evita 720 tentativas/hora no device do usuário.
    failTimes(sockets, 6);
    const beforeSlow = sockets.length;
    sockets[sockets.length - 1]!.emit("error");
    vi.advanceTimersByTime(14_999);
    expect(sockets).toHaveLength(beforeSlow);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(beforeSlow + 1);
  });

  it("uma conexão estável devolve o ritmo rápido (a CLI subiu de novo)", () => {
    const sockets: FakeSocket[] = [];
    createTransport({
      url: "ws://test",
      createWebSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      onMessage: () => {},
      onOpen: () => {},
      onClose: () => {},
    });

    failTimes(sockets, 15); // já no estágio lento
    sockets[sockets.length - 1]!.emit("open");
    vi.advanceTimersByTime(STABLE_MS_FOR_TEST); // prova estabilidade → attempt zera
    sockets[sockets.length - 1]!.emit("close");

    const before = sockets.length;
    vi.advanceTimersByTime(249);
    expect(sockets).toHaveLength(before);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(before + 1); // 250ms: de volta ao início
  });
});

/** Espelha STABLE_MS do transporte (não exportado de propósito). */
const STABLE_MS_FOR_TEST = 3000;
