"use strict";

/**
 * Shim do @op-engineering/op-sqlite (marcador de bundle: __RNSI_SHIM__).
 *
 * Embrulha as funções de abertura e registra todo banco no adapter,
 * automaticamente. Só isso — a instrumentação de verdade (multiplexar o
 * updateHook, farejar o que o hook nativo não cobre, sobreviver a close/reopen)
 * mora em packages/runtime, onde tem tipo e teste.
 *
 * Duas diferenças em relação ao shim do expo-sqlite:
 *  - `open` é SÍNCRONO e as options não precisam de flag nenhuma, então o objeto
 *    é repassado por referência, intocado (o expo precisa injetar
 *    enableChangeListener na abertura).
 *  - o hook é por banco (db.updateHook), não um listener global do módulo.
 */

// Resolvido pelo anti-loop para o módulo REAL:
const real = require("@op-engineering/op-sqlite");
const { getRuntime, rnsi, isModuleEnabled } = require("./_bootstrap.js");

// Opt-in: storage desligado no config → passthrough sem instrumentar.
const runtime = isModuleEnabled("storage") ? getRuntime() : null;

let exported = real;

if (runtime) {
  try {
    const adapter = rnsi.createOpSqliteAdapter();
    runtime.registry.register(adapter);

    // Uma instância por instanceId, viva pelo resto da sessão: é ela que
    // atravessa o ciclo close/reopen.
    const instances = new Map();
    let logged = false;

    const track = (options, db) => {
      try {
        const instanceId = rnsi.opSqliteInstanceId(options);
        // Sem nome não há como identificar o banco na UI — não instrumenta.
        if (!instanceId || !db) return db;

        let instance = instances.get(instanceId);
        if (instance) {
          instance.attach(db); // reopen do mesmo nome
          return db;
        }

        instance = rnsi.createOpSqliteInstance({ instanceId, adapter });
        instances.set(instanceId, instance);
        instance.attach(db);
        adapter.registerDatabase(instanceId, instance.database, {
          hasChangeListener: instance.hasChangeListener(),
        });

        // Uma linha, uma vez: responde metade das dúvidas de um E2E ruim.
        if (!logged) {
          logged = true;
          const info = instance.diagnostics();
          console.log(
            `[nativescope] op-sqlite: updateHook=${info.updateHook ? "installed" : "missing"}` +
              `, multiplex=${info.multiplex ? "yes" : "no"}`,
          );
        }
      } catch {
        /* registro nunca quebra a abertura do banco */
      }
      return db;
    };

    exported = Object.create(real);

    // `open` é síncrono. `openAsync` precisa de wrapper próprio: ele chama o
    // `open` interno do módulo (closure), não `exported.open`.
    const wrapSync = (name) => {
      if (typeof real[name] !== "function") return;
      Object.defineProperty(exported, name, {
        enumerable: true,
        // O real é chamado ANTES de instrumentar, então um throw dele (ex.:
        // openSync/openRemote fora de um build libsql) propaga idêntico.
        value: (options, ...rest) => track(options, real[name](options, ...rest)),
      });
    };
    const wrapAsync = (name) => {
      if (typeof real[name] !== "function") return;
      Object.defineProperty(exported, name, {
        enumerable: true,
        value: async (options, ...rest) => track(options, await real[name](options, ...rest)),
      });
    };

    wrapSync("open");
    wrapAsync("openAsync");
    // Exclusivos de builds libsql/Turso — embrulhados defensivamente.
    wrapSync("openSync");
    wrapSync("openRemote");
  } catch (error) {
    console.warn("[nativescope] failed to instrument op-sqlite:", error);
  }
}

module.exports = exported;
