import type {
  CellValue,
  KeyEntry,
  ProviderDescriptor,
  Row,
  StorageValue,
  TableSchema,
} from "@rnsi/protocol";
import {
  fetchAllKeys,
  fetchAllTables,
  getValue,
  loadRows,
  removeKey,
  setValue,
} from "./studio-client.ts";

export const SQLITE_SNAPSHOT_ROW_LIMIT = 500;

export interface KeyValueSnapshotItem {
  key: string;
  value: StorageValue;
  entry: KeyEntry;
}

export interface RowSnapshotItem {
  identity: string;
  cells: Record<string, CellValue>;
}

export interface TableSnapshotItem {
  name: string;
  schema: TableSchema;
  rows: RowSnapshotItem[];
  total: number;
  truncated: boolean;
}

export interface StoreSnapshot {
  providerId: string;
  providerLabel: string;
  instanceId: string;
  instanceLabel: string;
  kind: "key-value" | "database";
  keys?: KeyValueSnapshotItem[];
  tables?: TableSnapshotItem[];
  errors: string[];
}

export interface StorageSnapshot {
  id: string;
  timestamp: number;
  stores: StoreSnapshot[];
}

export interface KeyValueDiff {
  kind: "key";
  change: "created" | "updated" | "removed";
  providerId: string;
  providerLabel: string;
  instanceId: string;
  instanceLabel: string;
  key: string;
  before: StorageValue | null;
  after: StorageValue | null;
}

export interface DatabaseTableDiff {
  kind: "table";
  providerId: string;
  providerLabel: string;
  instanceId: string;
  instanceLabel: string;
  table: string;
  added: RowSnapshotItem[];
  updated: Array<{ before: RowSnapshotItem; after: RowSnapshotItem }>;
  removed: RowSnapshotItem[];
  beforeTotal: number;
  afterTotal: number;
  truncated: boolean;
}

export interface SnapshotDiff {
  before: StorageSnapshot;
  after: StorageSnapshot;
  keyDiffs: KeyValueDiff[];
  tableDiffs: DatabaseTableDiff[];
  errors: string[];
}

export function snapshotLabel(snapshot: StorageSnapshot): string {
  return new Date(snapshot.timestamp).toLocaleTimeString("pt-BR");
}

export function snapshotStats(snapshot: StorageSnapshot): {
  keys: number;
  tables: number;
  rows: number;
  errors: number;
} {
  return snapshot.stores.reduce(
    (stats, store) => ({
      keys: stats.keys + (store.keys?.length ?? 0),
      tables: stats.tables + (store.tables?.length ?? 0),
      rows: stats.rows + (store.tables?.reduce((sum, table) => sum + table.rows.length, 0) ?? 0),
      errors: stats.errors + store.errors.length,
    }),
    { keys: 0, tables: 0, rows: 0, errors: 0 },
  );
}

