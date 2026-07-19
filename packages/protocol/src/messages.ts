import { z } from "zod";
import { PROTOCOL_VERSION } from "./version.ts";
import { keyEntrySchema, storageValueSchema } from "./values.ts";
import { providerDescriptorSchema } from "./providers.ts";
import { protocolErrorSchema } from "./errors.ts";

/** Origem de uma mudança. Distinguir "eu fiz" de "o app fez" é requisito de UI. */
export const changeSourceSchema = z.enum(["app", "studio"]);
export type ChangeSource = z.infer<typeof changeSourceSchema>;

// ---------------------------------------------------------------------------
// Handshake
// ---------------------------------------------------------------------------

const clientRoleSchema = z.enum(["runtime", "studio"]);
export type ClientRole = z.infer<typeof clientRoleSchema>;

export const helloMessageSchema = z.object({
  kind: z.literal("hello"),
  protocolVersion: z.number().int().positive(),
  role: clientRoleSchema,
  /** Token gerado pela CLI. Sem ele, a conexão é recusada no handshake. */
  sessionToken: z.string().min(1),
  client: z.object({
    name: z.string(),
    platform: z.string(),
  }),
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
    payload: z.object({ ...kvTarget }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("key-value.get"),
    payload: z.object({ ...kvTarget, key: z.string() }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("key-value.set"),
    payload: z.object({ ...kvTarget, key: z.string(), value: storageValueSchema }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("key-value.remove"),
    payload: z.object({ ...kvTarget, key: z.string() }),
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
});
export const keyValueGetResultSchema = z.object({
  value: storageValueSchema.nullable(),
});

// ---------------------------------------------------------------------------
// Events (runtime/serviço → Studio): fatos que já aconteceram
// ---------------------------------------------------------------------------

const eventBase = {
  kind: z.literal("event"),
  protocolVersion: z.number().int().positive(),
  timestamp: z.number(),
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
    }),
  }),
  z.object({
    ...eventBase,
    type: z.literal("provider.registered"),
    payload: z.object({ provider: providerDescriptorSchema }),
  }),
  // Emitidos pelo serviço local, não pelo runtime:
  z.object({
    ...eventBase,
    type: z.literal("session.connected"),
    payload: z.object({
      sessionId: z.string(),
      client: z.object({ name: z.string(), platform: z.string() }),
      providers: z.array(providerDescriptorSchema),
    }),
  }),
  z.object({
    ...eventBase,
    type: z.literal("session.disconnected"),
    payload: z.object({ sessionId: z.string() }),
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
export function parseMessage(raw: string):
  | { ok: true; message: AnyMessage }
  | { ok: false; error: string } {
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
