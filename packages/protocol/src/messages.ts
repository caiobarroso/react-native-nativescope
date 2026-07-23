import { z } from "zod";
import { PROTOCOL_VERSION } from "./version.ts";
import { keyEntrySchema, storageValueSchema } from "./values.ts";
import { providerDescriptorSchema } from "./providers.ts";
import { protocolErrorSchema } from "./errors.ts";
import { cellValueSchema, rowRefSchema } from "./database.ts";

/** Origem de uma mudança. Distinguir "eu fiz" de "o app fez" é requisito de UI. */
export const changeSourceSchema = z.enum(["app", "studio"]);
export type ChangeSource = z.infer<typeof changeSourceSchema>;

// ---------------------------------------------------------------------------
// Handshake
// ---------------------------------------------------------------------------

const clientRoleSchema = z.enum(["runtime", "studio"]);
export type ClientRole = z.infer<typeof clientRoleSchema>;

const clientInfoSchema = z.object({
  name: z.string(),
  platform: z.string(),
  /** Id estável por-device (o shim gera; o roteamento multi-device usa como
   * chave). Opcional: shim antigo não manda e o servidor sintetiza um. */
  deviceId: z.string().optional(),
  /** Rótulo legível pro seletor (ex. "iOS", "Android"). */
  label: z.string().optional(),
  /** Sinais de configuração instalados no app. O Studio usa isso para explicar
   * o que está ativo sem confundir conexão com atualização da interface. */
  features: z
    .object({
      storageReactQuerySync: z.boolean().optional(),
    })
    .optional(),
});

export const helloMessageSchema = z.object({
  kind: z.literal("hello"),
  protocolVersion: z.number().int().positive(),
  role: clientRoleSchema,
  /** Token gerado pela CLI. Sem ele, a conexão é recusada no handshake. */
  sessionToken: z.string().min(1),
  client: clientInfoSchema,
});