export async function captureSnapshot(
  providers: ProviderDescriptor[],
  onProgress?: (message: string) => void,
): Promise<StorageSnapshot> {
  const stores: StoreSnapshot[] = [];

  for (const provider of providers) {
    for (const instance of provider.instances) {
      if (provider.capabilities.includes("key-value.read")) {
        onProgress?.(`${provider.label} · ${instance.label}`);
        stores.push(await captureKeyValueStore(provider, instance.instanceId, instance.label));
      }
      if (provider.capabilities.includes("database.query")) {
        onProgress?.(`${provider.label} · ${instance.label}`);
        stores.push(await captureDatabaseStore(provider, instance.instanceId, instance.label));
      }
    }
  }

  return {
    id: `snapshot-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    timestamp: Date.now(),
    stores,
  };
}

export function diffSnapshots(before: StorageSnapshot, after: StorageSnapshot): SnapshotDiff {
  const keyDiffs = diffKeyValueStores(before, after);
  const tableDiffs = diffDatabaseStores(before, after);
  return {
    before,
    after,
    keyDiffs,
    tableDiffs,
    errors: [...collectErrors(before), ...collectErrors(after)],
  };
}

export async function restoreKeyDiff(diff: KeyValueDiff): Promise<void> {
  if (diff.change === "created") {
    await removeKey(diff.providerId, diff.instanceId, diff.key);
    return;
  }
  if (diff.before) {
    await setValue(diff.providerId, diff.instanceId, diff.key, diff.before);
  }
}

export function valuePreview(value: StorageValue | null): string {
  if (!value) return "ausente";
  if (value.type === "string") return truncate(JSON.stringify(value.value), 96);
  if (value.type === "json") {
    try {
      return truncate(JSON.stringify(JSON.parse(value.value)), 96);
    } catch {
      return truncate(value.value, 96);
    }
  }
  if (value.type === "buffer") return `buffer(${value.value.length} base64 chars)`;
  return String(value.value);
}

export function cellPreview(cells: Record<string, CellValue>): string {
  const entries = Object.entries(cells).slice(0, 4);
  const body = entries
    .map(([key, value]) => `${key}: ${typeof value === "object" && value !== null ? "(blob)" : String(value)}`)
    .join(", ");
  return truncate(body, 120);
}

async function captureKeyValueStore(
  provider: ProviderDescriptor,
  instanceId: string,
  instanceLabel: string,
): Promise<StoreSnapshot> {
  const errors: string[] = [];
  const keys: KeyValueSnapshotItem[] = [];
  try {
    const entries = await fetchAllKeys(provider.providerId, instanceId);
    const values = await mapLimit(entries, 8, async (entry) => {
      try {
        const value = await getValue(provider.providerId, instanceId, entry.key);
        return value ? { key: entry.key, value, entry } : null;
      } catch (cause) {
        errors.push(`${entry.key}: ${errorMessage(cause)}`);
        return null;
      }
    });
    keys.push(...values.filter((value): value is KeyValueSnapshotItem => value !== null));
  } catch (cause) {
    errors.push(errorMessage(cause));
  }
  return {
    providerId: provider.providerId,
    providerLabel: provider.label,
    instanceId,
    instanceLabel,
    kind: "key-value",
    keys,
    errors,
  };
}

async function captureDatabaseStore(
  provider: ProviderDescriptor,
  instanceId: string,
  instanceLabel: string,
): Promise<StoreSnapshot> {
  const errors: string[] = [];
  const tables: TableSnapshotItem[] = [];
  try {
    const schemas = await fetchAllTables(provider.providerId, instanceId);
    for (const schema of schemas) {
      try {
        const page = await loadRows(provider.providerId, instanceId, schema.name, {
          limit: SQLITE_SNAPSHOT_ROW_LIMIT,
          offset: 0,
        });
        if (!page) continue;
        tables.push({
          name: schema.name,
          schema,
          rows: page.rows.map(rowSnapshot),
          total: page.total,
          truncated: page.total > page.rows.length,
        });
      } catch (cause) {
        errors.push(`${schema.name}: ${errorMessage(cause)}`);
      }
    }
  } catch (cause) {
    errors.push(errorMessage(cause));
  }

  return {
    providerId: provider.providerId,
    providerLabel: provider.label,
    instanceId,
    instanceLabel,
    kind: "database",
    tables,
    errors,
  };
}

function diffKeyValueStores(before: StorageSnapshot, after: StorageSnapshot): KeyValueDiff[] {
  const beforeKeys = new Map<string, KeyValueSnapshotItem>();
  const afterKeys = new Map<string, KeyValueSnapshotItem>();
  const meta = new Map<
    string,
    Pick<KeyValueDiff, "providerId" | "providerLabel" | "instanceId" | "instanceLabel" | "key">
  >();

  for (const snapshot of [before, after]) {
    for (const store of snapshot.stores) {
      if (store.kind !== "key-value") continue;
      for (const item of store.keys ?? []) {
        const id = keyId(store.providerId, store.instanceId, item.key);
        if (snapshot === before) beforeKeys.set(id, item);
        else afterKeys.set(id, item);
        meta.set(id, {
          providerId: store.providerId,
          providerLabel: store.providerLabel,
          instanceId: store.instanceId,
          instanceLabel: store.instanceLabel,
          key: item.key,
        });
      }
    }
  }

  const ids = new Set([...beforeKeys.keys(), ...afterKeys.keys()]);
  return [...ids]
    .flatMap((id): KeyValueDiff[] => {
      const beforeItem = beforeKeys.get(id);
      const afterItem = afterKeys.get(id);
      const base = meta.get(id);
      if (!base) return [];
      if (!beforeItem && afterItem) {
        return [{ kind: "key", change: "created", ...base, before: null, after: afterItem.value }];
      }
      if (beforeItem && !afterItem) {
        return [{ kind: "key", change: "removed", ...base, before: beforeItem.value, after: null }];
      }
      if (beforeItem && afterItem && stableStringify(beforeItem.value) !== stableStringify(afterItem.value)) {
        return [{ kind: "key", change: "updated", ...base, before: beforeItem.value, after: afterItem.value }];
      }
      return [];
    })
    .sort((a, b) => `${a.providerLabel} ${a.instanceId} ${a.key}`.localeCompare(`${b.providerLabel} ${b.instanceId} ${b.key}`));
}

function diffDatabaseStores(before: StorageSnapshot, after: StorageSnapshot): DatabaseTableDiff[] {
  const beforeTables = tableMap(before);
  const afterTables = tableMap(after);
  const ids = new Set([...beforeTables.keys(), ...afterTables.keys()]);

  return [...ids]
    .flatMap((id): DatabaseTableDiff[] => {
      const beforeTable = beforeTables.get(id);
      const afterTable = afterTables.get(id);
      const sample = afterTable ?? beforeTable;
      if (!sample) return [];
      const beforeRows = new Map((beforeTable?.table.rows ?? []).map((row) => [row.identity, row]));
      const afterRows = new Map((afterTable?.table.rows ?? []).map((row) => [row.identity, row]));
      const rowIds = new Set([...beforeRows.keys(), ...afterRows.keys()]);
      const added: RowSnapshotItem[] = [];
      const removed: RowSnapshotItem[] = [];
      const updated: Array<{ before: RowSnapshotItem; after: RowSnapshotItem }> = [];

      for (const rowId of rowIds) {
        const beforeRow = beforeRows.get(rowId);
        const afterRow = afterRows.get(rowId);
        if (!beforeRow && afterRow) added.push(afterRow);
        else if (beforeRow && !afterRow) removed.push(beforeRow);
        else if (beforeRow && afterRow && stableStringify(beforeRow.cells) !== stableStringify(afterRow.cells)) {
          updated.push({ before: beforeRow, after: afterRow });
        }
      }

      const changed =
        added.length > 0 ||
        removed.length > 0 ||
        updated.length > 0 ||
        (beforeTable?.table.total ?? 0) !== (afterTable?.table.total ?? 0);
      if (!changed) return [];

      return [
        {
          kind: "table",
          providerId: sample.providerId,
          providerLabel: sample.providerLabel,
          instanceId: sample.instanceId,
          instanceLabel: sample.instanceLabel,
          table: sample.table.name,
          added,
          updated,
          removed,
          beforeTotal: beforeTable?.table.total ?? 0,
          afterTotal: afterTable?.table.total ?? 0,
          truncated: Boolean(beforeTable?.table.truncated || afterTable?.table.truncated),
        },
      ];
    })
    .sort((a, b) => `${a.providerLabel} ${a.instanceId} ${a.table}`.localeCompare(`${b.providerLabel} ${b.instanceId} ${b.table}`));
}

function tableMap(snapshot: StorageSnapshot) {
  const map = new Map<
    string,
    {
      providerId: string;
      providerLabel: string;
      instanceId: string;
      instanceLabel: string;
      table: TableSnapshotItem;
    }
  >();
  for (const store of snapshot.stores) {
    if (store.kind !== "database") continue;
    for (const table of store.tables ?? []) {
      map.set(tableId(store.providerId, store.instanceId, table.name), {
        providerId: store.providerId,
        providerLabel: store.providerLabel,
        instanceId: store.instanceId,
        instanceLabel: store.instanceLabel,
        table,
      });
    }
  }
  return map;
}

function rowSnapshot(row: Row): RowSnapshotItem {
  return {
    identity: row.ref ? stableStringify(row.ref) : stableStringify(row.cells),
    cells: row.cells,
  };
}

function keyId(providerId: string, instanceId: string, key: string): string {
  return `${providerId}\u0000${instanceId}\u0000${key}`;
}

function tableId(providerId: string, instanceId: string, table: string): string {
  return `${providerId}\u0000${instanceId}\u0000${table}`;
}

function collectErrors(snapshot: StorageSnapshot): string[] {
  return snapshot.stores.flatMap((store) =>
    store.errors.map((error) => `${store.providerLabel} · ${store.instanceLabel}: ${error}`),
  );
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      if (item !== undefined) {
        results[index] = await worker(item);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, sortValue(child)]),
    );
  }
  return value;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
