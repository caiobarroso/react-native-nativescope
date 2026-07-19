import {
  PROTOCOL_VERSION,
  parseMessage,
  serializeMessage,
  providerListResultSchema,
  keyValueListResultSchema,
  keyValueGetResultSchema,
  databaseTablesResultSchema,
  databaseRowsResultSchema,
  databaseExecuteResultSchema,
  type AnyMessage,
  type CellValue,
  type CommandMessage,
  type ExecuteResult,
  type KeyEntry,
  type Row,
  type RowRef,
  type StorageValue,
} from "@rnsi/protocol";
import { createTransport, type Transport } from "@rnsi/runtime";
import { useStudio, keysId } from "./store.ts";

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
const tableRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

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

/**
 * Reagenda a releitura do schema após database.changed — mas SÓ para a
 * instância que o usuário está olhando. tables() custa PRAGMA+COUNT por
 * tabela no device; com um app inserindo continuamente, refresh
 * incondicional viraria carga permanente mesmo com o Studio em outra tela.
 * Ao selecionar a instância, a UI recarrega tudo de qualquer forma.
 */
const TABLE_REFRESH_DEBOUNCE_MS = 400;

function scheduleTableRefresh(providerId: string, instanceId: string): void {
  const selection = useStudio.getState().selection;
  if (selection?.providerId !== providerId || selection.instanceId !== instanceId) return;

  const key = `${providerId} ${instanceId}`;
  const current = tableRefreshTimers.get(key);
  if (current) clearTimeout(current);
  tableRefreshTimers.set(
    key,
    setTimeout(() => {
      tableRefreshTimers.delete(key);
      void loadTables(providerId, instanceId);
    }, TABLE_REFRESH_DEBOUNCE_MS),
  );
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

    case "database.changed": {
      const provider = store.providers.find(
        (p) => p.providerId === event.payload.providerId,
      );
      store.applyDatabaseChange({
        providerId: event.payload.providerId,
        providerLabel: provider?.label ?? event.payload.providerId,
        instanceId: event.payload.instanceId,
        table: event.payload.table,
        rowId: event.payload.rowId,
        operation: event.payload.operation,
        source: event.payload.source,
        timestamp: event.timestamp,
      });
      scheduleTableRefresh(event.payload.providerId, event.payload.instanceId);
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

/** Tamanho de página da lista de chaves — mantém cada resposta leve. */
const KEY_PAGE_LIMIT = 200;

export async function loadKeys(providerId: string, instanceId: string): Promise<void> {
  const result = await sendCommand({
    type: "key-value.list",
    payload: { providerId, instanceId, limit: KEY_PAGE_LIMIT },
  });
  const parsed = keyValueListResultSchema.safeParse(result);
  if (parsed.success) {
    useStudio.getState().setKeys(providerId, instanceId, parsed.data, "replace");
  }
}

/** Próxima página, anexada à janela já carregada. No-op na última página. */
export async function loadMoreKeys(providerId: string, instanceId: string): Promise<void> {
  const meta = useStudio.getState().keysMeta[keysId(providerId, instanceId)];
  if (!meta?.nextAfterKey) return;
  const result = await sendCommand({
    type: "key-value.list",
    payload: { providerId, instanceId, afterKey: meta.nextAfterKey, limit: KEY_PAGE_LIMIT },
  });
  const parsed = keyValueListResultSchema.safeParse(result);
  if (parsed.success) {
    useStudio.getState().setKeys(providerId, instanceId, parsed.data, "append");
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

/**
 * Varredura paginada da listagem (busca global, snapshots) — devolve os
 * dados em vez de gravar no store. Limitada por maxEntries para nunca puxar
 * um dataset GB inteiro; quem chama decide se o recorte basta.
 */
export async function fetchAllKeys(
  providerId: string,
  instanceId: string,
  options?: { maxEntries?: number },
): Promise<{ entries: KeyEntry[]; complete: boolean; total: number }> {
  const maxEntries = options?.maxEntries ?? 2000;
  const entries: KeyEntry[] = [];
  let afterKey: string | undefined;
  let total = 0;
  for (;;) {
    const result = await sendCommand({
      type: "key-value.list",
      payload: { providerId, instanceId, ...(afterKey ? { afterKey } : {}), limit: 500 },
    });
    const parsed = keyValueListResultSchema.safeParse(result);
    if (!parsed.success) return { entries, complete: false, total };
    entries.push(...parsed.data.entries);
    total = parsed.data.total;
    if (parsed.data.nextAfterKey === null) return { entries, complete: true, total };
    if (entries.length >= maxEntries) return { entries, complete: false, total };
    afterKey = parsed.data.nextAfterKey;
  }
}

export async function fetchAllTables(providerId: string, instanceId: string) {
  const result = await sendCommand({
    type: "database.tables",
    payload: { providerId, instanceId },
  });
  const parsed = databaseTablesResultSchema.safeParse(result);
  return parsed.success ? parsed.data.tables : [];
}

// ------------------------------------------------------------- database.*

export async function loadTables(providerId: string, instanceId: string): Promise<void> {
  const result = await sendCommand({
    type: "database.tables",
    payload: { providerId, instanceId },
  });
  const parsed = databaseTablesResultSchema.safeParse(result);
  if (parsed.success) {
    useStudio.getState().setTables(providerId, instanceId, parsed.data.tables);
  }
}

export async function loadRows(
  providerId: string,
  instanceId: string,
  table: string,
  options: { limit: number; offset: number; orderBy?: string; direction?: "asc" | "desc" },
): Promise<{ rows: Row[]; total: number } | null> {
  const result = await sendCommand({
    type: "database.rows",
    payload: { providerId, instanceId, table, ...options },
  });
  const parsed = databaseRowsResultSchema.safeParse(result);
  return parsed.success ? parsed.data : null;
}

export async function updateCell(
  providerId: string,
  instanceId: string,
  table: string,
  ref: RowRef,
  column: string,
  value: CellValue,
): Promise<void> {
  await sendCommand({
    type: "database.update",
    payload: { providerId, instanceId, table, ref, set: { [column]: value } },
  });
}

export async function insertRow(
  providerId: string,
  instanceId: string,
  table: string,
  values: Record<string, CellValue>,
): Promise<RowRef | null> {
  const result = await sendCommand({
    type: "database.insert",
    payload: { providerId, instanceId, table, values },
  });
  if (
    result &&
    typeof result === "object" &&
    "ref" in result &&
    (result.ref === null || typeof result.ref === "object")
  ) {
    return result.ref as RowRef | null;
  }
  return null;
}

export async function deleteRow(
  providerId: string,
  instanceId: string,
  table: string,
  ref: RowRef,
): Promise<void> {
  await sendCommand({
    type: "database.delete",
    payload: { providerId, instanceId, table, ref },
  });
}

export async function executeSql(
  providerId: string,
  instanceId: string,
  sql: string,
): Promise<ExecuteResult> {
  const result = await sendCommand({
    type: "database.execute",
    payload: { providerId, instanceId, sql },
  });
  const parsed = databaseExecuteResultSchema.safeParse(result);
  if (!parsed.success) throw new Error("resposta inválida do runtime");
  return parsed.data.result;
}
