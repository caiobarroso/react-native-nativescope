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
    let warnedAboutRealtime = false;

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

        // Silêncio quando está tudo certo — como todos os outros shims. Só
        // falamos quando o realtime saiu DEGRADADO, que é o caso em que o
        // usuário precisa saber por que a timeline está menos precisa do que a
        // documentação promete. Uma vez por sessão, não por banco.
        const info = instance.diagnostics();
        if (!warnedAboutRealtime && !(info.updateHook && info.multiplex)) {
          warnedAboutRealtime = true;
          console.warn(
            !info.updateHook
              ? "[nativescope] op-sqlite: este build não expõe updateHook (builds " +
                  "libsql/Turso o compilam fora). O realtime passa a se basear nos " +
                  "statements SQL — inspecionar e editar continuam funcionando."
              : "[nativescope] op-sqlite: não foi possível embrulhar db.updateHook, " +
                  "então um updateHook registrado pelo seu app (ou por um ORM) " +
                  "substitui o do NativeScope e interrompe o realtime. Inspecionar " +
                  "e editar continuam funcionando.",
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
