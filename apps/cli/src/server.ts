import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import {
  PROTOCOL_VERSION,
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
}

interface Session {
  socket: WebSocket;
  sessionId: string;
  client: { name: string; platform: string };
}

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
 * - loopback only, nunca 0.0.0.0.
 */
export function startLocalServer(options: LocalServerOptions) {
  const { port, sessionToken, uiDir, project, log } = options;

  let studio: Session | null = null;
  let runtime: Session | null = null;
  let nextSessionId = 1;

  function sendTo(session: Session | null, message: AnyMessage): void {
    if (session && session.socket.readyState === WebSocket.OPEN) {
      session.socket.send(serializeMessage(message));
    }
  }

  // -------------------------------------------------------------------- HTTP

  async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!uiDir) {
      res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
      res.end("UI não construída. Rode: pnpm --filter @rnsi/desktop build");
      return;
    }
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    // normalize + verificação de prefixo: nada de path traversal
    let filePath = normalize(join(uiDir, url.pathname === "/" ? "index.html" : url.pathname));
    if (!filePath.startsWith(normalize(uiDir))) {
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
    if (origin) {
      const allowed = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
      if (!allowed.includes(origin)) {
        socket.destroy();
        return;
      }
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
      ws.send(
        serializeMessage({ kind: "hello-reject", error: protocolError(code, message) }),
      );
      ws.close();
    }

    function acceptHello(hello: HelloMessage): void {
      if (hello.sessionToken !== sessionToken) {
        reject("unauthorized", "token de sessão inválido");
        return;
      }
      if (hello.protocolVersion !== PROTOCOL_VERSION) {
        reject(
          "version-mismatch",
          `Studio fala protocolo v${PROTOCOL_VERSION}, cliente fala v${hello.protocolVersion}. Atualize react-native-storage-inspector no projeto.`,
        );
        return;
      }

      session = {
        socket: ws,
        sessionId: `session-${nextSessionId++}`,
        client: hello.client,
      };
      role = hello.role;

      // Última conexão vence — cobre reload do app e refresh da UI.
      if (role === "studio") {
        studio?.socket.close();
        studio = session;
      } else {
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
        log(`app conectado: ${hello.client.name} (${hello.client.platform})`);
        sendTo(studio, {
          kind: "event",
          protocolVersion: PROTOCOL_VERSION,
          timestamp: Date.now(),
          type: "session.connected",
          payload: { sessionId: session.sessionId, client: hello.client, providers: [] },
        });
      } else if (runtime) {
        // Studio chegou depois do app: replay do connected para não perder estado.
        sendTo(studio, {
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
        if (!session) reject("invalid-message", "mensagem malformada no handshake");
        return; // pós-handshake: descarta silenciosamente
      }
      const message = parsed.message;

      if (!session) {
        if (message.kind === "hello") {
          clearTimeout(handshakeTimer);
          acceptHello(message);
        } else {
          reject("invalid-message", "esperava hello");
        }
        return;
      }

      // Bridge: commands do Studio vão para o runtime; results e events do
      // runtime vão para o Studio. O serviço valida e roteia — não interpreta.
      if (role === "studio" && message.kind === "command") {
        sendTo(runtime, message);
      } else if (role === "runtime" && (message.kind === "command-result" || message.kind === "event")) {
        sendTo(studio, message);
      }
    });

    ws.on("close", () => {
      clearTimeout(handshakeTimer);
      if (!session) return;
      if (role === "runtime" && runtime === session) {
        runtime = null;
        log(`app desconectado: ${session.client.name}`);
        sendTo(studio, {
          kind: "event",
          protocolVersion: PROTOCOL_VERSION,
          timestamp: Date.now(),
          type: "session.disconnected",
          payload: { sessionId: session.sessionId },
        });
      } else if (role === "studio" && studio === session) {
        studio = null;
      }
    });
  });

  return new Promise<{ close: () => void }>((resolve, reject) => {
    httpServer.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(
            `porta ${port} já está em uso. Outro rn-storage-inspector rodando? Use --port para trocar.`,
          ),
        );
      } else {
        reject(err);
      }
    });
    httpServer.listen(port, "127.0.0.1", () => {
      resolve({
        close() {
          wss.close();
          httpServer.close();
        },
      });
    });
    // silencia o warning de variável não usada — project alimenta endpoints futuros (/status)
    void project;
  });
}
