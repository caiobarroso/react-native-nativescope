"use strict";

/**
 * Shim do React Query (marcador de bundle: __RNSI_SHIM__).
 *
 * Em DEV, descobre QueryClients automaticamente. O usuário pode habilitar a
 * ponte no nativescope.config sem importar caminhos internos do app.
 */

// Resolvido pelo anti-loop para o módulo REAL:
const real = require("@tanstack/react-query");
const { getRuntime, rnsi } = require("./_bootstrap.js");

const runtime = getRuntime();
let exported = real;

if (runtime && typeof real.QueryClient === "function") {
  try {
    class InspectedQueryClient extends real.QueryClient {
      constructor(...args) {
        super(...args);
        try {
          rnsi.registerReactQueryClient?.(this);
        } catch {
          /* instrumentação nunca pode quebrar o app */
        }
      }
    }

    exported = Object.create(real);
    Object.defineProperty(exported, "QueryClient", {
      value: InspectedQueryClient,
      enumerable: true,
    });
  } catch (error) {
    console.warn("[nativescope] failed to instrument React Query:", error);
  }
}

module.exports = exported;
