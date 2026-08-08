import type { TableSchema } from "@rnsi/protocol";

/**
 * Compara duas listas de schema por VALOR.
 *
 * `setTables` recebe uma resposta reparseada pelo zod a cada refresh, então o
 * array e todos os objetos dentro dele são novos mesmo quando nada mudou.
 * Guardar o array antigo nesse caso evita propagar identidade nova por metade
 * do RowGrid — e o refresh de schema é debounced e dispara em toda escrita da
 * instância, então o caso "nada mudou" é o comum, não o raro.
 *
 * Não é comparação profunda genérica de propósito: só os campos que a UI lê.
 * Um deep-equal genérico custaria mais que o refetch que ele evita.
 */
export function sameTableSchemas(
  a: readonly TableSchema[] | undefined,
  b: readonly TableSchema[],
): boolean {
  if (a === undefined || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!sameTable(a[i] as TableSchema, b[i] as TableSchema)) return false;
  }
  return true;
}

function sameTable(a: TableSchema, b: TableSchema): boolean {
  if (
    a.name !== b.name ||
    a.rowCount !== b.rowCount ||
    a.rowCountIsEstimate !== b.rowCountIsEstimate ||
    a.identity !== b.identity ||
    a.kind !== b.kind ||
    a.unavailable !== b.unavailable
  ) {
    return false;
  }
  if (a.writable?.insert !== b.writable?.insert) return false;
  if (a.writable?.update !== b.writable?.update) return false;
  if (a.writable?.delete !== b.writable?.delete) return false;
  if (!sameStrings(a.dependsOn, b.dependsOn)) return false;
  if (a.columns.length !== b.columns.length) return false;
  for (let i = 0; i < a.columns.length; i += 1) {
    const left = a.columns[i] as TableSchema["columns"][number];
    const right = b.columns[i] as TableSchema["columns"][number];
    if (
      left.name !== right.name ||
      left.declaredType !== right.declaredType ||
      left.notNull !== right.notNull ||
      left.pkIndex !== right.pkIndex
    ) {
      return false;
    }
  }
  return true;
}

function sameStrings(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}
