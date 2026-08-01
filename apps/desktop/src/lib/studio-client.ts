import {
  PROTOCOL_VERSION,
  parseMessage,
  serializeMessage,
  providerListResultSchema,
  keyValueListResultSchema,
  keyValueGetResultSchema,
  keyValueGetFullResultSchema,
  databaseTablesResultSchema,
  databaseRowsResultSchema,
  databaseExecuteResultSchema,
  databaseCellResultSchema,
  keyValueSearchResultSchema,
  databaseSearchResultSchema,
  exportResultSchema,
  networkReplayResultSchema,
  networkGetBodyResultSchema,
  type AnyMessage,
  type NetworkBody,
  type CellValue,
  type CommandMessage,
  type ExecuteResult,
  type KeyEntry,
  type Row,
  type RowRef,
  type StorageValue,
} from "@rnsi/protocol";
import { createTransport, fnv1a32, type Transport } from "@rnsi/runtime";
import { useStudio, keysId, type Device, type Selection } from "./store.ts";
import { useNetwork } from "./network-store.ts";

/**
 * Cliente do Studio. Único ponto da UI que toca o WebSocket — nenhum
 * componente React fala com o fio diretamente (regra §16.2).
 *
 * Reusa o transport do runtime: ele é agnóstico de plataforma e o browser
 * tem WebSocket global.
 */

const COMMAND_TIMEOUT_MS = 4000;
/**
 * Operações destrutivas em lote são iniciadas pelo usuário e legitimamente
 * levam mais que os 4s do caso comum: esvaziar uma tabela de milhões de linhas
 * é rápido no SQLite, mas não instantâneo num telefone. Morrer por timeout aqui
 * seria pior que esperar — o DELETE já foi enviado e vai completar de qualquer
 * forma, e o Studio ficaria mostrando dado que não existe mais.
 */
const BULK_COMMAND_TIMEOUT_MS = 60_000;

type Pending = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

let transport: Transport | null = null;
const pending = new Map<string, Pending>();
let nextRequestId = 1;
const tableRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Montagem de streams (valores grandes chegam em chunks — plano §B).
 * O hash roda incrementalmente por chunk; nada aqui percorre o payload
 * inteiro de uma vez na main thread.
 */
interface ActiveStream {
  parts: string[];
  received: number;
  total: number;
  hash: number;
  onProgress?: ((received: number, total: number) => void) | undefined;
  /** Modo pipe: chunks vão direto ao consumidor (arquivo) e NÃO são retidos —
   * um export de GB nunca reside inteiro na memória da aba. */
  onChunk?: ((chunk: string) => void) | undefined;
  resolve: (data: string) => void;
  reject: (error: Error) => void;
  idleTimer: ReturnType<typeof setTimeout>;
}

const STREAM_IDLE_TIMEOUT_MS = 15_000;
const activeStreams = new Map<string, ActiveStream>();

function awaitStream(
  streamId: string,
  total: number,
  options?: {
    onProgress?: (received: number, total: number) => void;
    onChunk?: (chunk: string) => void;
  },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const fail = (message: string) => {
      const active = activeStreams.get(streamId);
      if (active) clearTimeout(active.idleTimer);
      activeStreams.delete(streamId);
      reject(new Error(message));
    };
    const stream: ActiveStream = {
      parts: [],
      received: 0,
      total,
      hash: 0x811c9dc5,
      onProgress: options?.onProgress,
      onChunk: options?.onChunk,
      resolve: (data) => {
        clearTimeout(stream.idleTimer);
        activeStreams.delete(streamId);
        resolve(data);
      },
      reject: (error) => {
        clearTimeout(stream.idleTimer);
        activeStreams.delete(streamId);
        reject(error);
      },
      idleTimer: setTimeout(
        () => fail("stream stopped — the app stopped responding"),
        STREAM_IDLE_TIMEOUT_MS,
      ),
    };
    activeStreams.set(streamId, stream);
  });
}

function handleStreamChunk(streamId: string, data: string): void {
  const stream = activeStreams.get(streamId);
  if (!stream) return;
  clearTimeout(stream.idleTimer);
  stream.idleTimer = setTimeout(
    () => stream.reject(new Error("stream stopped — the app stopped responding")),
    STREAM_IDLE_TIMEOUT_MS,
  );
  if (stream.onChunk) stream.onChunk(data);
  else stream.parts.push(data);
  stream.received += data.length;
  stream.hash = fnv1a32(data, stream.hash);
  stream.onProgress?.(stream.received, stream.total);
}

