"use strict";

/**
 * Shim do AsyncStorage (marcador de bundle: __RNSI_SHIM__).
 *
 * Entregue pelo resolver do Metro no lugar de
 * `@react-native-async-storage/async-storage` em bundles de DEV. Usa o
 * adapter real do @rnsi/runtime (o mesmo dos contract tests) e instrumenta
 * os métodos de escrita para notificar mudanças feitas pelo app.
 *
 * Nunca aparece em release: o resolver não entrega com dev === false, e o
 * guard de CI varre o bundle pelo marcador.
 */

// Resolvido pelo anti-loop para o módulo REAL:
const real = require("@react-native-async-storage/async-storage");
const { getRuntime, rnsi } = require("./_bootstrap.js");

const AsyncStorage = real.default ?? real;
const runtime = getRuntime();

if (runtime) {
  try {
    const adapter = rnsi.createAsyncStorageAdapter(AsyncStorage);

    // A notificação PRECISA ser síncrona logo após o método real — é o que
    // torna a supressão de eco determinística (ver adapter).
    const wrap = (name, notify) => {
      if (typeof AsyncStorage[name] !== "function") return;
      const original = AsyncStorage[name].bind(AsyncStorage);
      AsyncStorage[name] = async (...args) => {
        const result = await original(...args);
        try {
          notify(...args);
        } catch {
          /* instrumentação nunca propaga erro para o app */
        }
        return result;
      };
    };

    const note = (key, kind) => void adapter.notifyAppWrite(key, kind);

    wrap("setItem", (key) => note(key, "set"));
    wrap("removeItem", (key) => note(key, "removed"));
    wrap("mergeItem", (key) => note(key, "set"));
    wrap("multiSet", (pairs) => {
      for (const [key] of pairs) note(key, "set");
    });
    wrap("multiMerge", (pairs) => {
      for (const [key] of pairs) note(key, "set");
    });
    wrap("multiRemove", (keys) => {
      for (const key of keys) note(key, "removed");
    });

    runtime.registry.register(adapter);
  } catch (error) {
    console.warn("[storage-inspector] falha ao instrumentar AsyncStorage:", error);
  }
}

module.exports = real;
