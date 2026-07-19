"use strict";

/**
 * Shim do expo-sqlite (marcador de bundle: __RNSI_SHIM__).
 *
 * Duas coisas que o registro manual jamais conseguiria:
 * 1. Embrulha openDatabaseAsync/Sync FORÇANDO enableChangeListener: true —
 *    a flag é decidida na abertura e não dá para ligar depois. É ela que
 *    faz o realtime de SQLite existir.
 * 2. Registra todo banco aberto no adapter, automaticamente.
 *
 * O hook global addDatabaseChangeListener entrega {databaseName, tableName,
 * rowId} — sem a operação. O adapter propaga como "unknown" e a UI
 * re-consulta.
 */

// Resolvido pelo anti-loop para o módulo REAL:
const real = require("expo-sqlite");
const { getRuntime, rnsi } = require("./_bootstrap.js");

const runtime = getRuntime();

let exported = real;

if (runtime) {
  try {
    const adapter = rnsi.createExpoSqliteAdapter();
    runtime.registry.register(adapter);

    if (typeof real.addDatabaseChangeListener === "function") {
      real.addDatabaseChangeListener((event) => {
        try {
          adapter.notifyNativeChange(
            event.databaseName,
            event.tableName,
            typeof event.rowId === "number" ? event.rowId : null,
          );
        } catch {
          /* nunca propaga para o app */
        }
      });
    }

    const withListener = (options) => ({ ...(options || {}), enableChangeListener: true });

    const register = (name, db) => {
      try {
        adapter.registerDatabase(name, db, { hasChangeListener: true });
      } catch {
        /* registro nunca quebra a abertura do banco */
      }
      return db;
    };

    exported = Object.create(real);

    if (typeof real.openDatabaseAsync === "function") {
      Object.defineProperty(exported, "openDatabaseAsync", {
        enumerable: true,
        value: async (name, options, directory) =>
          register(name, await real.openDatabaseAsync(name, withListener(options), directory)),
      });
    }
    if (typeof real.openDatabaseSync === "function") {
      Object.defineProperty(exported, "openDatabaseSync", {
        enumerable: true,
        value: (name, options, directory) =>
          register(name, real.openDatabaseSync(name, withListener(options), directory)),
      });
    }
  } catch (error) {
    console.warn("[storage-inspector] falha ao instrumentar expo-sqlite:", error);
  }
}

module.exports = exported;