function handleStreamEnd(payload: {
  streamId: string;
  ok: boolean;
  checksum?: string | undefined;
  error?: string | undefined;
}): void {
  const stream = activeStreams.get(payload.streamId);
  if (!stream) return;
  clearTimeout(stream.idleTimer);
  if (!payload.ok) {
    stream.reject(new Error(payload.error ?? "stream failed on device"));
    return;
  }
  if (payload.checksum && payload.checksum !== stream.hash.toString(16)) {
    stream.reject(new Error("checksum mismatch — corrupted transfer"));
    return;
  }
  stream.resolve(stream.parts.join(""));
}

/** Cancela um stream: avisa o device (para de ler) e rejeita o lado local. */
export function cancelStream(streamId: string): void {
  void sendCommand({ type: "stream.cancel", payload: { streamId } }).catch(() => {});
  activeStreams.get(streamId)?.reject(new Error("cancelled"));
}

function sessionToken(): string | null {
  return new URLSearchParams(window.location.search).get("token");
}

function serviceUrl(): string {
  // Servido pela CLI: mesma origem. Em `vite dev` (porta 1420), aponta
  // para o serviço local default.
  const host = window.location.port === "1420" ? "127.0.0.1:4782" : window.location.host;
  return `ws://${host}`;
}

/** Recusado pelo serviço: não se reconecta mais nesta aba (ver "hello-reject"). */
let rejected = false;

/** O usuário escolheu um device no seletor — reconexões param de mover o foco. */
let manualFocus = false;

export function connect(): void {
  const token = sessionToken();
  const store = useStudio.getState();

  if (!token) {
    store.setPhase("no-token");
    return;
  }
  if (transport || rejected) return;

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
      failInFlight("connection to the app was lost");
      // setPhase é no-op depois de uma recusa (store.ts) — a tela de erro fica.
      useStudio.getState().setPhase("connecting");
    },
    onMessage(raw) {
      const parsed = parseMessage(raw);
      if (parsed.ok) handleMessage(parsed.message);
    },
  });
}

