import {
  KEY_VALUE_PREVIEW_LIMIT,
  protocolError,
  type CommandMessage,
  type CommandResultMessage,
  type StorageValue,
} from "@rnsi/protocol";
import type { AdapterRegistry } from "./registry.ts";
import { isDatabaseAdapter, isKeyValueAdapter } from "./adapter.ts";
import type { StreamHub } from "./streams.ts";

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
  command: CommandMessage,
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
      return fail("unknown-provider", `provider não registrado: ${command.payload.providerId}`);
    }

    switch (command.type) {
      case "key-value.list":
      case "key-value.get":
      case "key-value.get-full":
      case "key-value.set":
      case "key-value.remove": {
        if (!isKeyValueAdapter(adapter)) {
          return fail("unsupported-capability", `${adapter.providerId} não é key-value`);
        }
        switch (command.type) {
          case "key-value.list": {
            const { instanceId, afterKey, limit } = command.payload;
            return succeed(await adapter.listKeys(instanceId, { afterKey, limit }));
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
        }
      }
    }

    if (!isDatabaseAdapter(adapter)) {
      return fail("unsupported-capability", `${adapter.providerId} não é database`);
    }
    switch (command.type) {
      case "database.tables":
        return succeed({ tables: await adapter.tables(command.payload.instanceId) });
      case "database.rows": {
        const { instanceId, table, limit, offset, orderBy, direction } = command.payload;
        return succeed(
          await adapter.rows(instanceId, table, { limit, offset, orderBy, direction }),
        );
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
    }
  } catch (cause) {
    return fail("internal", cause instanceof Error ? cause.message : String(cause));
  }
}
