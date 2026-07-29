import { z } from "zod";

/**
 * Contrato de payload do módulo de Network.
 *
 * Aditivo por design: NÃO toca as uniões de storage (`key-value.*`,
 * `database.*`). O envelope L3 (`module.event`/`module.command`) carrega
 * `data: unknown` — o módulo é dono do seu contrato, e este arquivo é a fonte
 * única desse contrato, validada nas DUAS pontas (runtime emite, desktop lê).
 *
 * Fica no `@rnsi/protocol` (e não dentro do runtime) justamente para o desktop
 * poder importar os mesmos schemas sem duplicar shape.
 */

/** Nome do módulo no envelope L3. Usado como discriminador em module.event/command. */
export const NETWORK_MODULE = "network";

/**
 * Corpo de request/response. `text` é um PREVIEW capado no device (o evento
 * inteiro tem que caber no orçamento de fio). `truncated` avisa que `text` é um
 * prefixo — o corpo íntegro vem sob demanda por `network.get-body`.
 */
export const networkBodySchema = z.object({
  /** Preview textual (capado). Vazio quando binário/indisponível. */
  text: z.string(),
  /** Tamanho real do corpo em bytes (mesmo quando o preview foi cortado). */
  size: z.number().int().nonnegative(),
  /** true quando `text` é um prefixo do corpo real. */
  truncated: z.boolean(),
  /** Content-Type declarado, quando conhecido. */
  contentType: z.string().nullable().optional(),
  /** Rótulo do tipo bruto quando não-textual (ex.: "FormData", "Blob"). */
  kind: z.enum(["text", "json", "binary", "form", "unknown"]).optional(),
});

export type NetworkBody = z.infer<typeof networkBodySchema>;

/**
 * Uma request HTTP capturada — o fato central do módulo. O runtime já entrega
 * `origin`/`path`/`query` derivados da url para o desktop não reparsear no
 * caminho quente (agrupamento/filtro de milhares de linhas).
 */
export const networkRequestSchema = z.object({
  /** Id estável por-request, gerado no device. Chave de upsert no desktop. */
  id: z.string().min(1),
  method: z.string().min(1),
  url: z.string(),
  /** scheme://host[:port] — base do agrupamento. */
  origin: z.string(),
  /** pathname sem query. */
  path: z.string(),
  /** query string crua (sem `?`); null quando não há. */
  query: z.string().nullable(),
  /** status HTTP; null se falhou/abortou antes da resposta. */
  status: z.number().int().nullable(),
  statusText: z.string().nullable().optional(),
  /** status em 200–299. */
  ok: z.boolean(),
  /** mensagem de erro de rede/abort; null em sucesso. */
  error: z.string().nullable(),
  /** epoch ms do send(). */
  startedAt: z.number(),
  /** epoch ms do fim (load/error/abort/timeout). */
  endedAt: z.number(),
  /** ms decorridos. */
  duration: z.number().nonnegative(),
  requestSize: z.number().int().nonnegative(),
  responseSize: z.number().int().nonnegative(),
  requestHeaders: z.record(z.string(), z.string()),
  responseHeaders: z.record(z.string(), z.string()),
  requestBody: networkBodySchema.nullable(),
  responseBody: networkBodySchema.nullable(),
  /** id da request original quando esta é um replay; ausente no tráfego normal. */
  replayOf: z.string().nullable().optional(),
});

export type NetworkRequest = z.infer<typeof networkRequestSchema>;

/** Nomes de eventos do módulo (campo `event` do module.event). */
export const NETWORK_EVENT = {
  /** Uma request finalizou (sucesso ou falha). data = NetworkRequest. */
  request: "request",
} as const;

/** Nomes de comandos do módulo (campo `command` do module.command). */
export const NETWORK_COMMAND = {
  /** Pede o corpo íntegro de uma request capturada. */
  getBody: "get-body",
  /** Reexecuta uma request. */
  replay: "replay",
} as const;

/** Payload de `network.get-body`. */
export const networkGetBodyCommandSchema = z.object({
  id: z.string().min(1),
  side: z.enum(["request", "response"]),
});
export type NetworkGetBodyCommand = z.infer<typeof networkGetBodyCommandSchema>;

export const networkGetBodyResultSchema = z.object({
  /** false quando a request foi evictada do buffer do device. */
  available: z.boolean(),
  body: networkBodySchema.nullable(),
});
export type NetworkGetBodyResult = z.infer<typeof networkGetBodyResultSchema>;

/**
 * Payload de `network.replay`.
 *  - original: reexecuta com headers/body/url capturados + overrides.
 *  - current-session: idem, mas Authorization/Cookie vêm da request mais recente
 *    ao mesmo origin (sessão fresca); cookies já vêm atuais pelo jar do XHR.
 */
export const networkReplayCommandSchema = z.object({
  id: z.string().min(1),
  mode: z.enum(["original", "current-session"]),
  overrides: z
    .object({
      method: z.string().optional(),
      url: z.string().optional(),
      query: z.string().nullable().optional(),
      headers: z.record(z.string(), z.string()).optional(),
      removedHeaders: z.array(z.string().min(1)).optional(),
      body: z.string().nullable().optional(),
    })
    .optional(),
});
export type NetworkReplayCommand = z.infer<typeof networkReplayCommandSchema>;

export const networkReplayResultSchema = z.object({
  /** id da nova request gerada pelo replay (ela também é capturada e emitida). */
  id: z.string().nullable(),
});
export type NetworkReplayResult = z.infer<typeof networkReplayResultSchema>;
