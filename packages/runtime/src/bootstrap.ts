import {
  PROTOCOL_VERSION,
  parseMessage,
  serializeMessage,
  type AnyMessage,
  type EventMessage,
} from "@rnsi/protocol";
import { createRegistry, type AdapterRegistry } from "./registry.ts";
import { handleCommand } from "./command-handler.ts";
import { createTransport, type Transport, type WebSocketLike } from "./transport.ts";
import type { KeyValueAdapter } from "./adapter.ts";

export interface RuntimeOptions {
  url: string;
  sessionToken: string;
  client: { name: string; platform: string };
  createWebSocket?: (url: string) => WebSocketLike;
}

export interface Runtime {
  registry: AdapterRegistry;
  close(): void;
}

/**
 * Sobe o runtime: conecta no serviço local, faz handshake, atende commands
 * e retransmite mudanças dos adapters como events.
 *
 * Em produção isto nunca roda — o shim só entra no bundle de dev, e o guard
 * de CI garante isso. Não há gate de __DEV__ aqui dentro de propósito: a
 * blindagem fica na borda (bundle), não espalhada no código.
 */
export function startRuntime(options: RuntimeOptions): Runtime {
  const registry = createRegistry();
  const subscriptions: Array<() => void> = [];
  let handshakeDone = false;

  function send(message: AnyMessage): void {
    transport.send(serializeMessage(message));
  }

  function sendEvent(event: EventMessage): void {
    if (handshakeDone) send(event);
  }

  function watchAdapter(adapter: KeyValueAdapter): void {
    for (const { instanceId } of adapter.instances()) {
      subscriptions.push(
        adapter.subscribe(instanceId, (change) => {
          sendEvent({
            kind: "event",
            protocolVersion: PROTOCOL_VERSION,
            timestamp: Date.now(),
            type: "key-value.changed",
            payload: {
              providerId: adapter.providerId,
              instanceId,
              key: change.key,
              change: change.change,
              source: change.source,
              entry: change.entry,
            },
          });
        }),
      );
    }
  }

  const transport: Transport = createTransport({
    url: options.url,
    createWebSocket: options.createWebSocket,
    onOpen() {
      handshakeDone = false;
      send({
        kind: "hello",
        protocolVersion: PROTOCOL_VERSION,
        role: "runtime",
        sessionToken: options.sessionToken,
        client: options.client,
      });
    },
    onClose() {
      handshakeDone = false;
    },
    async onMessage(raw) {
      const parsed = parseMessage(raw);
      if (!parsed.ok) return; // mensagem malformada: ignora, nunca crasha o app

      const message = parsed.message;
      if (message.kind === "hello-ack") {
        handshakeDone = true;
        return;
      }
      if (message.kind === "hello-reject") {
        // Token errado ou versão incompatível: desiste sem barulho no app.
        transport.close();
        return;
      }
      if (message.kind === "command") {
        send(await handleCommand(registry, message));
      }
    },
  });

  registry.onRegister((adapter) => {
    watchAdapter(adapter);
    sendEvent({
      kind: "event",
      protocolVersion: PROTOCOL_VERSION,
      timestamp: Date.now(),
      type: "provider.registered",
      payload: {
        provider: {
          providerId: adapter.providerId,
          label: adapter.label,
          capabilities: adapter.capabilities,
          instances: adapter.instances(),
        },
      },
    });
  });

  return {
    registry,
    close() {
      for (const unsubscribe of subscriptions) unsubscribe();
      transport.close();
    },
  };
}
