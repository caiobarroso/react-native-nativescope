import type { TableSchema } from "@rnsi/protocol";

/**
 * O que o Studio pode oferecer numa tabela ou view, e por quê quando não pode.
 *
 * Existia como um `readOnly = schema?.identity === "none"` solto dentro do
 * RowGrid, alimentando seis gates espalhados pelo componente. Isso tinha dois
 * problemas: os gates divergiam entre si (o modal de JSON abria e tentava
 * salvar numa tabela só-leitura) e nada disso tinha teste, porque o vitest do
 * desktop roda em `node` e não monta componente.
 *
 * Módulo puro para que ambos deixem de ser verdade.
 */

export interface TablePermissions {
  update: boolean;
  insert: boolean;
  /** Seleção múltipla + apagar em lote. */
  bulkDelete: boolean;
  /** Esvaziar a tabela inteira. */
  deleteAll: boolean;
  /** Por que a escrita está bloqueada. `null` quando não está. */
  reason: string | null;
}

const NOTHING: Omit<TablePermissions, "reason"> = {
  update: false,
  insert: false,
  bulkDelete: false,
  deleteAll: false,
};

const EVERYTHING: Omit<TablePermissions, "reason"> = {
  update: true,
  insert: true,
  bulkDelete: true,
  deleteAll: true,
};

export function tablePermissions(schema: TableSchema | undefined): TablePermissions {
  // Sem schema ainda: nada de escrita, e nada de explicação — não há o que
  // explicar enquanto a listagem não chegou.
  if (!schema) return { ...NOTHING, reason: null };

  if (schema.unavailable !== undefined) {
    return {
      ...NOTHING,
      reason: `This view cannot be read: ${schema.unavailable}. Its underlying table was probably dropped or renamed.`,
    };
  }

  if (schema.kind === "view") {
    const writable = schema.writable ?? { insert: false, update: false, delete: false };
    const hasAnyTrigger = writable.insert || writable.update || writable.delete;

    if (!hasAnyTrigger) {
      return {
        ...NOTHING,
        reason:
          "Read only: this view has no INSTEAD OF triggers, so SQLite cannot apply writes to it.",
      };
    }

    // Tem trigger mas não deu para derivar chave: sabemos escrever, não
    // sabemos em qual linha. Insert não precisa de chave e continua.
    if (schema.identity === "none") {
      return {
        ...NOTHING,
        insert: writable.insert,
        reason:
          "Rows in this view cannot be edited: its INSTEAD OF triggers do not reference OLD columns, so there is no way to identify a single row.",
      };
    }

    return {
      update: writable.update,
      insert: writable.insert,
      // Em lote e esvaziar nunca: cada linha precisa ser verificada uma a uma,
      // e um DELETE sem WHERE dispararia o trigger uma vez por linha.
      bulkDelete: false,
      deleteAll: false,
      reason: partialViewReason(writable),
    };
  }

  if (schema.identity === "none") {
    return {
      ...NOTHING,
      reason:
        "Read only: this table has no rowid or primary key, so rows cannot be edited safely without a stable identity.",
    };
  }

  return { ...EVERYTHING, reason: null };
}

/**
 * Numa view gravável ainda pode faltar operação — ter INSTEAD OF UPDATE e não
 * ter DELETE é comum. Dizer isso evita o usuário procurar um botão que não
 * existe.
 */
function partialViewReason(writable: {
  insert: boolean;
  update: boolean;
  delete: boolean;
}): string | null {
  const missing: string[] = [];
  if (!writable.update) missing.push("edit");
  if (!writable.insert) missing.push("insert");
  if (!writable.delete) missing.push("delete");
  if (missing.length === 0) return null;
  return `This view supports only some writes: you cannot ${listWords(missing)} rows here, because it has no matching INSTEAD OF trigger.`;
}

function listWords(words: string[]): string {
  if (words.length === 1) return words[0] as string;
  return `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`;
}

/**
 * Rótulo curto do cadeado da sidebar. Mesma fonte de verdade da razão longa
 * do grid, para as duas nunca discordarem.
 */
export function tableLockLabel(schema: TableSchema): string | null {
  if (schema.unavailable !== undefined) return "Unavailable: its underlying table is gone";
  const permissions = tablePermissions(schema);
  if (permissions.update || permissions.insert) return null;
  if (schema.kind === "view") {
    return schema.writable && (schema.writable.insert || schema.writable.update)
      ? "Read only: no row key could be derived from its triggers"
      : "Read only: view without INSTEAD OF triggers";
  }
  return "Read only: no rowid or primary key";
}
