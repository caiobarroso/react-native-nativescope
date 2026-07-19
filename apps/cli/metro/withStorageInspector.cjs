"use strict";

/**
 * Interceptação no Metro (plano §3.1, decisão D3).
 *
 * Quando o app importa uma lib de storage suportada, o resolver entrega o
 * nosso shim no lugar. O shim embrulha o módulo real (auto-registro de
 * instâncias + eventos de mudança) e re-exporta o resto transparente.
 *
 * Uso no metro.config.js (escape hatch — o fluxo principal é a CLI subir o
 * Metro já com isto aplicado):
 *
 *   const { withStorageInspector } = require("react-native-storage-inspector/metro");
 *   module.exports = withStorageInspector(config);
 */

const path = require("node:path");
const fs = require("node:fs");

const SHIM_DIR = path.join(__dirname, "shims");

/** módulo interceptado → arquivo de shim */
const SHIM_TARGETS = {
  "@react-native-async-storage/async-storage": "async-storage.js",
  "react-native-mmkv": "mmkv.js",
  "expo-sqlite": "expo-sqlite.js",
};

/** módulo virtual que entrega porta+token da sessão ao shim */
const SESSION_MODULE = "__rnsi_session__";

function defaultSessionFile(projectRoot) {
  return path.join(projectRoot, "node_modules", ".cache", "rnsi", "session.js");
}

function withStorageInspector(config, options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const sessionFile =
    process.env.RNSI_SESSION_FILE ?? options.sessionFile ?? defaultSessionFile(projectRoot);
  const stubFile = path.join(SHIM_DIR, "no-session.js");

  const resolver = config.resolver ?? {};
  const previousResolveRequest = resolver.resolveRequest;

  return {
    ...config,
    resolver: {
      ...resolver,
      resolveRequest(context, moduleName, platform) {
        // Composição, nunca substituição: respeita resolver custom do projeto.
        const fallback = (ctx, name, plat) =>
          previousResolveRequest
            ? previousResolveRequest(ctx, name, plat)
            : ctx.resolveRequest(ctx, name, plat);

        // Anti-loop: o shim importando o módulo real re-entra aqui.
        // Pedidos originados do diretório de shims resolvem sem interceptar.
        const fromShim =
          typeof context.originModulePath === "string" &&
          context.originModulePath.startsWith(SHIM_DIR);
        if (fromShim && moduleName !== SESSION_MODULE) {
          return fallback(context, moduleName, platform);
        }

        if (moduleName === SESSION_MODULE) {
          // A CLI escreve este arquivo ao subir. Sem ele, o shim vira no-op.
          return {
            type: "sourceFile",
            filePath: fs.existsSync(sessionFile) ? sessionFile : stubFile,
          };
        }

        // Release build é no-op absoluto: em bundle de produção o módulo
        // real passa direto. (Cinto: o guard de CI varre o bundle.)
        if (context.dev === false) {
          return fallback(context, moduleName, platform);
        }

        const shim = SHIM_TARGETS[moduleName];
        if (shim) {
          return { type: "sourceFile", filePath: path.join(SHIM_DIR, shim) };
        }

        return fallback(context, moduleName, platform);
      },
    },
  };
}

module.exports = { withStorageInspector, SHIM_TARGETS, SESSION_MODULE, SHIM_DIR };
