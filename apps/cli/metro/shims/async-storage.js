"use strict";

/**
 * Shim do AsyncStorage (marcador de bundle: __RNSI_SHIM__).
 *
 * Entregue pelo resolver do Metro no lugar de
 * `@react-native-async-storage/async-storage` em bundles de DEV. Embrulha os
 * métodos de escrita para emitir eventos ao Studio e re-exporta o resto.
 *
 * Este arquivo nunca pode aparecer num bundle de release — o resolver não o
 * entrega com `dev === false`, e o guard de CI varre o bundle atrás do
 * marcador acima.
 */

// Resolvido pelo anti-loop para o módulo REAL:
const real = require("@react-native-async-storage/async-storage");
const session = require("__rnsi_session__");

const AsyncStorage = real.default ?? real;

if (session && typeof session.port === "number" && typeof session.token === "string") {
  try {
    instrument(AsyncStorage, session);
  } catch (error) {
    // Ferramenta de dev nunca derruba o app do usuário.
    console.warn("[storage-inspector] falha ao instrumentar AsyncStorage:", error);
  }
}

function instrument(storage, { port, token }) {
  const { startRuntime } = require("./_runtime-bridge.js");
  const runtime = startRuntime({ port, token, platform: detectPlatform() });

  /** Notifica o Studio de uma escrita feita PELO APP. Escritas vindas do
   * Studio chegam pelo adapter (source: "studio") — aqui é a via do app. */
  const notify = (key, change, value) => {
    runtime.emitAppChange({ key, change, value });
  };

  const wrap = (name, fn) => {
    const original = storage[name].bind(storage);
    storage[name] = async (...args) => {
      const result = await original(...args);
      try {
        fn(...args);
      } catch {
        /* nunca propaga erro de instrumentação */
      }
      return result;
    };
  };

  wrap("setItem", (key, value) => notify(key, "set", value));
  wrap("removeItem", (key) => notify(key, "removed", null));
  wrap("multiSet", (pairs) => {
    for (const [key, value] of pairs) notify(key, "set", value);
  });
  wrap("multiRemove", (keys) => {
    for (const key of keys) notify(key, "removed", null);
  });
  wrap("mergeItem", (key) => notify(key, "merged", null));
  wrap("clear", () => notify("*", "cleared", null));

  runtime.registerAsyncStorage(storage);
}

function detectPlatform() {
  try {
    return require("react-native").Platform.OS;
  } catch {
    return "unknown";
  }
}

module.exports = real;
module.exports.default = AsyncStorage;
