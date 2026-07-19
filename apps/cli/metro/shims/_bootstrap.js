"use strict";

/**
 * Bootstrap compartilhado dos shims (marcador: __RNSI_SHIM__).
 *
 * Um runtime por app, criado sob demanda no primeiro shim que carregar.
 * `runtime-bundle.js` é o @rnsi/runtime REAL, bundlado no build da CLI —
 * o mesmo código coberto pelos contract tests.
 */

const session = require("__rnsi_session__");
const rnsi = require("./runtime-bundle.js");

let runtime = null;

function detectPlatform() {
  try {
    return require("react-native").Platform.OS;
  } catch {
    return "unknown";
  }
}

/** null quando não há sessão da CLI — os shims viram no-op. */
function getRuntime() {
  if (!session || typeof session.port !== "number" || typeof session.token !== "string") {
    return null;
  }
  if (!runtime) {
    runtime = rnsi.startRuntime({
      url: `ws://127.0.0.1:${session.port}`,
      sessionToken: session.token,
      client: { name: "react-native-app", platform: detectPlatform() },
    });
  }
  return runtime;
}

module.exports = { getRuntime, rnsi };
