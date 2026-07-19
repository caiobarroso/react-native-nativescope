import {
  protocolError,
  type CommandMessage,
  type CommandResultMessage,
} from "@rnsi/protocol";
import type { AdapterRegistry } from "./registry.ts";
import { isDatabaseAdapter, isKeyValueAdapter } from "./adapter.ts";

/**
 * Executa um command contra o registry e devolve o resultado.
 * Nunca lança: todo erro vira um command-result estruturado.
 */
export async function handleCommand(
  registry: AdapterRegistry,
  command: CommandMessage,
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

    const adapter = registry.get(command.payload.providerId);
    if (!adapter) {
      return fail("unknown-provider", `provider não registrado: ${command.payload.providerId}`);
    }

    switch (command.type) {
      case "key-value.list":
      case "key-value.get":
      case "key-value.set":
      case "key-value.remove": {
        if (!isKeyValueAdapter(adapter)) {
          return fail("unsupported-capability", `${adapter.providerId} não é key-value`);
        }
        switch (command.type) {
          case "key-value.list":
            return succeed({ entries: await adapter.listKeys(command.payload.instanceId) });
          case "key-value.get":
            return succeed({
              value: await adapter.get(command.payload.instanceId, command.payload.key),
            });
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
