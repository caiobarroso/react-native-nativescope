import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import {
  PROTOCOL_VERSION,
  WIRE_MESSAGE_BUDGET,
  exceedsWireBudget,
  parseMessage,
  serializeMessage,
  protocolError,
  type AnyMessage,
  type HelloMessage,
} from "@rnsi/protocol";
import type { DetectedProject } from "./detect.ts";

export interface LocalServerOptions {
  port: number;
  sessionToken: string;
  uiDir: string | null;
  project: DetectedProject;
  log: (line: string) => void;
  /**
   * Interface de bind. Default `127.0.0.1` (loopback only). `0.0.0.0` habilita
   * o modo LAN (opt-in via --lan) para conectar iPhone físico na mesma rede —
   * o token de sessão passa a ser a barreira, já que o app não manda Origin.
   */
  host?: string;
}

interface Session {
  socket: WebSocket;
  sessionId: string;
  client: { name: string; platform: string };
}

const COMMAND_ROUTE_TTL_MS = 10_000;
const STREAM_ROUTE_TTL_MS = 10 * 60_000;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

/**
 * Serviço local: HTTP (UI estática) + WebSocket (bridge) na mesma porta,
 * bind exclusivo em 127.0.0.1.
 *
 * Segurança mínima da Fase 0, inegociável:
 * - token de sessão exigido no handshake de todo cliente;
 * - Origin validado no upgrade — browser malicioso em outra origem não
 *   conecta nem com token vazado (WS de browser não passa por CORS);
 * - loopback por padrão; 0.0.0.0 só sob opt-in explícito (--lan), onde o
 *   token vira a barreira (o Studio browser continua preso ao loopback pelo
 *   Origin; só o runtime RN, que não manda Origin, entra pela LAN).
 */
