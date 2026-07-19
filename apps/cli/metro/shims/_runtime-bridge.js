"use strict";

/**
 * Ponte mínima shim → serviço local (marcador de bundle: __RNSI_SHIM__).
 *
 * JS puro e autocontido de propósito: o bundle RN ainda não resolve os
 * pacotes TS do workspace. A Fase 1 converge isto para o build de
 * @rnsi/runtime — o protocolo no fio já é idêntico (v1).
 */

const PROTOCOL_VERSION = 1;

function startRuntime({ port, token, platform }) {
  let ws = null;
  let ready = false;
  let storage = null;
  let attempt = 0;
  let closed = false;

  /** Supressão de eco (plano §3.4): escritas do Studio ficam pendentes por
   * chave com TTL curto; quando o wrap do app dispara para essa chave, o
   * evento sai como source "studio" — não como falso "app". */
  const pendingStudioWrites = new Map(); // key → expiresAt

  function markStudioWrite(key) {
    pendingStudioWrites.set(key, Date.now() + 500);
  }

  function resolveSource(key) {
    const expiresAt = pendingStudioWrites.get(key);
    if (expiresAt && Date.now() < expiresAt) {
      pendingStudioWrites.delete(key);
      return "studio";
    }
    return "app";
  }

  function send(message) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(message));
  }

  function connect() {
    if (closed) return;
    ws = new WebSocket(`ws://127.0.0.1:${port}`);

    ws.onopen = () => {
      attempt = 0;
      send({
        kind: "hello",
        protocolVersion: PROTOCOL_VERSION,
        role: "runtime",
        sessionToken: token,
        client: { name: "react-native-app", platform },
      });
    };

    ws.onmessage = async (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.kind === "hello-ack") {
        ready = true;
        if (storage) announceProvider();
        return;
      }
      if (message.kind === "hello-reject") {
        closed = true;
        ws.close();
        return;
      }
      if (message.kind === "command") send(await handleCommand(message));
    };

    ws.onclose = () => {
      ready = false;
      if (closed) return;
      const delay = Math.min(500 * 2 ** attempt, 5000);
      attempt += 1;
      setTimeout(connect, delay);
    };
    ws.onerror = () => {};
  }

  function entryOf(key, value) {
    const preview = value.length > 120 ? value.slice(0, 120) + "…" : value;
    let valueType = "string";
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        JSON.parse(trimmed);
        valueType = "json";
      } catch {
        /* segue string */
      }
    }
    return { key, valueType, approxSize: value.length, preview };
  }

  function announceProvider() {
    send({
      kind: "event",
      protocolVersion: PROTOCOL_VERSION,
      timestamp: Date.now(),
      type: "provider.registered",
      payload: {
        provider: {
          providerId: "async-storage",
          label: "AsyncStorage",
          capabilities: ["key-value.read", "key-value.write", "key-value.watch"],
          instances: [{ instanceId: "default", label: "default" }],
        },
      },
    });
  }

  async function handleCommand(command) {
    const ok = (result) => ({
      kind: "command-result",
      requestId: command.requestId,
      ok: true,
      result,
    });
    const fail = (code, message) => ({
      kind: "command-result",
      requestId: command.requestId,
      ok: false,
      error: { code, message },
    });

    if (!storage) return fail("unknown-provider", "AsyncStorage ainda não registrado");

    try {
      switch (command.type) {
        case "provider.list":
          return ok({
            providers: [
              {
                providerId: "async-storage",
                label: "AsyncStorage",
                capabilities: ["key-value.read", "key-value.write", "key-value.watch"],
                instances: [{ instanceId: "default", label: "default" }],
              },
            ],
          });
        case "key-value.list": {
          const keys = await storage.getAllKeys();
          const pairs = await storage.multiGet([...keys]);
          return ok({
            entries: pairs
              .filter(([, value]) => value != null)
              .map(([key, value]) => entryOf(key, value))
              .sort((a, b) => (a.key < b.key ? -1 : 1)),
          });
        }
        case "key-value.get": {
          const value = await storage.getItem(command.payload.key);
          if (value == null) return ok({ value: null });
          const entry = entryOf(command.payload.key, value);
          return ok({ value: { type: entry.valueType === "json" ? "json" : "string", value } });
        }
        case "key-value.set": {
          const v = command.payload.value;
          const raw =
            v.type === "json" || v.type === "string" ? String(v.value) : JSON.stringify(v.value);
          markStudioWrite(command.payload.key);
          await storage.setItem(command.payload.key, raw);
          return ok({});
        }
        case "key-value.remove":
          markStudioWrite(command.payload.key);
          await storage.removeItem(command.payload.key);
          return ok({});
        default:
          return fail("invalid-message", `command desconhecido: ${command.type}`);
      }
    } catch (error) {
      return fail("internal", String((error && error.message) || error));
    }
  }

  connect();

  return {
    registerAsyncStorage(instance) {
      storage = instance;
      if (ready) announceProvider();
    },

    async emitAppChange({ key, change }) {
      if (!ready || !storage) return;
      const source = resolveSource(key);
      let entry = null;
      let kind = "removed";
      if (change === "set" || change === "merged") {
        const value = await storage.getItem(key);
        if (value != null) {
          entry = entryOf(key, value);
          kind = "updated"; // sem snapshot anterior, updated é o palpite seguro
        }
      }
      if (key === "*") return; // clear: a Fase 1 trata com diff de snapshot
      send({
        kind: "event",
        protocolVersion: PROTOCOL_VERSION,
        timestamp: Date.now(),
        type: "key-value.changed",
        payload: {
          providerId: "async-storage",
          instanceId: "default",
          key,
          change: kind,
          source,
          entry,
        },
      });
    },
  };
}

module.exports = { startRuntime };
