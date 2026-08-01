import { z } from "zod";

/**
 * Contrato de payload do módulo de Logs.
 *
 * Aditivo por design, como o de network: NÃO toca as uniões de storage. O
 * envelope L3 (`module.event`) carrega `data: unknown` — o módulo é dono do seu
 * contrato, e este arquivo é a fonte única dele, validada nas DUAS pontas.
 *
 * Diferença central em relação ao network: a unidade de fio aqui é o **lote**,
 * não a entrada avulsa. Uma request é evento raro; log é rajada — um loop de
 * render cospe milhares de linhas por segundo. Um frame por linha derrubaria o
 * app do usuário, que é exatamente o que o inspector não pode fazer.
 */

/** Nome do módulo no envelope L3. Usado como discriminador em module.event. */
export const LOGS_MODULE = "logs";

/** Níveis capturados. Espelha os métodos de `console` que instrumentamos. */
export const logLevelSchema = z.enum(["debug", "log", "info", "warn", "error"]);
export type LogLevel = z.infer<typeof logLevelSchema>;

/**
 * Um argumento de `console.*` já serializado no device.
 *
 * `json` vem como STRING JSON pronta (e válida) de propósito: é exatamente o
 * que o `JsonWorkspace` do Studio consome (`draft: string`), então o viewer
 * funciona sem nenhuma conversão no desktop.
 */
export const logArgSchema = z.object({
  /**
   *  - text: primitivo/string, renderiza inline (json = null);
   *  - json: objeto/array inspecionável no viewer;
   *  - error: Error com stack;
   *  - unserializable: função/symbol/bigint/valor que não sobreviveu (json = null).
   */
  kind: z.enum(["text", "json", "error", "unserializable"]),
  /** Rótulo de uma linha para a lista. Sempre presente, sempre capado. */
  preview: z.string(),
  /** JSON válido e capado para o viewer; null quando não há o que inspecionar. */
  json: z.string().nullable(),
  /** true quando algo foi cortado (profundidade, chaves, itens ou tamanho). */
  truncated: z.boolean(),
});

export type LogArg = z.infer<typeof logArgSchema>;

/**
 * Uma linha de log capturada. `namespace` vem derivado do device (mesma
 * doutrina de `origin`/`path` no network): o desktop filtra milhares de linhas
 * no caminho quente e não pode reparsear mensagem a cada render.
 */
export const logEntrySchema = z.object({
  /** Id estável por-entrada, gerado no device. Chave de de-dup no desktop. */
  id: z.string().min(1),
  /**
   * Contador monotônico por launch do app. Ordena com precisão mesmo quando
   * várias entradas caem no mesmo milissegundo — `ts` sozinho empata.
   */
  seq: z.number().int().nonnegative(),
  /** epoch ms da captura (relógio do device). */
  ts: z.number(),
  level: logLevelSchema,
  /**
   * De onde veio: chamada de `console.*`, exceção global não capturada
   * (ErrorUtils) ou rejeição de promise não tratada.
   */
  source: z.enum(["console", "exception", "rejection"]),
  /** Linha renderizada na lista: previews dos args juntos, capada. */
  message: z.string(),
  /** Derivado de prefixo `[foo]` / `foo:` na mensagem; null quando não há. */
  namespace: z.string().nullable(),
  args: z.array(logArgSchema),
  /** Stack de error/exception; null no resto. */
  stack: z.string().nullable(),
  /** ≥1. Acima de 1 = a mesma linha repetida foi fundida (o "×N" da lista). */
  repeat: z.number().int().positive(),
  /** true quando algum arg foi cortado. */
  truncated: z.boolean(),
});

export type LogEntry = z.infer<typeof logEntrySchema>;

/** Nomes de eventos do módulo (campo `event` do module.event). */
export const LOGS_EVENT = {
  /** Um lote de entradas. data = LogBatch. */
  batch: "batch",
} as const;

/**
 * O lote que trafega. `dropped` é a contagem HONESTA do que o backpressure
 * descartou desde o lote anterior — a timeline nunca mente sobre volume, mesma
 * regra do `coalescedCount` do storage.
 */
export const logBatchSchema = z.object({
  entries: z.array(logEntrySchema),
  dropped: z.number().int().nonnegative(),
});

export type LogBatch = z.infer<typeof logBatchSchema>;
