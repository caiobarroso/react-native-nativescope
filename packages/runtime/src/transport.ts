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
  /** Backoff com half-jitter, teto de 5s; só amortece de fato após STABLE_MS
   * de conexão estável. Reconecta para sempre — a CLI pode subir depois do app. */
  onMessage: (raw: string) => void;
  onOpen: () => void;
  onClose: () => void;
}

export interface Transport {
  send(raw: string): void;
  close(): void;
  isConnected(): boolean;
}

/**
 * Tempo que uma conexão precisa ficar aberta para o backoff considerá-la
 * estável e zerar o `attempt`. Curto o bastante para reconexões legítimas,
 * longo o bastante para o flap (open→morte em ~500ms) não resetar nada.
 */
const STABLE_MS = 3000;

/**
 * Teto do backoff em dois estágios.
 *
 * Reconectar para sempre é intencional (a CLI pode subir depois do app), mas um
 * teto único de 5s custa ~720 tentativas por hora — e o caso comum é justamente
 * o app rodando o dia inteiro sem inspector nenhum do outro lado. Os primeiros
 * ~20s ficam rápidos, que é a janela de uma reconexão legítima (CLI reiniciando,
 * Wi-Fi voltando); depois disso o ritmo cai para meio minuto. A CLI continua
 * sendo detectada quando subir — só não custa bateria enquanto não sobe.
 */
const FAST_CEILING_MS = 5000;
const SLOW_CEILING_MS = 30_000;
const FAST_ATTEMPTS = 10;

export function createTransport(options: TransportOptions): Transport {
  const factory =
    options.createWebSocket ??
    ((url: string) => new (globalThis as { WebSocket: new (url: string) => WebSocketLike }).WebSocket(url));

  let socket: WebSocketLike | null = null;
  let connected = false;
  let closedByUser = false;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Só zera o backoff quando a conexão PROVA estabilidade (ficou aberta
  // STABLE_MS). Um socket que abre e morre logo — o caso do flap — não conta
  // como sucesso, então o attempt segue subindo até o teto.
  let stableTimer: ReturnType<typeof setTimeout> | null = null;

  function connect(): void {
    if (closedByUser) return;
    const ws = factory(options.url);
    socket = ws;

    ws.addEventListener("open", () => {
      if (socket !== ws || closedByUser) {
        ws.close();
        return;
      }
      connected = true;
      // Estabilidade em vez de reset imediato: só zera o backoff se a conexão
      // sobreviver STABLE_MS. Ver a declaração de stableTimer.
      stableTimer = setTimeout(() => {
        stableTimer = null;
        attempt = 0;
      }, STABLE_MS);
      options.onOpen();
    });

    ws.addEventListener("message", (event) => {
      if (socket !== ws) return;
      if (typeof event.data === "string") options.onMessage(event.data);
    });

    const scheduleReconnect = () => {
      if (socket !== ws) return; // socket antigo, ignora
      socket = null;
      // A conexão caiu: cancela o reset pendente. Se caiu antes de STABLE_MS,
      // o attempt NÃO zera — o backoff sobe e amortece o flap.
      if (stableTimer) {
        clearTimeout(stableTimer);
        stableTimer = null;
      }
      // Some WebSocket implementations emit `error` without closing the
      // underlying connection. Close it explicitly before replacing it so a
      // reconnect cycle cannot leave stale native sockets behind.
      try {
        ws.close();
      } catch {
        // Already closed or closing.
      }
      if (connected) {
        connected = false;
        options.onClose();
      }
      if (closedByUser || reconnectTimer) return;
      // Half-jitter: desincroniza dois devices que reconectam em lockstep,
      // evitando reconexão em manada.
      const ceiling = attempt < FAST_ATTEMPTS ? FAST_CEILING_MS : SLOW_CEILING_MS;
      const base = Math.min(500 * 2 ** attempt, ceiling);
      const delay = base / 2 + Math.random() * (base / 2);
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
      if (stableTimer) clearTimeout(stableTimer);
      socket?.close();
    },
    isConnected() {
      return connected;
    },
  };
}
