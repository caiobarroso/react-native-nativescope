"use strict";

/**
 * Shim do MMKV (marcador de bundle: __RNSI_SHIM__).
 *
 * Auto-discovery completo (plano D3): embrulha a classe MMKV para que TODA
 * instância se registre no momento do `new MMKV()` — inclusive as criadas
 * em escopo de módulo, encriptadas ou dentro de libs de terceiro. A
 * interceptação acontece no bundle, então ordem de import não importa.
 */

// Resolvido pelo anti-loop para o módulo REAL:
const real = require("react-native-mmkv");
const { getRuntime, rnsi } = require("./_bootstrap.js");

const runtime = getRuntime();

let exported = real;

if (runtime && typeof real.MMKV === "function") {
  try {
    const adapter = rnsi.createMMKVAdapter();
    runtime.registry.register(adapter);

    class InspectedMMKV extends real.MMKV {
      constructor(configuration) {
        super(configuration);
        try {
          const id =
            (configuration && configuration.id) || "mmkv.default";
          // A instância carrega a própria chave de encriptação — ler
          // através dela funciona mesmo para storages encriptados.
          adapter.registerInstance(id, this);
        } catch {
          /* registro nunca pode quebrar o construtor do app */
        }
      }
    }

    exported = Object.create(real);
    Object.defineProperty(exported, "MMKV", {
      value: InspectedMMKV,
      enumerable: true,
    });
  } catch (error) {
    console.warn("[storage-inspector] falha ao instrumentar MMKV:", error);
  }
}

module.exports = exported;
