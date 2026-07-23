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
  type ProviderDescriptor,
} from "@rnsi/protocol";
import type { DetectedProject } from "./detect.ts";
import { createThrottledLogger } from "./log-throttle.ts";

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
  /** Intervalo do heartbeat em ms; default HEARTBEAT_INTERVAL_MS. Exposto p/ testes. */
  heartbeatIntervalMs?: number;
  /** Janela de agregação dos logs de rejeição; default DEFAULT_LOG_WINDOW_MS. */
  logWindowMs?: number;
}

/** Quem está do outro lado de uma conexão recusada — sem isso, toda rejeição
 * era uma linha anônima e aba antiga do Studio ficava indistinguível de device
 * com bundle velho. Nunca inclui o token recebido. */
function describePeer(req: IncomingMessage, hello: HelloMessage | null): string {
  const remote = (req.socket.remoteAddress ?? "unknown").replace(/^::ffff:/, "");
  const origin = req.headers.origin;
  const who = hello
    ? `${hello.role} ${hello.client.name} (${hello.client.platform})`
    : "unknown client";
  return origin ? `${who} from ${remote}, origin ${origin}` : `${who} from ${remote}`;
}

interface Session {
  socket: WebSocket;
  sessionId: string;
  client: HelloMessage["client"];
  /** Runtime: id estável do device (chave do mapa `runtimes`). Studio: o próprio
   * sessionId (placeholder — studios não são roteados por device). */
  deviceId: string;
  /** Rótulo legível do device (runtime). Studio: irrelevante. */
  label: string;
  /** Studio: device que ele inspeciona agora. Runtime: sempre null. */
  targetDeviceId: string | null;
}

const COMMAND_ROUTE_TTL_MS = 10_000;
const STREAM_ROUTE_TTL_MS = 10 * 60_000;
/**
 * Intervalo do ping de liveness. Socket sem pong nem tráfego entre dois ticks
 * é considerado morto e derrubado — pega conexão meia-aberta (device dormiu,
 * WiFi caiu) que o close de TCP não entrega por minutos.
 */