export function startLocalServer(options: LocalServerOptions) {
  const { port, sessionToken, uiDir, project, log } = options;
  const host = options.host ?? "127.0.0.1";

  // Origens aceitas no upgrade WS. Loopback sempre; em LAN (host != loopback) o
  // runtime RN manda Origin = a URL do ws (http://<ip-desta-máquina>:porta), que
  // batemos contra os IPs reais da máquina. Browser não forja Origin, então
  // liberar os próprios IPs não abre porta para página maliciosa.
  const allowedOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  if (host !== "127.0.0.1") {
    for (const addrs of Object.values(networkInterfaces())) {
      for (const addr of addrs ?? []) {
        if (addr.family === "IPv4" && !addr.internal) allowedOrigins.add(`http://${addr.address}:${port}`);
      }
    }
  }

  const studios = new Set<Session>();
  let runtime: Session | null = null;
  let nextSessionId = 1;
  let nextBridgeRequestId = 1;
  const commandRoutes = new Map<
    string,
    { studio: Session; studioRequestId: string; timer: ReturnType<typeof setTimeout> }
  >();
  const streamRoutes = new Map<
    string,
    { studio: Session; timer: ReturnType<typeof setTimeout> }
  >();

  function deleteCommandRoute(requestId: string): void {
    const route = commandRoutes.get(requestId);
    if (!route) return;
    clearTimeout(route.timer);
    commandRoutes.delete(requestId);
  }

  function clearCommandRoutes(): void {
    for (const requestId of commandRoutes.keys()) deleteCommandRoute(requestId);
  }

  function deleteStreamRoute(streamId: string): void {
    const route = streamRoutes.get(streamId);
    if (!route) return;
    clearTimeout(route.timer);
    streamRoutes.delete(streamId);
  }

  function clearStreamRoutes(): void {
    for (const streamId of streamRoutes.keys()) deleteStreamRoute(streamId);
  }

  function sendTo(session: Session | null, message: AnyMessage): void {
    if (session && session.socket.readyState === WebSocket.OPEN) {
      const raw = serializeMessage(message);
      // Defesa em profundidade do orçamento de fio (§1): o device já guarda na
      // origem, mas o hub também relaya e origina frames. Diagnóstico, nunca
      // fatal — um frame gordo é logado, não derruba a bridge.
      if (exceedsWireBudget(raw)) {
        log(
          `Frame exceeds the wire budget (${WIRE_MESSAGE_BUDGET} bytes): ` +
            `${message.kind} ~${raw.length} chars; use stream.* instead`,
        );
      }
      session.socket.send(raw);
    }
  }

  function sendToStudios(message: AnyMessage): void {
    for (const studio of studios) sendTo(studio, message);
  }

  // -------------------------------------------------------------------- HTTP

  async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!uiDir) {
      res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
      res.end("Studio UI is not built. Run: pnpm --filter @rnsi/desktop build");
      return;
    }
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    // normalize + verificação de prefixo: nada de path traversal
    const root = resolve(uiDir);
    const requested = url.pathname === "/" ? "index.html" : `.${url.pathname}`;
    let filePath = resolve(root, requested);
    const outsideRoot = relative(root, filePath);
    if (outsideRoot.startsWith("..") || isAbsolute(outsideRoot)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const info = await stat(filePath);
      if (info.isDirectory()) filePath = join(filePath, "index.html");
    } catch {
      // SPA fallback
      filePath = join(uiDir, "index.html");
    }
    try {
      const body = await readFile(filePath);
      res.writeHead(200, {
        "content-type": MIME[extname(filePath)] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  }

  const httpServer = createServer((req, res) => {
    void serveStatic(req, res);
  });

  // ---------------------------------------------------------------- WebSocket

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const origin = req.headers.origin;
    // Origin presente = browser. Só a nossa própria origem é aceita.
    // Origin ausente = cliente não-browser (runtime RN, Node) — segue para
    // o handshake, onde o token decide.
    if (origin && !allowedOrigins.has(origin)) {
      log(`ws rejected: origin ${origin} not in allowlist`);
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws: WebSocket) => {
    let session: Session | null = null;
    let role: "studio" | "runtime" | null = null;

    // Sem hello válido em 5s, a conexão cai.
    const handshakeTimer = setTimeout(() => {
      if (!session) ws.close();
    }, 5000);

    function reject(code: Parameters<typeof protocolError>[0], message: string): void {
      log(`handshake rejected (${code}): ${message}`);
      ws.send(
        serializeMessage({ kind: "hello-reject", error: protocolError(code, message) }),
      );
      ws.close();
    }

    function acceptHello(hello: HelloMessage): void {
      if (hello.sessionToken !== sessionToken) {
        reject("unauthorized", "invalid session token");
        return;
      }
      if (hello.protocolVersion !== PROTOCOL_VERSION) {
        reject(
          "version-mismatch",
          `Studio uses protocol v${PROTOCOL_VERSION}, but the client uses v${hello.protocolVersion}. Update react-native-nativescope in the project.`,
        );
        return;
      }

      session = {
        socket: ws,
        sessionId: `session-${nextSessionId++}`,
        client: hello.client,
      };
      role = hello.role;

      // O runtime é único por app. Studios são leitores independentes: várias
      // abas podem observar e editar a mesma sessão sem expulsarem umas às outras.
      if (role === "studio") {
        studios.add(session);
      } else {
        clearCommandRoutes();
        clearStreamRoutes();
        runtime?.socket.close();
        runtime = session;
      }

      ws.send(
        serializeMessage({
          kind: "hello-ack",
          protocolVersion: PROTOCOL_VERSION,
          sessionId: session.sessionId,
        }),
      );

      if (role === "runtime") {
        log(`app connected: ${hello.client.name} (${hello.client.platform})`);
        sendToStudios({
          kind: "event",
          protocolVersion: PROTOCOL_VERSION,
          timestamp: Date.now(),
          type: "session.connected",
          payload: { sessionId: session.sessionId, client: hello.client, providers: [] },
        });
      } else if (runtime) {
        // Studio chegou depois do app: replay do connected para não perder estado.
        sendTo(session, {
          kind: "event",
          protocolVersion: PROTOCOL_VERSION,
          timestamp: Date.now(),
          type: "session.connected",
          payload: { sessionId: runtime.sessionId, client: runtime.client, providers: [] },
        });
      }
    }

    ws.on("message", (data) => {
      const parsed = parseMessage(data.toString());
      if (!parsed.ok) {
        if (!session) reject("invalid-message", "malformed handshake message");
        return; // pós-handshake: descarta silenciosamente
      }
      const message = parsed.message;

      if (!session) {
        if (message.kind === "hello") {
          clearTimeout(handshakeTimer);
          acceptHello(message);
        } else {
          reject("invalid-message", "expected a hello message");
        }
        return;
      }

      // Cada aba gera requestIds locais (normalmente req-1, req-2...). O bridge
      // troca por um id global antes de enviar ao runtime e restaura o original
      // na volta, evitando colisões entre Studios simultâneos.
      if (role === "studio" && message.kind === "command") {
        if (!runtime || runtime.socket.readyState !== WebSocket.OPEN) return;
        if (message.type === "stream.cancel") {
          deleteStreamRoute(message.payload.streamId);
        }
        const bridgeRequestId = `bridge-${nextBridgeRequestId++}`;
        commandRoutes.set(bridgeRequestId, {
          studio: session,
          studioRequestId: message.requestId,
          timer: setTimeout(
            () => deleteCommandRoute(bridgeRequestId),
            COMMAND_ROUTE_TTL_MS,
          ),
        });
        sendTo(runtime, { ...message, requestId: bridgeRequestId });
      } else if (role === "runtime" && message.kind === "command-result") {
        const route = commandRoutes.get(message.requestId);
        if (!route) return;
        deleteCommandRoute(message.requestId);
        if (
          message.ok &&
          message.result &&
          typeof message.result === "object" &&
          "streamId" in message.result &&
          typeof message.result.streamId === "string"
        ) {
          const streamId = message.result.streamId;
          streamRoutes.set(streamId, {
            studio: route.studio,
            timer: setTimeout(() => deleteStreamRoute(streamId), STREAM_ROUTE_TTL_MS),
          });
        }
        sendTo(route.studio, { ...message, requestId: route.studioRequestId });
      } else if (role === "runtime" && message.kind === "event") {
        if (message.type === "stream.chunk" || message.type === "stream.end") {
          const route = streamRoutes.get(message.payload.streamId);
          if (route) sendTo(route.studio, message);
          if (message.type === "stream.end") deleteStreamRoute(message.payload.streamId);
        } else {
          sendToStudios(message);
        }
      }
    });

    ws.on("close", () => {
      clearTimeout(handshakeTimer);
      if (!session) return;
      if (role === "runtime" && runtime === session) {
        runtime = null;
        clearCommandRoutes();
        clearStreamRoutes();
        log(`app disconnected: ${session.client.name}`);
        sendToStudios({
          kind: "event",
          protocolVersion: PROTOCOL_VERSION,
          timestamp: Date.now(),
          type: "session.disconnected",
          payload: { sessionId: session.sessionId },
        });
      } else if (role === "studio") {
        studios.delete(session);
        for (const [requestId, route] of commandRoutes) {
          if (route.studio === session) deleteCommandRoute(requestId);
        }
        for (const [streamId, route] of streamRoutes) {
          if (route.studio === session) deleteStreamRoute(streamId);
        }
      }
    });
  });

  return new Promise<{ close: () => void }>((resolve, reject) => {
    httpServer.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(
            `Port ${port} is already in use. Is another NativeScope process running? Use --port to choose another port.`,
          ),
        );
      } else {
        reject(err);
      }
    });
    httpServer.listen(port, host, () => {
      resolve({
        close() {
          clearCommandRoutes();
          clearStreamRoutes();
          wss.close();
          httpServer.close();
        },
      });
    });
    // silencia o warning de variável não usada — project alimenta endpoints futuros (/status)
    void project;
  });
}
