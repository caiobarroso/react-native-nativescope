import {
  KEY_VALUE_PREVIEW_LIMIT,
  protocolError,
  type CommandMessage,
  type CommandResultMessage,
  type StorageValue,
} from "@rnsi/protocol";
import type { AdapterRegistry } from "./registry.ts";
import {
  isDatabaseAdapter,
  isKeyValueAdapter,
  type KeyValueAdapter,
} from "./adapter.ts";
import type { StreamHub } from "./streams.ts";
import { breathe } from "./key-pagination.ts";

/** Dependências opcionais de execução — streaming quando o transporte suporta. */
export interface CommandContext {
  streams?: StreamHub;
}

/**
 * key-value.get devolve no máximo KEY_VALUE_PREVIEW_LIMIT chars — valor
 * maior chega truncado com o tamanho real anunciado, e o completo vem por
 * key-value.get-full via stream. Nenhuma resposta de get estoura o orçamento
 * de mensagem, não importa o tamanho do dado no device.
 */
function withPreviewLimit(value: StorageValue | null): {
  value: StorageValue | null;
  truncated: boolean;
  totalSize: number;
} {
  if (value === null) return { value: null, truncated: false, totalSize: 0 };
  if (value.type === "string" || value.type === "json" || value.type === "buffer") {
    const text = value.value;
    if (text.length > KEY_VALUE_PREVIEW_LIMIT) {
      return {
        value: { ...value, value: text.slice(0, KEY_VALUE_PREVIEW_LIMIT) },
        truncated: true,
        totalSize: text.length,
      };
    }
    return { value, truncated: false, totalSize: text.length };
  }
  return { value, truncated: false, totalSize: String(value.value).length };
}

const SEARCH_SCAN_PAGE = 500;
const SEARCH_DEFAULT_LIMIT = 50;
const SEARCH_MAX_SCAN = 100_000;

/**
 * Busca de key-value executada NO DEVICE, varrendo páginas do listKeys
 * (nomes + previews) com yield entre páginas. Só matches viajam — buscar em
 * milhões de chaves não transfere milhões de entries. Genérico para todo
 * KeyValueAdapter: nenhum adapter precisa implementar nada.
 */
async function searchKeyValue(
  adapter: KeyValueAdapter,
  instanceId: string,
  query: string,
  limit: number,
): Promise<{ entries: unknown[]; complete: boolean; scanned: number }> {
  const q = query.toLowerCase();
  const entries: unknown[] = [];
  let afterKey: string | undefined;
  let scanned = 0;
  for (;;) {
    const page = await adapter.listKeys(instanceId, {
      ...(afterKey !== undefined ? { afterKey } : {}),
      limit: SEARCH_SCAN_PAGE,
    });
    scanned += page.entries.length;
    for (const entry of page.entries) {
      if (
        entry.key.toLowerCase().includes(q) ||
        entry.preview.toLowerCase().includes(q)
      ) {
        entries.push(entry);
        if (entries.length >= limit) {
          return { entries, complete: page.nextAfterKey === null, scanned };
        }
      }
    }
    if (page.nextAfterKey === null) return { entries, complete: true, scanned };
    if (scanned >= SEARCH_MAX_SCAN) return { entries, complete: false, scanned };
    afterKey = page.nextAfterKey;
    await breathe();
  }
}

/** Export NDJSON de uma instância key-value: uma linha por chave, valor íntegro. */
async function* exportKeyValueLines(
  adapter: KeyValueAdapter,
  instanceId: string,
): AsyncGenerator<string> {
  let afterKey: string | undefined;
  for (;;) {
    const page = await adapter.listKeys(instanceId, {
      ...(afterKey !== undefined ? { afterKey } : {}),
      limit: SEARCH_SCAN_PAGE,
    });
    for (const entry of page.entries) {
      const value = await adapter.get(instanceId, entry.key);
      if (value !== null) {
        yield `${JSON.stringify({ key: entry.key, type: value.type, value: value.value })}\n`;
      }
    }
    if (page.nextAfterKey === null) return;
    afterKey = page.nextAfterKey;
    await breathe();
  }
}

/** Forma serializada que trafega nos chunks de get-full. */
function serializeForStream(value: StorageValue): string {
  switch (value.type) {
    case "string":
    case "json":
    case "buffer":
      return value.value;
    case "number":
    case "boolean":
      return String(value.value);
    case "null":
      return "";
  }
}

/**
 * Executa um command contra o registry e devolve o resultado.
 * Nunca lança: todo erro vira um command-result estruturado.
 */
