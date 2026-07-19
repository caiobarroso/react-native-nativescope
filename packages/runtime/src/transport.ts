/**
 * Cliente WebSocket com reconexão. Independente de plataforma: em React
 * Native usa o WebSocket global; em Node (fake-runtime da CLI) recebe uma
 * factory. Nenhum import de RN aqui.
 */

export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "close" | "error", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

export interface TransportOptions {
  url: string;
  createWebSocket?: (url: string) => WebSocketLike;
  /** Backoff: 500ms, 1s, 2s, 4s, teto de 5s. Reconecta para sempre — a CLI pode subir depois do app. */
  onMessage: (raw: string) => void;
  onOpen: () => void;
  onClose: () => void;
}

export interface Transport {
  send(raw: string): void;
  close(): void;
  isConnected(): boolean;
}

export function createTransport(options: TransportOptions): Transport {
  const factory =
    options.createWebSocket ??
    ((url: string) => new (globalThis as { WebSocket: new (url: string) => WebSocketLike }).WebSocket(url));

  let socket: WebSocketLike | null = null;
  let connected = false;
  let closedByUser = false;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect(): void {
    if (closedByUser) return;
    const ws = factory(options.url);
    socket = ws;

    ws.addEventListener("open", () => {
      connected = true;
      attempt = 0;
      options.onOpen();
    });

    ws.addEventListener("message", (event) => {
      if (typeof event.data === "string") options.onMessage(event.data);
    });

    const scheduleReconnect = () => {
      if (socket !== ws) return; // socket antigo, ignora
      socket = null;
      if (connected) {
        connected = false;
        options.onClose();
      }
      if (closedByUser || reconnectTimer) return;
      const delay = Math.min(500 * 2 ** attempt, 5000);
      attempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    ws.addEventListener("close", scheduleReconnect);
    ws.addEventListener("error", scheduleReconnect);
  }

  connect();

  return {
    send(raw) {
      if (connected && socket) socket.send(raw);
    },
    close() {
      closedByUser = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    },
    isConnected() {
      return connected;
    },
  };
}
