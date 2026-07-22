import {
  PROTOCOL_VERSION,
  WIRE_MESSAGE_BUDGET,
  exceedsWireBudget,
  parseMessage,
  serializeMessage,
  type AnyMessage,
  type EventMessage,
} from "@rnsi/protocol";
import { createRegistry, type AdapterRegistry } from "./registry.ts";
import { handleCommand } from "./command-handler.ts";
import { createStreamHub } from "./streams.ts";
import { createCoalescer } from "./event-coalescer.ts";
import type { DatabaseChange, KeyValueChange } from "./adapter.ts";
import { createTransport, type Transport, type WebSocketLike } from "./transport.ts";
import { isDatabaseAdapter, isKeyValueAdapter, type ProviderAdapter } from "./adapter.ts";
import { emitAppDevtoolsChange } from "./app-devtools.ts";

export interface RuntimeOptions {
  url: string;
  sessionToken: string;
  client: { name: string; platform: string; deviceId?: string; label?: string };
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
  const watchedInstances = new Map<string, Set<string>>();
  let handshakeDone = false;

  function send(message: AnyMessage): void {
    const raw = serializeMessage(message);
    // Guard de fio (§1): nenhuma mensagem deveria carregar um valor inteiro —
    // valores grandes saem por stream.*. Se estourou, é bug de arquitetura (o
    // caso Flipper). Gritamos em dev, mas NUNCA lançamos: derrubar o app do
    // usuário por causa do inspector violaria a promessa central.
    if (exceedsWireBudget(raw)) {
      console.error(
        `[rnsi] frame acima do orçamento de fio (${WIRE_MESSAGE_BUDGET} bytes): ` +
          `type=${message.kind === "event" || message.kind === "command" ? message.type : message.kind}, ` +
          `~${raw.length} chars — deveria ir por stream.*`,
      );
    }
    transport.send(raw);
  }

  function sendEvent(event: EventMessage): void {
    if (handshakeDone) send(event);
  }

  // Valores grandes saem em chunks — ver streams.ts.
  const streams = createStreamHub(sendEvent);

  // Rajadas de escrita são fundidas antes de virar tráfego (ADR-0001):
  // a primeira mudança sai realtime; as seguintes na janela viram UM evento
  // com coalescedCount. Vale para o WS e para o bus do /app igualmente.
  interface KvItem {
    providerId: string;
    instanceId: string;
    change: KeyValueChange;
  }
  const kvCoalescer = createCoalescer<KvItem>((item, coalescedCount) => {
    const timestamp = Date.now();
    const { providerId, instanceId, change } = item;
    sendEvent({
      kind: "event",
      protocolVersion: PROTOCOL_VERSION,
      timestamp,
      type: "key-value.changed",
      payload: {
        providerId,
        instanceId,
        key: change.key,
        change: change.change,
        source: change.source,
        entry: change.entry,
        ...(coalescedCount > 1 ? { coalescedCount } : {}),
      },
    });
    emitAppDevtoolsChange({
      kind: "key-value",
      providerId,
      instanceId,
      key: change.key,
      change: change.change,
      source: change.source,
      entry: change.entry,
      timestamp,
    });
  });

  interface DbItem {
    providerId: string;
    instanceId: string;
    change: DatabaseChange;
  }
  const dbCoalescer = createCoalescer<DbItem>((item, coalescedCount) => {
    const timestamp = Date.now();
    const { providerId, instanceId, change } = item;
    sendEvent({
      kind: "event",
      protocolVersion: PROTOCOL_VERSION,
      timestamp,
      type: "database.changed",
      payload: {
        providerId,
        instanceId,
        table: change.table,
        rowId: change.rowId,
        operation: change.operation,
        source: change.source,
        ...(coalescedCount > 1 ? { coalescedCount } : {}),
      },
    });
    emitAppDevtoolsChange({
      kind: "database",
      providerId,
      instanceId,
      table: change.table,
      rowId: change.rowId,
      operation: change.operation,
      source: change.source,
      timestamp,
    });
  });

  function providerDescriptor(adapter: ProviderAdapter) {
    return {
      providerId: adapter.providerId,
      label: adapter.label,
      capabilities: adapter.capabilities,
      instances: adapter.instances(),
    };
  }

  function announceProvider(adapter: ProviderAdapter): void {
    sendEvent({
      kind: "event",
      protocolVersion: PROTOCOL_VERSION,
      timestamp: Date.now(),
      type: "provider.registered",
      payload: {
        provider: providerDescriptor(adapter),
      },
    });
  }

  function watchAdapter(adapter: ProviderAdapter): void {
    const watched = watchedInstances.get(adapter.providerId) ?? new Set<string>();
    watchedInstances.set(adapter.providerId, watched);

    for (const { instanceId } of adapter.instances()) {
      if (watched.has(instanceId)) continue;
      watched.add(instanceId);

      if (isKeyValueAdapter(adapter)) {
        subscriptions.push(
          adapter.subscribe(instanceId, (change) => {
            kvCoalescer.push(`${adapter.providerId}\0${instanceId}\0${change.key}`, {
              providerId: adapter.providerId,
              instanceId,
              change,
            });
          }),
        );
      } else if (isDatabaseAdapter(adapter)) {
        subscriptions.push(
          adapter.subscribe(instanceId, (change) => {
            dbCoalescer.push(`${adapter.providerId}\0${instanceId}\0${change.table}`, {
              providerId: adapter.providerId,
              instanceId,
              change,
            });
          }),
        );
      }
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
        // Resync de estado, não fila de eventos atrasados.
        //
        // Os shims registram seus adapters no import da lib — que acontece no
        // boot do app, dezenas ou centenas de ms ANTES do WebSocket conectar.
        // Todo anúncio dessa fase caía no gate de sendEvent e era descartado em
        // silêncio; a lista só se recompunha porque o Studio, por sorte, pedia
        // provider.list depois. Reanunciar aqui torna o device dono da própria
        // verdade: tudo que existe no momento da conexão chega junto, sempre,
        // na primeira conexão e em toda reconexão. upsertProvider no Studio é
        // idempotente por providerId, então repetir não duplica nada.
        for (const provider of registry.describe()) {
          sendEvent({
            kind: "event",
            protocolVersion: PROTOCOL_VERSION,
            timestamp: Date.now(),
            type: "provider.registered",
            payload: { provider },
          });
        }
        return;
      }
      if (message.kind === "hello-reject") {
        // Token errado ou versão incompatível: desistir é correto (o token do
        // serviço é fixo enquanto ele vive, retentar nunca daria certo), mas
        // desistir em SILÊNCIO deixava o inspector morto sem explicação — e
        // jogava fora a mensagem que o serviço escreveu justamente para ser
        // lida, como a de versão incompatível. Uma linha, uma vez.
        console.warn(
          `[nativescope] connection refused (${message.error.code}): ${message.error.message} ` +
            `Reload the app to try again.`,
        );
        transport.close();
        return;
      }
      if (message.kind === "command") {
        send(await handleCommand(registry, message, { streams }));
      }
    },
  });

  registry.onRegister((adapter) => {
    watchAdapter(adapter);
    subscriptions.push(
      adapter.onInstancesChanged?.(() => {
        watchAdapter(adapter);
        announceProvider(adapter);
      }) ?? (() => {}),
    );
    announceProvider(adapter);
  });

  return {
    registry,
    close() {
      for (const unsubscribe of subscriptions) unsubscribe();
      transport.close();
    },
  };
}
