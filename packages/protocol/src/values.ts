import { z } from "zod";

/**
 * Formato de fio para valores de storage.
 *
 * O tipo é sempre explícito porque nem todo provider tem introspecção de
 * tipo (MMKV não distingue `123` de `"123"`). A UI expõe esse tipo num
 * seletor visível — editar nunca muda o tipo silenciosamente.
 */
export const storageValueSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("string"), value: z.string() }),
  z.object({ type: z.literal("number"), value: z.number() }),
  z.object({ type: z.literal("boolean"), value: z.boolean() }),
  // JSON trafega serializado para não perder fidelidade (undefined, ordem
  // de chaves em diff, números fora do range seguro etc. são problema do
  // consumidor, não do fio).
  z.object({ type: z.literal("json"), value: z.string() }),
  // Buffers trafegam em base64. Read-only no MVP.
  z.object({ type: z.literal("buffer"), value: z.string() }),
  z.object({ type: z.literal("null"), value: z.null() }),
]);

export type StorageValue = z.infer<typeof storageValueSchema>;

/** Entrada da listagem de chaves — o valor completo só vai sob demanda. */
export const keyEntrySchema = z.object({
  key: z.string(),
  valueType: z.enum(["string", "number", "boolean", "json", "buffer", "null"]),
  /** Tamanho aproximado do valor serializado, em bytes. */
  approxSize: z.number().int().nonnegative(),
  /** Preview truncado para a lista. O valor completo vem via key-value.get. */
  preview: z.string(),
});

export type KeyEntry = z.infer<typeof keyEntrySchema>;