function failInFlight(message: string): void {
  for (const [requestId, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject(new Error(message));
    pending.delete(requestId);
  }
  for (const stream of [...activeStreams.values()]) {
    stream.reject(new Error(message));
  }
  for (const timer of tableRefreshTimers.values()) clearTimeout(timer);
  tableRefreshTimers.clear();
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
      // Estado TERMINAL, igual ao runtime (bootstrap.ts): o token do serviço é
      // fixo enquanto o processo vive, então retentar com o mesmo token nunca
      // pode dar certo. Sem fechar o transporte, esta aba reconectava a cada
      // 2,5–5s para sempre e enchia o terminal da CLI de rejeições anônimas.
      rejected = true;
      transport?.close();
      store.setRejected({
        code: message.error.code,
        message: message.error.message,
      });
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

const CONTINUITY_GRACE_MS = 5000;

/** Duração do realce de chegada — casa com a animação rnsi-flash do tema. */
const PROVIDER_FLASH_MS = 1000;

interface NavSnapshot {
  selection: Selection | null;
  selectedKey: string | null;
  selectedTable: string | null;
  keyFilter: string;
}

// Navegação salva quando o device em foco cai; restaurada se um device
// equivalente (mesmo name+platform) reconecta dentro da janela — cobre o
// full-reload sem persistir o deviceId (Fast Refresh nem chega a reconectar).
let dropped: {
  name: string;
  platform: string;
  at: number;
  nav: NavSnapshot;
} | null = null;

function snapshotNav(): NavSnapshot {
  const s = useStudio.getState();
  return {
    selection: s.selection,
    selectedKey: s.selectedKey,
    selectedTable: s.selectedTable,
    keyFilter: s.keyFilter,
  };
}

/** Se um device caiu há pouco e um equivalente está vivo agora, reata o foco
 * nele e restaura a navegação. Devolve true se reatou. */
function maybeContinue(): boolean {
  if (!dropped) return false;
  if (Date.now() - dropped.at > CONTINUITY_GRACE_MS) {
    dropped = null;
    return false;
  }
  const store = useStudio.getState();
  const match = store.devices.find(
    (d) => d.name === dropped!.name && d.platform === dropped!.platform,
  );
  if (!match) return false;
  const nav = dropped.nav;
  dropped = null;
  store.selectDevice(match.deviceId);
  void restoreAfterProviders(nav);
  return true;
}

async function restoreAfterProviders(nav: NavSnapshot): Promise<void> {
  await refreshProviders();
  if (!nav.selection) return;
  const store = useStudio.getState();
  const provider = store.providers.find((p) => p.providerId === nav.selection!.providerId);
  const instance = provider?.instances.find((i) => i.instanceId === nav.selection!.instanceId);
  if (!provider || !instance) return; // a instância sumiu no reload
  store.select(nav.selection);
  if (nav.keyFilter) store.setKeyFilter(nav.keyFilter);
  if (provider.capabilities.includes("database.query")) {
    await loadTables(nav.selection.providerId, nav.selection.instanceId);
    if (nav.selectedTable) store.selectTable(nav.selectedTable);
  } else {
    await loadKeys(nav.selection.providerId, nav.selection.instanceId);
    if (nav.selectedKey) store.selectKey(nav.selectedKey);
  }
}

function handleEvent(event: Extract<AnyMessage, { kind: "event" }>): void {
  const store = useStudio.getState();

  switch (event.type) {
    case "session.connected": {
      const device: Device = {
        deviceId: event.payload.deviceId ?? event.payload.sessionId,
        name: event.payload.client.name,
        platform: event.payload.client.platform,
        label: event.payload.label ?? event.payload.client.platform,
        storageReactQuerySync: event.payload.client.features?.storageReactQuerySync ?? null,
      };
      // Um contexto JS novo do MESMO app (reload do bundle, `r` no Metro) chega
      // com deviceId novo, e o socket anterior pode demorar até o heartbeat
      // para morrer. Nessa janela o foco ficava preso no device zumbi: o
      // refresh não rodava e os provider.registered do device vivo eram
      // filtrados por deviceId — a tela mostrava metade dos storages até o
      // usuário dar reload. Migrar o foco fecha a janela na hora. Só vale para
      // foco automático: se o usuário escolheu um device no seletor, a escolha
      // dele manda (dois emuladores da mesma plataforma são indistinguíveis
      // por (name, platform), e roubar o foco ali seria pior que a doença).
      const previous = store.devices.find((d) => d.deviceId === store.selectedDeviceId);
      const supersedesPrevious =
        !manualFocus &&
        previous !== undefined &&
        previous.deviceId !== device.deviceId &&
        previous.name === device.name &&
        previous.platform === device.platform;

      // Abre a janela de sincronização: o lote que chega agora é o inicial,
      // por mais eventos separados que ele use.
      store.beginProviderSync();
      store.upsertDevice(device);
      store.setPhase("connected");
      if (supersedesPrevious) {
        useStudio.getState().selectDevice(device.deviceId);
        useNetwork.getState().reset(); // contexto JS novo do app: captura recomeça
      }

      // Continuidade de reload primeiro; senão, se este é o foco, busca providers.
      if (!maybeContinue() && useStudio.getState().selectedDeviceId === device.deviceId) {
        // O serviço já manda o estado conhecido do device junto do evento: pinta
        // na hora, sem esperar round-trip. O refresh confirma logo atrás (e é o
        // caminho único quando o app conectou antes de anunciar qualquer coisa).
        if (event.payload.providers.length > 0) {
          store.setProviders(event.payload.providers);
        }
        void refreshProviders();
      }
      return;
    }

    case "session.disconnected": {
      const goneId = event.payload.deviceId ?? event.payload.sessionId;
      const wasSelected = store.selectedDeviceId === goneId;
      const gone = store.devices.find((d) => d.deviceId === goneId);
      if (wasSelected && gone) {
        dropped = {
          name: gone.name,
          platform: gone.platform,
          at: Date.now(),
          nav: snapshotNav(),
        };
      }
      // O device em foco morreu (reload do bundle, crash, cabo). Comando e
      // stream em voo não têm mais quem responda: o serviço já apagou as rotas
      // deste device (clearRoutesForDevice), então nada mais chega — sobrava só
      // esperar o timeout. Derrubar aqui troca 4s (comando) e 15s (stream) de
      // espera morta por um erro imediato e honesto: o stream expirava dizendo
      // "the app stopped responding", e o app não travou — ele reiniciou.
      // switchDevice já fazia exatamente isto; aqui era omissão.
      if (wasSelected) failInFlight("the app disconnected");
      store.removeDevice(goneId);
      const after = useStudio.getState();
      if (after.devices.length === 0) {
        store.setPhase("waiting-app");
      } else if (wasSelected && !maybeContinue() && after.selectedDeviceId) {
        void refreshProviders();
      }
      return;
    }

    case "provider.registered": {
      if (event.deviceId !== store.selectedDeviceId) return; // evento de outro device
      const { providerId } = event.payload.provider;
      store.upsertProvider(event.payload.provider);
      // O realce de chegada é transitório: passada a animação, o provider vira
      // um item comum. Sem isto a marca ficaria grudada e um remount da
      // sidebar piscaria um storage que chegou há dez minutos.
      setTimeout(() => useStudio.getState().clearArrivedLate(providerId), PROVIDER_FLASH_MS);
      return;
    }

    case "key-value.changed": {
      if (event.deviceId !== store.selectedDeviceId) return; // evento de outro device
      const provider = store.providers.find((p) => p.providerId === event.payload.providerId);
      store.applyChange({
        providerId: event.payload.providerId,
        providerLabel: provider?.label ?? event.payload.providerId,
        instanceId: event.payload.instanceId,
        key: event.payload.key,
        change: event.payload.change,
        source: event.payload.source,
        entry: event.payload.entry,
        timestamp: event.timestamp,
        ...(event.payload.coalescedCount !== undefined
          ? { coalescedCount: event.payload.coalescedCount }
          : {}),
      });
      return;
    }

    // Único par de eventos de device que não filtrava por origem. Hoje o
    // serviço já reescreve o id local para um id global (`gstream-N`, único no
    // processo) e entrega o chunk só ao Studio dono da rota — então isto é
    // defesa em profundidade, não correção de bug observável. Vale mesmo assim:
    // stream é o caminho de DADO, e costurar chunk de um device no buffer de
    // outro passaria pelo checksum quando ele viesse ausente.
    //
    // Diferente dos vizinhos, tolera deviceId ausente em vez de descartar: aqui
    // um falso negativo trunca um valor no meio, e a guarda é redundante.
    case "stream.chunk":
      if (event.deviceId !== undefined && event.deviceId !== store.selectedDeviceId) return;
      handleStreamChunk(event.payload.streamId, event.payload.data);
      return;

    case "stream.end":
      if (event.deviceId !== undefined && event.deviceId !== store.selectedDeviceId) return;
      handleStreamEnd(event.payload);
      return;

    case "database.changed": {
      if (event.deviceId !== store.selectedDeviceId) return; // evento de outro device
      const provider = store.providers.find((p) => p.providerId === event.payload.providerId);
      store.applyDatabaseChange({
        providerId: event.payload.providerId,
        providerLabel: provider?.label ?? event.payload.providerId,
        instanceId: event.payload.instanceId,
        table: event.payload.table,
        rowId: event.payload.rowId,
        operation: event.payload.operation,
        source: event.payload.source,
        timestamp: event.timestamp,
        ...(event.payload.coalescedCount !== undefined
          ? { coalescedCount: event.payload.coalescedCount }
          : {}),
      });
      scheduleTableRefresh(event.payload.providerId, event.payload.instanceId);
      return;
    }

    case "module.event": {
      if (event.deviceId !== store.selectedDeviceId) return; // evento de outro device
      // Envelope L3: cada módulo além de storage roteia por aqui. O storage
      // segue nos seus próprios cases acima — este é o canal genérico.
      if (event.payload.module === "network" && event.payload.event === "request") {
        useNetwork.getState().addRequest(event.payload.data);
      }
      return;
    }
  }
}

function sendCommand(
  partial: Pick<CommandMessage, "type" | "payload">,
  options?: { timeoutMs?: number },
): Promise<unknown> {
  if (!transport?.isConnected()) {
    return Promise.reject(new Error("the local service is not connected"));
  }
  const requestId = `req-${nextRequestId++}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("the app did not respond in time"));
      // Operações em lote levam legitimamente mais que os 4s do caso comum —
      // esvaziar uma tabela de milhões de linhas é rápido, mas não instantâneo.
    }, options?.timeoutMs ?? COMMAND_TIMEOUT_MS);
    pending.set(requestId, { resolve, reject, timer });
    // Roteamento stateless: todo comando carrega o device em foco. Capturado no
    // disparo (não na resolução) — trocar de device no meio não desvia o
    // comando já enviado, e o resultado atrasado é descartado no failInFlight.
    const deviceId = useStudio.getState().selectedDeviceId;
    send({
      kind: "command",
      protocolVersion: PROTOCOL_VERSION,
      requestId,
      ...(deviceId ? { deviceId } : {}),
      ...partial,
    } as CommandMessage);
  });
}

// ---------------------------------------------------------------- API da UI

/**
 * Envelope L3: envia um comando a um módulo (ex.: network) no runtime. Roteado
 * pelo bridge como qualquer command, resolvido pelo onModuleCommand do módulo.
 */
export async function sendModuleCommand(
  module: string,
  command: string,
  data?: unknown,
): Promise<unknown> {
  return sendCommand({
    type: "module.command",
    payload: { module, command, ...(data !== undefined ? { data } : {}) },
  });
}

/** Rede: busca o corpo ÍNTEGRO de uma request capturada (quando o preview veio
 * truncado). null quando o device já evictou a request do buffer. */
export async function getNetworkBody(
  id: string,
  side: "request" | "response",
): Promise<NetworkBody | null> {
  const result = await sendModuleCommand("network", "get-body", { id, side });
  const parsed = networkGetBodyResultSchema.safeParse(result);
  if (!parsed.success || !parsed.data.available) return null;
  return parsed.data.body;
}

/** Rede: reexecuta uma request no device. Devolve o id da nova request (ela
 * também é capturada e chega por module.event), ou null se falhou. */
export async function replayRequest(
  id: string,
  mode: "original" | "current-session",
  overrides?: {
    method?: string;
    url?: string;
    query?: string | null;
    headers?: Record<string, string>;
    removedHeaders?: string[];
    body?: string | null;
  },
): Promise<string | null> {
  const result = await sendModuleCommand("network", "replay", {
    id,
    mode,
    ...(overrides ? { overrides } : {}),
  });
  const parsed = networkReplayResultSchema.safeParse(result);
  return parsed.success ? parsed.data.id : null;
}

/**
 * "Abrir no Storage" (integração Network↔Storage): troca para o módulo de
 * storage e navega até a chave/tabela impactada, reusando o foco de atividade
 * (mesmo realce do feed do storage).
 */
export function openInStorage(item: {
  providerId: string;
  instanceId: string;
  providerLabel: string;
  target: { kind: "key-value"; key: string } | { kind: "database"; table: string; rowId: number | null };
}): void {
  const store = useStudio.getState();
  store.setActiveModule("storage");
  store.focusActivity({
    id: -1,
    timestamp: Date.now(),
    providerId: item.providerId,
    providerLabel: item.providerLabel,
    instanceId: item.instanceId,
    key: item.target.kind === "key-value" ? item.target.key : item.target.table,
    change: "updated",
    source: "app",
    preview: null,
    target: item.target,
  });
  if (item.target.kind === "database") void loadTables(item.providerId, item.instanceId);
  else void loadKeys(item.providerId, item.instanceId);
}

export async function refreshProviders(): Promise<void> {
  const result = await sendCommand({ type: "provider.list", payload: {} });
  const parsed = providerListResultSchema.safeParse(result);
  if (parsed.success) useStudio.getState().setProviders(parsed.data.providers);
}

/**
 * Troca manual de device pelo seletor. Cancela o in-flight (evita que um
 * resultado do device antigo caia na view do novo — o cache é single-device),
 * foca o novo e rebusca os providers dele.
 */
export function switchDevice(deviceId: string): void {
  const store = useStudio.getState();
  if (store.selectedDeviceId === deviceId) return;
  // A partir daqui o foco é decisão do usuário: nenhuma reconexão o move.
  manualFocus = true;
  failInFlight("device switched");
  store.beginProviderSync();
  store.selectDevice(deviceId);
  // Network é escopado ao device: a captura do device anterior não vale aqui.
  useNetwork.getState().reset();
  void refreshProviders();
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
    payload: {
      providerId,
      instanceId,
      afterKey: meta.nextAfterKey,
      limit: KEY_PAGE_LIMIT,
    },
  });
  const parsed = keyValueListResultSchema.safeParse(result);
  if (parsed.success) {
    useStudio.getState().setKeys(providerId, instanceId, parsed.data, "append");
  }
}

export interface ValuePreview {
  value: StorageValue | null;
  /** true quando o valor foi cortado no device — o completo vem via getFullValue. */
  truncated: boolean;
  totalSize: number;
}

export async function getValue(
  providerId: string,
  instanceId: string,
  key: string,
): Promise<ValuePreview> {
  const result = await sendCommand({
    type: "key-value.get",
    payload: { providerId, instanceId, key },
  });
  const parsed = keyValueGetResultSchema.safeParse(result);
  return parsed.success ? parsed.data : { value: null, truncated: false, totalSize: 0 };
}

function materializeValue(type: StorageValue["type"], data: string): StorageValue {
  switch (type) {
    case "number":
      return { type: "number", value: Number(data) };
    case "boolean":
      return { type: "boolean", value: data === "true" };
    case "null":
      return { type: "null", value: null };
    case "string":
    case "json":
    case "buffer":
      return { type, value: data };
  }
}

/**
 * Valor COMPLETO de uma chave, por streaming chunked — o caminho de
 * "100% dos dados" para valores grandes. Cancelável via AbortSignal.
 */
export async function getFullValue(
  providerId: string,
  instanceId: string,
  key: string,
  options?: {
    onProgress?: (received: number, total: number) => void;
    signal?: AbortSignal;
  },
): Promise<StorageValue | null> {
  const result = await sendCommand({
    type: "key-value.get-full",
    payload: { providerId, instanceId, key },
  });
  const parsed = keyValueGetFullResultSchema.safeParse(result);
  if (!parsed.success) throw new Error("invalid runtime response");
  if (parsed.data.streamId === null) return null;

  const streamId = parsed.data.streamId;
  const onAbort = () => cancelStream(streamId);
  if (options?.signal?.aborted) {
    cancelStream(streamId);
    throw new DOMException("Aborted", "AbortError");
  }
  options?.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const data = await awaitStream(streamId, parsed.data.totalSize, {
      ...(options?.onProgress ? { onProgress: options.onProgress } : {}),
    });
    return materializeValue(parsed.data.valueType, data);
  } finally {
    options?.signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * get + get-full transparente: devolve sempre o valor íntegro. Use em fluxos
 * que ESCREVEM a partir do valor lido (duplicar, restaurar) — nunca escreva
 * a partir de um preview truncado.
 */
export async function getValueComplete(
  providerId: string,
  instanceId: string,
  key: string,
): Promise<StorageValue | null> {
  const preview = await getValue(providerId, instanceId, key);
  if (!preview.truncated) return preview.value;
  return getFullValue(providerId, instanceId, key);
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
      payload: {
        providerId,
        instanceId,
        ...(afterKey ? { afterKey } : {}),
        limit: 500,
      },
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

/** Projeção enxuta de uma chave para a varredura da visão geral. */
export interface ScanEntry {
  key: string;
  valueType: string;
  /** Tamanho aproximado do valor em bytes (vem do device, sem ler o valor aqui). */
  approxSize: number;
}

export interface ScanPageMeta {
  /** Total de chaves na instância, anunciado pelo device. */
  total: number;
  /** Quantas chaves já foram varridas até aqui (acumulado). */
  scanned: number;
}

/** Página grande da varredura; o teto do protocolo é 500. */
const SCAN_PAGE_LIMIT = 500;
/** Trava de segurança contra um runtime que nunca devolva nextAfterKey=null. */
const SCAN_MAX_KEYS = 5_000_000;

/**
 * Varredura COMPLETA de metadado da instância key-value, para a visão geral.
 *
 * Difere do fetchAllKeys de propósito: (1) `lean` — o device omite o preview,
 * então cada página é só nome+tipo+tamanho; (2) NÃO acumula entries nem faz o
 * safeParse profundo por página (o resultado é `unknown` no protocolo, e uma
 * agregação read-only não corrompe nada com uma entry torta — só cai num balde
 * "?"); (3) entrega cada página por callback para o redutor consumir na hora,
 * sem nunca segurar 1M de objetos. O round-trip do WebSocket é o próprio yield
 * entre páginas — a main thread respira a cada resposta.
 *
 * Cancelável por AbortSignal: para de pedir páginas (a resposta em voo é
 * ignorada). Devolve `complete: false` quando cancelou ou bateu na trava.
 */
export async function scanAllKeys(
  providerId: string,
  instanceId: string,
  onPage: (entries: ScanEntry[], meta: ScanPageMeta) => void,
  options?: { signal?: AbortSignal },
): Promise<{ complete: boolean; scanned: number; total: number }> {
  let afterKey: string | undefined;
  let scanned = 0;
  let total = 0;
  for (;;) {
    if (options?.signal?.aborted) return { complete: false, scanned, total };
    const result = await sendCommand({
      type: "key-value.list",
      payload: {
        providerId,
        instanceId,
        ...(afterKey !== undefined ? { afterKey } : {}),
        limit: SCAN_PAGE_LIMIT,
        lean: true,
      },
    });
    if (options?.signal?.aborted) return { complete: false, scanned, total };

    // Guarda de shape leve — sem Zod profundo (é o que mantém a página barata).
    const r = result as {
      entries?: unknown;
      nextAfterKey?: unknown;
      total?: unknown;
    };
    const rawEntries = Array.isArray(r.entries) ? r.entries : [];
    const entries: ScanEntry[] = rawEntries.map((e) => {
      const o = e as {
        key?: unknown;
        valueType?: unknown;
        approxSize?: unknown;
      };
      return {
        key: typeof o.key === "string" ? o.key : String(o.key ?? ""),
        valueType: typeof o.valueType === "string" ? o.valueType : "string",
        approxSize:
          typeof o.approxSize === "number" && Number.isFinite(o.approxSize) ? o.approxSize : 0,
      };
    });
    total = typeof r.total === "number" ? r.total : total;
    scanned += entries.length;
    onPage(entries, { total, scanned });

    const nextAfterKey = typeof r.nextAfterKey === "string" ? r.nextAfterKey : null;
    if (nextAfterKey === null) return { complete: true, scanned, total };
    if (scanned >= SCAN_MAX_KEYS) return { complete: false, scanned, total };
    afterKey = nextAfterKey;
  }
}

/** Busca de chaves executada NO device — só matches viajam (plano §D). */
export async function searchKeys(
  providerId: string,
  instanceId: string,
  query: string,
  limit = 50,
): Promise<{ entries: KeyEntry[]; complete: boolean; scanned: number }> {
  const result = await sendCommand({
    type: "key-value.search",
    payload: { providerId, instanceId, query, limit },
  });
  const parsed = keyValueSearchResultSchema.safeParse(result);
  return parsed.success ? parsed.data : { entries: [], complete: false, scanned: 0 };
}

/** Busca LIKE nas tabelas SQLite, executada no device. */
export async function searchDatabase(
  providerId: string,
  instanceId: string,
  query: string,
  limit = 50,
): Promise<{
  matches: Array<{ table: string; ref: RowRef | null; snippet: string }>;
  complete: boolean;
}> {
  const result = await sendCommand({
    type: "database.search",
    payload: { providerId, instanceId, query, limit },
  });
  const parsed = databaseSearchResultSchema.safeParse(result);
  return parsed.success ? parsed.data : { matches: [], complete: false };
}

/**
 * Export integral NDJSON via stream: chunks vão direto ao sink (arquivo),
 * nunca acumulados na aba. GB fluem device → disco.
 */
export async function exportInstance(
  payload:
    | { kind: "key-value"; providerId: string; instanceId: string }
    | {
        kind: "database";
        providerId: string;
        instanceId: string;
        table: string;
      },
  sink: { write(chunk: string): void },
  onProgress?: (receivedChars: number) => void,
): Promise<void> {
  const result = await sendCommand(
    payload.kind === "key-value"
      ? {
          type: "key-value.export",
          payload: {
            providerId: payload.providerId,
            instanceId: payload.instanceId,
          },
        }
      : {
          type: "database.export",
          payload: {
            providerId: payload.providerId,
            instanceId: payload.instanceId,
            table: payload.table,
          },
        },
  );
  const parsed = exportResultSchema.safeParse(result);
  if (!parsed.success) throw new Error("invalid runtime response");
  await awaitStream(parsed.data.streamId, 0, {
    onChunk: (chunk) => sink.write(chunk),
    ...(onProgress ? { onProgress: (received) => onProgress(received) } : {}),
  });
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
  options: {
    limit: number;
    offset: number;
    /** Cursor keyset — página N custa o mesmo que a página 1 no device. */
    afterRowid?: number;
    orderBy?: string;
    direction?: "asc" | "desc";
  },
): Promise<{ rows: Row[]; total: number; totalIsEstimate?: boolean } | null> {
  const result = await sendCommand({
    type: "database.rows",
    payload: { providerId, instanceId, table, ...options },
  });
  const parsed = databaseRowsResultSchema.safeParse(result);
  return parsed.success ? parsed.data : null;
}

/** Conteúdo COMPLETO de uma célula (BLOB/texto grande) via stream. */
export async function getFullCell(
  providerId: string,
  instanceId: string,
  table: string,
  ref: RowRef,
  column: string,
  options?: {
    onProgress?: (received: number, total: number) => void;
    signal?: AbortSignal;
  },
): Promise<{ data: string; kind: "text" | "blob" | "number" } | null> {
  const result = await sendCommand({
    type: "database.cell",
    payload: { providerId, instanceId, table, ref, column },
  });
  const parsed = databaseCellResultSchema.safeParse(result);
  if (!parsed.success) throw new Error("invalid runtime response");
  if (parsed.data.streamId === null) return null;
  const streamId = parsed.data.streamId;
  const onAbort = () => cancelStream(streamId);
  if (options?.signal?.aborted) {
    cancelStream(streamId);
    throw new DOMException("Aborted", "AbortError");
  }
  options?.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const data = await awaitStream(streamId, parsed.data.totalSize, {
      ...(options?.onProgress ? { onProgress: options.onProgress } : {}),
    });
    return { data, kind: parsed.data.kind };
  } finally {
    options?.signal?.removeEventListener("abort", onAbort);
  }
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

/**
 * Exclusão em lote das linhas selecionadas: UM comando, transacionado no
 * device. Antes era um comando por linha — 20ms cada, com o timeout individual
 * de cada um e nenhum rollback se falhasse no meio.
 */
export async function deleteRows(
  providerId: string,
  instanceId: string,
  table: string,
  refs: RowRef[],
): Promise<{ rowsAffected: number }> {
  if (refs.length === 0) return { rowsAffected: 0 };
  const result = await sendCommand(
    {
      type: "database.deleteRows",
      payload: { providerId, instanceId, table, refs },
    },
    { timeoutMs: BULK_COMMAND_TIMEOUT_MS },
  );
  return result as { rowsAffected: number };
}

/**
 * Esvazia a tabela inteira com um único DELETE no device. Irreversível — não
 * existe snapshot de milhões de linhas para desfazer.
 */
export async function deleteAllRows(
  providerId: string,
  instanceId: string,
  table: string,
): Promise<{ rowsAffected: number }> {
  const result = await sendCommand(
    {
      type: "database.deleteAll",
      payload: { providerId, instanceId, table },
    },
    { timeoutMs: BULK_COMMAND_TIMEOUT_MS },
  );
  return result as { rowsAffected: number };
}

export async function executeSql(
  providerId: string,
  instanceId: string,
  sql: string,
): Promise<ExecuteResult> {
  // SQL arbitrário do usuário: um DELETE ou um scan grande passa dos 4s comuns.
  const result = await sendCommand(
    {
      type: "database.execute",
      payload: { providerId, instanceId, sql },
    },
    { timeoutMs: BULK_COMMAND_TIMEOUT_MS },
  );
  const parsed = databaseExecuteResultSchema.safeParse(result);
  if (!parsed.success) throw new Error("invalid runtime response");
  return parsed.data.result;
}
