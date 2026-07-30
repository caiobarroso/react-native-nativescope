import { z } from "zod";

/**
 * Contratos de banco (SQLite). Capability database.* — separada de
 * key-value de propósito: interfaces pequenas por capability (plano §13.3).
 */

/**
 * Valor de célula no fio. BLOBs trafegam em base64 e são READ-ONLY — quem
 * escreve precisa recusar um objeto (ver toParam no adapter) e a UI não pode
 * abrir edição inline em cima deles.
 *
 * `byteLength` é o tamanho REAL do BLOB, não o do `blobBase64`: na listagem o
 * base64 vem cortado no preview. Opcional porque um runtime anterior a este
 * campo continua válido no fio (aditivo, PROTOCOL_VERSION intacto).
 */
export const cellValueSchema = z.union([
  z.string(),
  z.number(),
  z.null(),
  z.object({
    blobBase64: z.string(),
    byteLength: z.number().int().nonnegative().optional(),
  }),
]);
export type CellValue = z.infer<typeof cellValueSchema>;

export const columnSchema = z.object({
  name: z.string(),
  /** Tipo declarado no schema (TEXT, INTEGER, …) — informativo. */
  declaredType: z.string(),
  notNull: z.boolean(),
  /** Posição na PK (0 = não faz parte). */
  pkIndex: z.number().int().nonnegative(),
});

export const tableSchema = z.object({
  name: z.string(),
  columns: z.array(columnSchema),
  rowCount: z.number().int().nonnegative(),
  /** true quando rowCount é estimativa rápida (MAX(rowid)); o exato chega no refresh seguinte. */
  rowCountIsEstimate: z.boolean().optional(),
  /**
   * Identidade estável para edição: rowid, PK declarada, ou nenhuma.
   * Sem identidade → a UI trata como somente leitura e diz o porquê.
   */
  identity: z.enum(["rowid", "pk", "none"]),
});
export type TableSchema = z.infer<typeof tableSchema>;

/** Referência estável de uma linha para update/delete. */
export const rowRefSchema = z.union([
  z.object({ rowid: z.number() }),
  z.object({ pk: z.record(cellValueSchema) }),
]);
export type RowRef = z.infer<typeof rowRefSchema>;

export const rowSchema = z.object({
  /** null quando a tabela não tem identidade estável. */
  ref: rowRefSchema.nullable(),
  cells: z.record(cellValueSchema),
  /** Colunas cujo valor foi cortado no limite de preview de célula —
   * o conteúdo completo vem via database.cell (streaming). */
  truncatedColumns: z.array(z.string()).optional(),
});
export type Row = z.infer<typeof rowSchema>;

export const executeResultSchema = z.union([
  z.object({ kind: z.literal("rows"), columns: z.array(z.string()), rows: z.array(z.record(cellValueSchema)) }),
  z.object({ kind: z.literal("mutation"), rowsAffected: z.number() }),
]);
export type ExecuteResult = z.infer<typeof executeResultSchema>;

// Resultados tipados dos commands:
export const databaseTablesResultSchema = z.object({ tables: z.array(tableSchema) });
export const databaseRowsResultSchema = z.object({
  rows: z.array(rowSchema),
  total: z.number().int().nonnegative(),
  /** true quando total é estimativa (o COUNT exato roda em background). */
  totalIsEstimate: z.boolean().optional(),
});
export const databaseExecuteResultSchema = z.object({ result: executeResultSchema });
export const databaseCellResultSchema = z.object({
  /** null quando a célula é NULL/inexistente. Chunks chegam via stream.*. */
  streamId: z.string().nullable(),
  kind: z.enum(["text", "blob", "number"]),
  totalSize: z.number().int().nonnegative(),
});
