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
  /**
   * Ausente ⇒ "table" (runtime anterior a este campo). VIEW entra no mesmo
   * contrato: o que muda não é como se lê, é o que se pode escrever.
   *
   * Ortogonal a `identity` de propósito. `identity` responde "como endereço
   * uma linha"; uma view gravável genuinamente É `pk`. Fundir os dois faria
   * todo consumidor tratar um valor que não carrega informação de endereço.
   */
  kind: z.enum(["table", "view"]).optional(),
  /**
   * Por operação, não booleano: o SQLite recusa DML numa view que não tenha o
   * trigger INSTEAD OF correspondente, e uma view pode ter só o de INSERT. Um
   * booleano faria a UI oferecer edição que sempre falha.
   *
   * Ausente ⇒ tabela física, tudo permitido (sujeito a `identity`).
   */
  writable: z
    .object({ insert: z.boolean(), update: z.boolean(), delete: z.boolean() })
    .optional(),
  /** Objetos que esta view lê, transitivamente. Alimenta atribuição de mudança. */
  dependsOn: z.array(z.string()).optional(),
  /**
   * View cuja base sumiu (comum no meio de uma migração): PRAGMA table_info
   * lança. Guarda a mensagem do SQLite em vez de derrubar a listagem inteira.
   */
  unavailable: z.string().optional(),
});
export type TableSchema = z.infer<typeof tableSchema>;

/**
 * Referência de uma linha.
 *
 * `rowid` e `pk` são ESTÁVEIS: continuam apontando para a mesma linha depois
 * que o dado ao redor muda, e por isso servem para escrever.
 *
 * `scan` é POSICIONAL — "a n-ésima linha desta ordenação" — e vale só até o
 * dado se mexer. Existe para um caso só: ler o conteúdo inteiro de uma célula
 * grande num objeto que não tem identidade nenhuma (view só-leitura, tabela
 * sem rowid nem PK), onde hoje o valor é simplesmente inalcançável. As
 * escritas a recusam explicitamente — é essa assimetria que a torna segura.
 */
export const rowRefSchema = z.union([
  z.object({ rowid: z.number() }),
  z.object({ pk: z.record(cellValueSchema) }),
  z.object({
    scan: z.object({
      offset: z.number().int().nonnegative(),
      orderBy: z.string().optional(),
      direction: z.enum(["asc", "desc"]).optional(),
    }),
  }),
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