export async function handleCommand(
  registry: AdapterRegistry,
  // module.command é roteado no bootstrap ANTES daqui (onModuleCommand), então
  // este handler só vê comandos de storage — todos com providerId no payload.
  command: Exclude<CommandMessage, { type: "module.command" }>,
  context?: CommandContext,
): Promise<CommandResultMessage> {
  const fail = (
    code: Parameters<typeof protocolError>[0],
    message: string,
  ): CommandResultMessage => ({
    kind: "command-result",
    requestId: command.requestId,
    ok: false,
    error: protocolError(code, message),
  });

  const succeed = (result: unknown): CommandResultMessage => ({
    kind: "command-result",
    requestId: command.requestId,
    ok: true,
    result,
  });

  try {
    if (command.type === "provider.list") {
      return succeed({ providers: registry.describe() });
    }

    if (command.type === "stream.cancel") {
      context?.streams?.cancel(command.payload.streamId);
      return succeed({});
    }

    const adapter = registry.get(command.payload.providerId);
    if (!adapter) {
      return fail("unknown-provider", `provider is not registered: ${command.payload.providerId}`);
    }

    switch (command.type) {
      case "key-value.list":
      case "key-value.get":
      case "key-value.get-full":
      case "key-value.set":
      case "key-value.remove":
      case "key-value.search":
      case "key-value.export": {
        if (!isKeyValueAdapter(adapter)) {
          return fail("unsupported-capability", `${adapter.providerId} is not a key-value provider`);
        }
        switch (command.type) {
          case "key-value.list": {
            const { instanceId, afterKey, limit, lean } = command.payload;
            return succeed(await adapter.listKeys(instanceId, { afterKey, limit, lean }));
          }
          case "key-value.get":
            return succeed(
              withPreviewLimit(
                await adapter.get(command.payload.instanceId, command.payload.key),
              ),
            );
          case "key-value.get-full": {
            if (!context?.streams) {
              return fail("internal", "streaming indisponível neste runtime");
            }
            const value = await adapter.get(command.payload.instanceId, command.payload.key);
            if (value === null) {
              return succeed({ streamId: null, valueType: "null", totalSize: 0 });
            }
            const data = serializeForStream(value);
            return succeed({
              streamId: context.streams.streamText(data),
              valueType: value.type,
              totalSize: data.length,
            });
          }
          case "key-value.set":
            await adapter.set(
              command.payload.instanceId,
              command.payload.key,
              command.payload.value,
            );
            return succeed({});
          case "key-value.remove":
            await adapter.remove(command.payload.instanceId, command.payload.key);
            return succeed({});
          case "key-value.search":
            return succeed(
              await searchKeyValue(
                adapter,
                command.payload.instanceId,
                command.payload.query,
                command.payload.limit ?? SEARCH_DEFAULT_LIMIT,
              ),
            );
          case "key-value.export": {
            if (!context?.streams) {
              return fail("internal", "streaming indisponível neste runtime");
            }
            const { instanceId } = command.payload;
            return succeed({
              streamId: context.streams.streamFrom(() =>
                exportKeyValueLines(adapter, instanceId),
              ),
            });
          }
        }
      }
    }

    if (!isDatabaseAdapter(adapter)) {
      return fail("unsupported-capability", `${adapter.providerId} is not a database provider`);
    }
    switch (command.type) {
      case "database.tables":
        return succeed({ tables: await adapter.tables(command.payload.instanceId) });
      case "database.rows": {
        const { instanceId, table, limit, offset, afterRowid, orderBy, direction } =
          command.payload;
        return succeed(
          await adapter.rows(instanceId, table, {
            limit,
            offset,
            afterRowid,
            orderBy,
            direction,
          }),
        );
      }
      case "database.cell": {
        if (!context?.streams) {
          return fail("internal", "streaming indisponível neste runtime");
        }
        const { instanceId, table, ref, column } = command.payload;
        const cell = await adapter.cell(instanceId, table, ref, column);
        if (cell === null) {
          return succeed({ streamId: null, kind: "text", totalSize: 0 });
        }
        return succeed({
          streamId: context.streams.streamText(cell.data),
          kind: cell.kind,
          totalSize: cell.data.length,
        });
      }
      case "database.update":
        await adapter.update(
          command.payload.instanceId,
          command.payload.table,
          command.payload.ref,
          command.payload.set,
        );
        return succeed({});
      case "database.insert":
        return succeed(
          await adapter.insert(
            command.payload.instanceId,
            command.payload.table,
            command.payload.values,
          ),
        );
      case "database.delete":
        await adapter.delete(
          command.payload.instanceId,
          command.payload.table,
          command.payload.ref,
        );
        return succeed({});
      case "database.execute":
        return succeed({
          result: await adapter.execute(command.payload.instanceId, command.payload.sql),
        });
      case "database.search":
        return succeed(
          await adapter.search(
            command.payload.instanceId,
            command.payload.query,
            command.payload.limit ?? SEARCH_DEFAULT_LIMIT,
          ),
        );
      case "database.export": {
        if (!context?.streams) {
          return fail("internal", "streaming indisponível neste runtime");
        }
        const { instanceId, table } = command.payload;
        return succeed({
          streamId: context.streams.streamFrom(async function* () {
            for await (const row of adapter.exportRows(instanceId, table)) {
              yield `${JSON.stringify(row)}\n`;
            }
          }),
        });
      }
    }
  } catch (cause) {
    return fail("internal", cause instanceof Error ? cause.message : String(cause));
  }
}
