import type {
  Capability,
  CellValue,
  ChangeSource,
  ExecuteResult,
  InstanceDescriptor,
  KeyEntry,
  Row,
  RowRef,
  StorageValue,
  TableSchema,
} from "@rnsi/protocol";

/**
 * Base comum de todo adapter — só a identidade e as capabilities.
 * Interfaces pequenas por capability: key-value e database são contratos
 * separados, não uma interface gigante (plano §13.3).
 *
 * Sem classe base. Cada adapter é um objeto que satisfaz a interface
 * (regra §16.7 do doc de produto).
 */
export interface ProviderAdapter {
  providerId: string;
  label: string;
  capabilities: Capability[];
  instances(): InstanceDescriptor[];
  onInstancesChanged?(listener: () => void): () => void;
}

export function isKeyValueAdapter(adapter: ProviderAdapter): adapter is KeyValueAdapter {
  return adapter.capabilities.includes("key-value.read");
}

/** Uma página da listagem de chaves — ver key-pagination.ts. */
export interface KeyListPage {
  entries: KeyEntry[];
  nextAfterKey: string | null;
  total: number;
}

/** Contrato de um adapter key-value. */
export interface KeyValueAdapter extends ProviderAdapter {
  /**
   * Lista uma PÁGINA de chaves. O adapter só lê os valores da janela pedida
   * — nunca materializa o dataset inteiro (orçamento: memória O(página)).
   */
  listKeys(
    instanceId: string,
    options?: { afterKey?: string; limit?: number },
  ): Promise<KeyListPage>;
  get(instanceId: string, key: string): Promise<StorageValue | null>;
  set(instanceId: string, key: string, value: StorageValue): Promise<void>;
  remove(instanceId: string, key: string): Promise<void>;

  /**
   * Observa mudanças. O callback recebe a origem já resolvida — a supressão
   * de eco (distinguir escrita do Studio de escrita do app) é responsabilidade
   * do adapter, que é quem sabe o que acabou de escrever.
   */
  subscribe(
    instanceId: string,
    listener: (change: KeyValueChange) => void,
  ): () => void;
}

export interface KeyValueChange {
  key: string;
  change: "created" | "updated" | "removed";
  source: ChangeSource;
  entry: KeyEntry | null;
}

export function isDatabaseAdapter(adapter: ProviderAdapter): adapter is DatabaseAdapter {
  return adapter.capabilities.includes("database.query");
}

/** Contrato de um adapter de banco (SQLite). */
export interface DatabaseAdapter extends ProviderAdapter {
  tables(instanceId: string): Promise<TableSchema[]>;
  rows(
    instanceId: string,
    table: string,
    options: {
      limit: number;
      offset: number;
      /** Cursor keyset (rowid, sem orderBy) — quando presente, offset é ignorado. */
      afterRowid?: number;
      orderBy?: string;
      direction?: "asc" | "desc";
    },
  ): Promise<{ rows: Row[]; total: number; totalIsEstimate?: boolean }>;
  /** Conteúdo completo de UMA célula — serializado para streaming. */
  cell(
    instanceId: string,
    table: string,
    ref: RowRef,
    column: string,
  ): Promise<{ data: string; kind: "text" | "blob" | "number" } | null>;
  update(
    instanceId: string,
    table: string,
    ref: RowRef,
    set: Record<string, CellValue>,
  ): Promise<void>;
  insert(
    instanceId: string,
    table: string,
    values: Record<string, CellValue>,
  ): Promise<{ ref: RowRef | null }>;
  delete(instanceId: string, table: string, ref: RowRef): Promise<void>;
  execute(instanceId: string, sql: string): Promise<ExecuteResult>;
  subscribe(instanceId: string, listener: (change: DatabaseChange) => void): () => void;
}

export interface DatabaseChange {
  table: string;
  rowId: number | null;
  operation: "insert" | "update" | "delete" | "unknown";
  source: ChangeSource;
}