export const helloAckMessageSchema = z.object({
  kind: z.literal("hello-ack"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  sessionId: z.string(),
});

export const helloRejectMessageSchema = z.object({
  kind: z.literal("hello-reject"),
  error: protocolErrorSchema,
});

// ---------------------------------------------------------------------------
// Commands (Studio → runtime): intenções
// ---------------------------------------------------------------------------

const commandBase = {
  kind: z.literal("command"),
  protocolVersion: z.number().int().positive(),
  requestId: z.string().min(1),
  /** Device-alvo do comando (roteamento stateless no bridge). Opcional: sem
   * ele o bridge não tem pra quem rotear e descarta — o Studio sempre manda. */
  deviceId: z.string().optional(),
} as const;

const kvTarget = {
  providerId: z.string(),
  instanceId: z.string(),
} as const;

export const commandMessageSchema = z.discriminatedUnion("type", [
  z.object({
    ...commandBase,
    type: z.literal("provider.list"),
    payload: z.object({}),
  }),
  z.object({
    ...commandBase,
    type: z.literal("key-value.list"),
    // Paginação por cursor lexicográfico: o custo de uma página é O(página),
    // nunca O(dataset) — regra central do suporte a grandes volumes.
    payload: z.object({
      ...kvTarget,
      afterKey: z.string().optional(),
      limit: z.number().int().positive().max(500).optional(),
      // Modo enxuto (varredura/visão geral): o runtime omite o conteúdo do
      // preview (preview: ""). approxSize e valueType ainda vêm — só o texto
      // do preview, que uma agregação por tamanho descarta, deixa de trafegar.
      // Retrocompatível: runtime antigo ignora e manda o preview normalmente.
      lean: z.boolean().optional(),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("key-value.get"),
    payload: z.object({ ...kvTarget, key: z.string() }),
  }),
  // Valor completo de uma chave, entregue via stream.* em chunks — é o
  // caminho de "100% dos dados acessíveis" para valores grandes.
  z.object({
    ...commandBase,
    type: z.literal("key-value.get-full"),
    payload: z.object({ ...kvTarget, key: z.string() }),
  }),
  // Cancela um stream em andamento (usuário fechou o viewer, por exemplo).
  z.object({
    ...commandBase,
    type: z.literal("stream.cancel"),
    payload: z.object({ streamId: z.string() }),
  }),
  // Busca executada NO DEVICE (plano de grandes volumes §D): buscar em GB
  // sem transferir GB — só os matches viajam.
  z.object({
    ...commandBase,
    type: z.literal("key-value.search"),
    payload: z.object({
      ...kvTarget,
      query: z.string().min(1),
      limit: z.number().int().positive().max(200).optional(),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("database.search"),
    payload: z.object({
      ...kvTarget,
      query: z.string().min(1),
      limit: z.number().int().positive().max(200).optional(),
    }),
  }),
  // Export integral via stream: é o cumprimento literal de "100% dos dados"
  // — NDJSON flui device → arquivo sem nunca residir inteiro em memória.
  z.object({
    ...commandBase,
    type: z.literal("key-value.export"),
    payload: z.object({ ...kvTarget }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("database.export"),
    payload: z.object({ ...kvTarget, table: z.string() }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("key-value.set"),
    payload: z.object({
      ...kvTarget,
      key: z.string(),
      value: storageValueSchema,
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("key-value.remove"),
    payload: z.object({ ...kvTarget, key: z.string() }),
  }),
  // ------------------------------------------------------------- database.*
  z.object({
    ...commandBase,
    type: z.literal("database.tables"),
    payload: z.object({ ...kvTarget }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("database.rows"),
    payload: z.object({
      ...kvTarget,
      table: z.string(),
      limit: z.number().int().positive().max(500),
      offset: z.number().int().nonnegative(),
      /**
       * Cursor keyset (tabelas rowid, sem orderBy): página N custa o mesmo
       * que a página 1 — OFFSET degrada linearmente, rowid > ? não.
       * Quando presente, offset é ignorado.
       */
      afterRowid: z.number().int().optional(),
      orderBy: z.string().optional(),
      direction: z.enum(["asc", "desc"]).optional(),
    }),
  }),
  // Célula completa via stream — BLOBs/textos grandes nunca passam pelo rows.
  z.object({
    ...commandBase,
    type: z.literal("database.cell"),
    payload: z.object({
      ...kvTarget,
      table: z.string(),
      ref: rowRefSchema,
      column: z.string(),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("database.update"),
    payload: z.object({
      ...kvTarget,
      table: z.string(),
      ref: rowRefSchema,
      set: z.record(cellValueSchema),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("database.insert"),
    payload: z.object({
      ...kvTarget,
      table: z.string(),
      values: z.record(cellValueSchema),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("database.delete"),
    payload: z.object({
      ...kvTarget,
      table: z.string(),
      ref: rowRefSchema,
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("database.execute"),
    payload: z.object({ ...kvTarget, sql: z.string() }),
  }),
]);

export type CommandMessage = z.infer<typeof commandMessageSchema>;
export type CommandType = CommandMessage["type"];

// ---------------------------------------------------------------------------
// Command results (runtime → Studio)
// A UI não confirma uma alteração antes do resultado chegar.
// ---------------------------------------------------------------------------

export const commandResultMessageSchema = z.discriminatedUnion("ok", [
  z.object({
    kind: z.literal("command-result"),
    requestId: z.string(),
    ok: z.literal(true),
    result: z.unknown(),
  }),
  z.object({
    kind: z.literal("command-result"),
    requestId: z.string(),
    ok: z.literal(false),
    error: protocolErrorSchema,
  }),
]);

export type CommandResultMessage = z.infer<typeof commandResultMessageSchema>;

/** Resultados tipados por command, validados no consumidor. */
export const providerListResultSchema = z.object({
  providers: z.array(providerDescriptorSchema),
});
export const keyValueListResultSchema = z.object({
  entries: z.array(keyEntrySchema),
  /** Cursor da próxima página; null quando esta é a última. */
  nextAfterKey: z.string().nullable(),
  /** Total de chaves na instância (contagem barata: só nomes, sem valores). */
  total: z.number().int().nonnegative(),
});
export const keyValueGetResultSchema = z.object({
  value: storageValueSchema.nullable(),
  /** true quando o valor foi cortado no limite de preview — o completo vem via get-full. */
  truncated: z.boolean(),
  /** Tamanho real do valor serializado (chars), truncado ou não. */
  totalSize: z.number().int().nonnegative(),
});
export const keyValueSearchResultSchema = z.object({
  entries: z.array(keyEntrySchema),
  /** false quando a busca parou no limite antes de varrer tudo. */
  complete: z.boolean(),
  /** Quantas chaves foram varridas no device. */
  scanned: z.number().int().nonnegative(),
});
export const databaseSearchResultSchema = z.object({
  matches: z.array(
    z.object({
      table: z.string(),
      ref: rowRefSchema.nullable(),
      snippet: z.string(),
    }),
  ),
  complete: z.boolean(),
});
export const exportResultSchema = z.object({
  /** Os dados chegam como stream.* NDJSON; tamanho total desconhecido a priori. */
  streamId: z.string(),
});
export const keyValueGetFullResultSchema = z.object({
  /** null quando a chave não existe. Os chunks chegam como events stream.*. */
  streamId: z.string().nullable(),
  valueType: z.enum(["string", "number", "boolean", "json", "buffer", "null"]),
  totalSize: z.number().int().nonnegative(),
});

// ---------------------------------------------------------------------------
// Events (runtime/serviço → Studio): fatos que já aconteceram
// ---------------------------------------------------------------------------

const eventBase = {
  kind: z.literal("event"),
  protocolVersion: z.number().int().positive(),
  timestamp: z.number(),
  /** Device de origem, carimbado pelo bridge no relay. Deixa o Studio filtrar
   * eventos do device selecionado. Opcional (eventos internos podem não ter). */
  deviceId: z.string().optional(),
} as const;

export const eventMessageSchema = z.discriminatedUnion("type", [
  z.object({
    ...eventBase,
    type: z.literal("key-value.changed"),
    payload: z.object({
      providerId: z.string(),
      instanceId: z.string(),
      key: z.string(),
      change: z.enum(["created", "updated", "removed"]),
      source: changeSourceSchema,
      entry: keyEntrySchema.nullable(),
      /** >1 quando o runtime fundiu uma rajada: este evento representa N
       * mudanças na chave dentro da janela de coalescing (ADR-0001). */
      coalescedCount: z.number().int().positive().optional(),
    }),
  }),
  z.object({
    ...eventBase,
    type: z.literal("provider.registered"),
    payload: z.object({ provider: providerDescriptorSchema }),
  }),
  z.object({
    ...eventBase,
    type: z.literal("database.changed"),
    payload: z.object({
      providerId: z.string(),
      instanceId: z.string(),
      table: z.string(),
      /** rowid quando o hook nativo entrega; null em DELETE ou sem rowid. */
      rowId: z.number().nullable(),
      /** O hook do expo-sqlite não entrega a operação — "unknown" é honesto. */
      operation: z.enum(["insert", "update", "delete", "unknown"]),
      source: changeSourceSchema,
      /** >1 quando o runtime fundiu uma rajada de mudanças na tabela. */
      coalescedCount: z.number().int().positive().optional(),
    }),
  }),
  // Streaming chunked (plano de grandes volumes §B): valores grandes nunca
  // viajam numa mensagem só. Ordem garantida pelo WS; seq é cinto extra.
  z.object({
    ...eventBase,
    type: z.literal("stream.chunk"),
    payload: z.object({
      streamId: z.string(),
      seq: z.number().int().nonnegative(),
      data: z.string(),
    }),
  }),
  z.object({
    ...eventBase,
    type: z.literal("stream.end"),
    payload: z.object({
      streamId: z.string(),
      ok: z.boolean(),
      chunkCount: z.number().int().nonnegative(),
      /** FNV-1a 32-bit (hex) do conteúdo — integridade, não criptografia. */
      checksum: z.string().optional(),
      error: z.string().optional(),
    }),
  }),
  // Emitidos pelo serviço local, não pelo runtime:
  z.object({
    ...eventBase,
    type: z.literal("session.connected"),
    payload: z.object({
      sessionId: z.string(),
      client: clientInfoSchema,
      providers: z.array(providerDescriptorSchema),
      /** Id e rótulo do device — no payload (não em client) porque o Zod
       * descarta chaves desconhecidas; o Studio lê daqui. */
      deviceId: z.string().optional(),
      label: z.string().optional(),
    }),
  }),
  z.object({
    ...eventBase,
    type: z.literal("session.disconnected"),
    payload: z.object({
      sessionId: z.string(),
      deviceId: z.string().optional(),
    }),
  }),
]);

export type EventMessage = z.infer<typeof eventMessageSchema>;
export type EventType = EventMessage["type"];

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export const anyMessageSchema = z.union([
  helloMessageSchema,
  helloAckMessageSchema,
  helloRejectMessageSchema,
  commandMessageSchema,
  commandResultMessageSchema,
  eventMessageSchema,
]);

export type AnyMessage = z.infer<typeof anyMessageSchema>;
export type HelloMessage = z.infer<typeof helloMessageSchema>;
export type HelloAckMessage = z.infer<typeof helloAckMessageSchema>;
export type HelloRejectMessage = z.infer<typeof helloRejectMessageSchema>;

/**
 * Parse seguro de mensagem vinda do fio. Toda mensagem externa passa por
 * aqui — nunca por JSON.parse solto.
 */
export function parseMessage(
  raw: string,
): { ok: true; message: AnyMessage } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: "not valid JSON" };
  }
  const parsed = anyMessageSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message };
  }
  return { ok: true, message: parsed.data };
}

export function serializeMessage(message: AnyMessage): string {
  return JSON.stringify(message);
}
