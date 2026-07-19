import type {
  Capability,
  ChangeSource,
  InstanceDescriptor,
  KeyEntry,
  StorageValue,
} from "@rnsi/protocol";

/**
 * Contrato de um adapter key-value. Interfaces pequenas por capability —
 * SQLite terá o próprio contrato (database.*), não uma extensão deste.
 *
 * Sem classe base. Cada adapter é um objeto que satisfaz a interface
 * (regra §16.7 do doc de produto).
 */
export interface KeyValueAdapter {
  providerId: string;
  label: string;
  capabilities: Capability[];

  instances(): InstanceDescriptor[];
  listKeys(instanceId: string): Promise<KeyEntry[]>;
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
