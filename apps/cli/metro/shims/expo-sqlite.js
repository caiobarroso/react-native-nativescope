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
    const databaseByPath = new Map();

    const mutationTable = (sql) => {
      const trimmed = String(sql || "").trim();
      const match =
        /^(?:insert|replace)\s+into\s+["'`]?([A-Za-z_][\w]*)/i.exec(trimmed) ||
        /^update\s+["'`]?([A-Za-z_][\w]*)/i.exec(trimmed) ||
        /^delete\s+from\s+["'`]?([A-Za-z_][\w]*)/i.exec(trimmed) ||
        /^(?:create|drop|alter)\s+table(?:\s+if\s+(?:not\s+)?exists)?\s+["'`]?([A-Za-z_][\w]*)/i.exec(trimmed);
      return match ? match[1] : null;
    };

    const isMutation = (sql) =>
      /^\s*(insert|replace|update|delete|create|drop|alter)\b/i.test(String(sql || ""));

    // lastInsertRowId só é significativo em INSERT/REPLACE. Num UPDATE ele
    // carrega o rowid do último insert ANTERIOR — usá-lo geraria uma chave
    // de dedup errada e o evento nativo duplicaria a mutação.
    const isInsert = (sql) => /^\s*(insert|replace)\b/i.test(String(sql || ""));

    const splitStatements = (sql) =>
      String(sql || "")
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean);

    if (typeof real.addDatabaseChangeListener === "function") {
      real.addDatabaseChangeListener((event) => {
        try {
          const instanceId = databaseByPath.get(event.databaseFilePath) ?? event.databaseName;
          adapter.notifyNativeChange(
            instanceId,
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
      if (typeof db.databasePath === "string") databaseByPath.set(db.databasePath, name);

      const notifyMutation = (sql, rowId = null) => {
        if (!isMutation(sql)) return;
        const table = mutationTable(sql) ?? "*";
        if (/^\s*(create|drop|alter)\b/i.test(String(sql || ""))) {
          adapter.notifySchemaChanged(name, table);
        }
        adapter.notifyAppMutation(
          name,
          table,
          typeof rowId === "number" && rowId > 0 ? rowId : null,
        );
      };

      // Wrap IN-PLACE, no próprio objeto — nunca Object.create(db):
      // herança por protótipo quebra com campos privados de classe
      // (#campo) e faz métodos que escrevem this.x divergirem de estado.
      // Mesmo padrão do shim de AsyncStorage.
      try {
        if (typeof db.runAsync === "function") {
          const originalRun = db.runAsync.bind(db);
          db.runAsync = async (sql, ...params) => {
            const result = await originalRun(sql, ...params);
            try {
              notifyMutation(sql, isInsert(sql) ? result && result.lastInsertRowId : null);
            } catch {
              /* instrumentação nunca propaga erro para o app */
            }
            return result;
          };
        }
        if (typeof db.execAsync === "function") {
          const originalExec = db.execAsync.bind(db);
          db.execAsync = async (sql) => {
            const result = await originalExec(sql);
            try {
              for (const statement of splitStatements(sql)) notifyMutation(statement);
            } catch {
              /* idem */
            }
            return result;
          };
        }
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
    console.warn("[nativescope] failed to instrument expo-sqlite:", error);
  }
}

module.exports = exported;
