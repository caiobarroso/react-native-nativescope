import {
  PROTOCOL_VERSION,
  parseMessage,
  serializeMessage,
  providerListResultSchema,
  keyValueListResultSchema,
  keyValueGetResultSchema,
  type AnyMessage,
  type CommandMessage,
  type StorageValue,
} from "@rnsi/protocol";
import { createTransport, type Transport } from "@rnsi/runtime";
import { useStudio } from "./store.ts";

/**
 * Cliente do Studio. Único ponto da UI que toca o WebSocket — nenhum
 * componente React fala com o fio diretamente (regra §16.2).
 *
 * Reusa o transport do runtime: ele é agnóstico de plataforma e o browser
 * tem WebSocket global.
 */

const COMMAND_TIMEOUT_MS = 4000;

type Pending = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

let transport: Transport | null = null;
const pending = new Map<string, Pending>();
let nextRequestId = 1;

function sessionToken(): string | null {
  return new URLSearchParams(window.location.search).get("token");
}

function serviceUrl(): string {
  // Servido pela CLI: mesma origem. Em `vite dev` (porta 1420), aponta
  // para o serviço local default.
  const host =
    window.location.port === "1420" ? "127.0.0.1:4782" : window.location.host;
  return `ws://${host}`;
}

export function connect(): void {
  const token = sessionToken();
  const store = useStudio.getState();

  if (!token) {
    store.setPhase("no-token");
    return;
  }
  if (transport) return;

  store.setPhase("connecting");

  transport = createTransport({
    url: serviceUrl(),
    onOpen() {
      send({
        kind: "hello",
        protocolVersion: PROTOCOL_VERSION,
        role: "studio",
        sessionToken: token,
        client: { name: "studio", platform: "web" },
      });
    },
    onClose() {
      useStudio.getState().setPhase("connecting");
    },
    onMessage(raw) {
      const parsed = parseMessage(raw);
      if (parsed.ok) handleMessage(parsed.message);
    },
  });
}

function send(message: AnyMessage): void {
  transport?.send(serializeMessage(message));
}

function handleMessage(message: AnyMessage): void {
  const store = useStudio.getState();

  switch (message.kind) {
    case "hello-ack":
      // Serviço ok. Se o app já estiver conectado, o serviço reenvia
      // session.connected na sequência.
      store.setPhase("waiting-app");
      return;

    case "hello-reject":
      store.setPhase("no-token");
      return;

    case "command-result": {
      const entry = pending.get(message.requestId);
      if (!entry) return;
      pending.delete(message.requestId);
      clearTimeout(entry.timer);
      if (message.ok) entry.resolve(message.result);
      else entry.reject(new Error(message.error.message));
      return;
    }

    case "event":
      handleEvent(message);
      return;
  }
}

function handleEvent(event: Extract<AnyMessage, { kind: "event" }>): void {
  const store = useStudio.getState();

  switch (event.type) {
    case "session.connected":
      store.setAppClient(event.payload.client);
      store.setPhase("connected");
      void refreshProviders();
      return;

    case "session.disconnected":
      store.setAppClient(null);
      store.setPhase("waiting-app");
      return;

    case "provider.registered": {
      store.upsertProvider(event.payload.provider);
      return;
    }

    case "key-value.changed": {
      const provider = store.providers.find(
        (p) => p.providerId === event.payload.providerId,
      );
      store.applyChange({
        providerId: event.payload.providerId,
        providerLabel: provider?.label ?? event.payload.providerId,
        instanceId: event.payload.instanceId,
        key: event.payload.key,
        change: event.payload.change,
        source: event.payload.source,
        entry: event.payload.entry,
        timestamp: event.timestamp,
      });
      return;
    }
  }
}

function sendCommand(
  partial: Pick<CommandMessage, "type" | "payload">,
): Promise<unknown> {
  const requestId = `req-${nextRequestId++}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("o app não respondeu a tempo"));
    }, COMMAND_TIMEOUT_MS);
    pending.set(requestId, { resolve, reject, timer });
    send({
      kind: "command",
      protocolVersion: PROTOCOL_VERSION,
      requestId,
      ...partial,
    } as CommandMessage);
  });
}

// ---------------------------------------------------------------- API da UI

export async function refreshProviders(): Promise<void> {
  const result = await sendCommand({ type: "provider.list", payload: {} });
  const parsed = providerListResultSchema.safeParse(result);
  if (parsed.success) useStudio.getState().setProviders(parsed.data.providers);
}

export async function loadKeys(providerId: string, instanceId: string): Promise<void> {
  const result = await sendCommand({
    type: "key-value.list",
    payload: { providerId, instanceId },
  });
  const parsed = keyValueListResultSchema.safeParse(result);
  if (parsed.success) {
    useStudio.getState().setKeys(providerId, instanceId, parsed.data.entries);
  }
}

export async function getValue(
  providerId: string,
  instanceId: string,
  key: string,
): Promise<StorageValue | null> {
  const result = await sendCommand({
    type: "key-value.get",
    payload: { providerId, instanceId, key },
  });
  const parsed = keyValueGetResultSchema.safeParse(result);
  return parsed.success ? parsed.data.value : null;
}

export async function setValue(
  providerId: string,
  instanceId: string,
  key: string,
  value: StorageValue,
): Promise<void> {
  await sendCommand({
    type: "key-value.set",
    payload: { providerId, instanceId, key, value },
  });
}

export async function removeKey(
  providerId: string,
  instanceId: string,
  key: string,
): Promise<void> {
  await sendCommand({
    type: "key-value.remove",
    payload: { providerId, instanceId, key },
  });
}