const HEARTBEAT_INTERVAL_MS = 15_000;

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
        if (addr.family === "IPv4" && !addr.internal)
          allowedOrigins.add(`http://${addr.address}:${port}`);
      }
    }
  }

  // Rejeições são disparadas por clientes que NÃO controlamos (aba antiga,
  // bundle velho, outro projeto na mesma porta). Sem agregação, um único
  // cliente inválido enche o terminal sozinho. Ver log-throttle.ts.
  const rejectionLog = createThrottledLogger(log, options.logWindowMs);

  const studios = new Set<Session>();
  // Runtimes vivos, keyed por deviceId (estável entre reconexões). Substitui o
  // slot único: iOS e Android coexistem em vez de se expulsarem.
  const runtimes = new Map<string, Session>();
  // Liveness por socket (ver HEARTBEAT_INTERVAL_MS). WeakSet: some no GC sozinho.
  const alive = new WeakSet<WebSocket>();
  let nextSessionId = 1;
  let nextBridgeRequestId = 1;
  let nextGlobalStreamId = 1;
  const commandRoutes = new Map<
    string,
    {
      studio: Session;
      studioRequestId: string;
      deviceId: string;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  // Streams: o id local (do runtime) só é único por-device; o bridge reescreve
  // para um id global (gstream-N) e mapeia os dois sentidos. Chave = id global.
  const streamRoutes = new Map<
    string,
    {
      studio: Session;
      deviceId: string;
      localStreamId: string;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  /**
   * Último estado anunciado por device — o bridge já vê todo
   * provider.registered passando, então lembrar custa quase nada e paga caro:
   * um Studio que abre DEPOIS do app (ou uma segunda aba, ou um F5) recebe a
   * lista completa dentro do próprio session.connected, sem round-trip e sem
   * janela em que a tela mostra metade dos storages.
   */
  const providersByDevice = new Map<string, Map<string, ProviderDescriptor>>();

  function providersOf(deviceId: string): ProviderDescriptor[] {
    return [...(providersByDevice.get(deviceId)?.values() ?? [])];
  }

  // Índice reverso p/ traduzir chunk/end vindos do runtime:
  // `${deviceId} ${localStreamId}` → id global.
  const streamIdByLocal = new Map<string, string>();

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
    streamIdByLocal.delete(`${route.deviceId} ${route.localStreamId}`);
  }

  function clearStreamRoutes(): void {
    for (const streamId of streamRoutes.keys()) deleteStreamRoute(streamId);
  }

  /** Limpa rotas de comando/stream de UM device (self-replace ou desconexão) —
   * sem tocar nas dos outros devices, que seguem vivos. */
  function clearRoutesForDevice(deviceId: string): void {
    for (const [requestId, route] of commandRoutes) {
      if (route.deviceId === deviceId) deleteCommandRoute(requestId);
    }
    for (const [streamId, route] of streamRoutes) {
      if (route.deviceId === deviceId) deleteStreamRoute(streamId);
    }
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
      const remote = (req.socket.remoteAddress ?? "unknown").replace(/^::ffff:/, "");
      rejectionLog.log(
        `origin ${origin} ${remote}`,
        `ws rejected: origin ${origin} not in allowlist (from ${remote})`,
      );
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    let session: Session | null = null;
    let role: "studio" | "runtime" | null = null;

    // Heartbeat: nasce vivo; o pong (resposta nativa do device ao nosso ping) e
    // qualquer mensagem renovam a vida. Só um socket 100% ocioso depende do
    // auto-pong — mensagem também conta, então app ativo nunca é derrubado.
    alive.add(ws);
    ws.on("pong", () => alive.add(ws));

    // Sem hello válido em 5s, a conexão cai.
    const handshakeTimer = setTimeout(() => {
      if (!session) ws.close();
    }, 5000);

    function reject(
      code: Parameters<typeof protocolError>[0],
      message: string,
      hello: HelloMessage | null = null,
    ): void {
      const peer = describePeer(req, hello);
      // Dica só faz sentido no caso do token: Origin presente = browser, e um
      // browser com token velho é quase sempre uma aba esquecida aberta.
      const hint =
        code === "unauthorized" && req.headers.origin
          ? " — likely a Studio tab left open from an earlier session; close it and open the Studio URL printed above"
          : "";
      rejectionLog.log(
        `handshake ${code} ${peer}`,
        `handshake rejected (${code}): ${message} — ${peer}${hint}`,
      );
      ws.send(
        serializeMessage({
          kind: "hello-reject",
          error: protocolError(code, message),
        }),
      );
      ws.close();
    }

    function acceptHello(hello: HelloMessage): void {
      if (hello.sessionToken !== sessionToken) {
        reject("unauthorized", "invalid session token", hello);
        return;
      }
      if (hello.protocolVersion !== PROTOCOL_VERSION) {
        reject(
          "version-mismatch",
          `Studio uses protocol v${PROTOCOL_VERSION}, but the client uses v${hello.protocolVersion}. Update react-native-nativescope in the project.`,
          hello,
        );
        return;
      }

      const sessionId = `session-${nextSessionId++}`;
      // Runtime: id estável vindo do device (fallback anon- p/ shim antigo, único
      // por conexão). Studio: o próprio sessionId, nunca usado como chave.
      const deviceId =
        hello.role === "runtime" ? (hello.client.deviceId ?? `anon-${sessionId}`) : sessionId;
      const label = hello.client.label ?? hello.client.platform;
      session = {
        socket: ws,
        sessionId,
        client: hello.client,
        deviceId,
        label,
        targetDeviceId: null,
      };
      role = hello.role;

      // Studios são leitores independentes (N abas). Runtimes coexistem keyed por
      // deviceId: um device novo NÃO expulsa outro. Só o MESMO deviceId se
      // auto-substitui (reload/duplicata) — fecha só o socket velho dele.
      if (role === "studio") {
        studios.add(session);
      } else {
        runtimes.get(deviceId)?.socket.close();
        runtimes.set(deviceId, session);
        // Contexto novo do app: esquece o que o anterior tinha anunciado. O
        // runtime reanuncia tudo logo após este handshake.
        providersByDevice.set(deviceId, new Map());
      }

      ws.send(
        serializeMessage({
          kind: "hello-ack",
          protocolVersion: PROTOCOL_VERSION,
          sessionId,
        }),
      );

      if (role === "runtime") {
        log(`app connected: ${hello.client.name} (${hello.client.platform})`);
        sendToStudios({
          kind: "event",
          protocolVersion: PROTOCOL_VERSION,
          timestamp: Date.now(),
          deviceId,
          type: "session.connected",
          payload: {
            sessionId,
            client: hello.client,
            providers: [],
            deviceId,
            label,
          },
        });
      } else {
        // Studio recém-chegado: replay de TODOS os runtimes vivos para popular o
        // seletor sem perder quem já estava conectado.
        for (const rt of runtimes.values()) {
          sendTo(session, {
            kind: "event",
            protocolVersion: PROTOCOL_VERSION,
            timestamp: Date.now(),
            deviceId: rt.deviceId,
            type: "session.connected",
            payload: {
              sessionId: rt.sessionId,
              client: rt.client,
              providers: providersOf(rt.deviceId),
              deviceId: rt.deviceId,
              label: rt.label,
            },
          });
        }
      }
    }

    ws.on("message", (data) => {
      alive.add(ws);
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
        // Roteamento stateless: o comando diz o device-alvo. Sem alvo vivo, dropa
        // (o Studio reenvia ao reselecionar; o timeout dele cobre a corrida).
        const target = message.deviceId ? runtimes.get(message.deviceId) : undefined;
        if (!target || target.socket.readyState !== WebSocket.OPEN) return;
        let outbound: typeof message = message;
        if (message.type === "stream.cancel") {
          // O studio cancela pelo id GLOBAL; traduz de volta pro id local do device.
          const route = streamRoutes.get(message.payload.streamId);
          const localStreamId = route?.localStreamId ?? message.payload.streamId;
          deleteStreamRoute(message.payload.streamId);
          outbound = {
            ...message,
            payload: { ...message.payload, streamId: localStreamId },
          };
        }
        const bridgeRequestId = `bridge-${nextBridgeRequestId++}`;
        commandRoutes.set(bridgeRequestId, {
          studio: session,
          studioRequestId: message.requestId,
          deviceId: target.deviceId,
          timer: setTimeout(() => deleteCommandRoute(bridgeRequestId), COMMAND_ROUTE_TTL_MS),
        });
        sendTo(target, { ...outbound, requestId: bridgeRequestId });
      } else if (role === "runtime" && message.kind === "command-result") {
        const route = commandRoutes.get(message.requestId);
        if (!route) return;
        deleteCommandRoute(message.requestId);
        let outbound: typeof message = {
          ...message,
          requestId: route.studioRequestId,
        };
        if (
          message.ok &&
          message.result &&
          typeof message.result === "object" &&
          "streamId" in message.result &&
          typeof message.result.streamId === "string"
        ) {
          // Reescreve o id local (único só por-device) para um id global e
          // registra os dois sentidos — espelha o bridging de requestId.
          const localStreamId = message.result.streamId;
          const globalStreamId = `gstream-${nextGlobalStreamId++}`;
          streamRoutes.set(globalStreamId, {
            studio: route.studio,
            deviceId: route.deviceId,
            localStreamId,
            timer: setTimeout(() => deleteStreamRoute(globalStreamId), STREAM_ROUTE_TTL_MS),
          });
          streamIdByLocal.set(`${route.deviceId} ${localStreamId}`, globalStreamId);
          outbound = {
            ...message,
            requestId: route.studioRequestId,
            result: { ...message.result, streamId: globalStreamId },
          };
        }
        sendTo(route.studio, outbound);
      } else if (role === "runtime" && message.kind === "event") {
        if (message.type === "stream.chunk" || message.type === "stream.end") {
          // chunk/end trazem o id LOCAL do runtime; traduz p/ o global e reescreve.
          const globalStreamId = streamIdByLocal.get(
            `${session.deviceId} ${message.payload.streamId}`,
          );
          if (globalStreamId !== undefined) {
            const route = streamRoutes.get(globalStreamId);
            if (route) {
              // Cast: o spread da união confunde o excess-check do TS no literal
              // de payload; a forma em runtime é um stream.chunk/end válido.
              sendTo(route.studio, {
                ...message,
                deviceId: session.deviceId,
                payload: { ...message.payload, streamId: globalStreamId },
              } as AnyMessage);
            }
            if (message.type === "stream.end") deleteStreamRoute(globalStreamId);
          }
        } else {
          if (message.type === "provider.registered") {
            const known =
              providersByDevice.get(session.deviceId) ?? new Map<string, ProviderDescriptor>();
            known.set(message.payload.provider.providerId, message.payload.provider);
            providersByDevice.set(session.deviceId, known);
          }
          // Demais eventos (provider.registered, key-value.changed, ...) vão a
          // todos os studios, carimbados com o device de origem p/ filtragem.
          sendToStudios({ ...message, deviceId: session.deviceId });
        }
      }
    });

    ws.on("close", () => {
      clearTimeout(handshakeTimer);
      if (!session) return;
      // Só remove se ESTE socket ainda é o dono do deviceId — se um self-replace
      // já pôs um socket novo no lugar, não mexe (quem manda agora é o novo).
      if (role === "runtime" && runtimes.get(session.deviceId) === session) {
        runtimes.delete(session.deviceId);
        providersByDevice.delete(session.deviceId);
        clearRoutesForDevice(session.deviceId);
        log(`app disconnected: ${session.client.name}`);
        sendToStudios({
          kind: "event",
          protocolVersion: PROTOCOL_VERSION,
          timestamp: Date.now(),
          deviceId: session.deviceId,
          type: "session.disconnected",
          payload: { sessionId: session.sessionId, deviceId: session.deviceId },
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

  // Um único tick varre todos os sockets (studios + runtimes): derruba os que
  // não deram sinal desde o último ping, pinga o resto.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      try {
        ws.ping();
      } catch {
        // socket já fechando: o próximo tick derruba se preciso
      }
    }
  }, options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS);

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
          clearInterval(heartbeat);
          rejectionLog.stop();
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
