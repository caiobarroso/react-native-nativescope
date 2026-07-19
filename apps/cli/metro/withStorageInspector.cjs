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
const APP_DIR = path.join(__dirname, "..", "app");

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

  // Instalado via file:/link:, o pacote é um symlink e os shims vivem FORA
  // do projeto. Duas consequências no Metro:
  // 1. watchFolders precisa incluir a raiz real do pacote, senão o Metro
  //    se recusa a servir os arquivos de shim;
  // 2. nodeModulesPaths precisa incluir o node_modules do projeto, senão o
  //    require() do módulo real feito de dentro do shim não resolve.
  const packageRoot = path.join(__dirname, "..");

  return {
    ...config,
    watchFolders: [...(config.watchFolders ?? []), packageRoot],
    resolver: {
      ...resolver,
      nodeModulesPaths: [
        ...(resolver.nodeModulesPaths ?? []),
        path.join(projectRoot, "node_modules"),
      ],
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

        // react-native-storage-inspector/app referencia libs de storage que
        // o projeto pode não ter (ex.: app MMKV-only usando só o hook de
        // MMKV). O Metro resolve TODO require literal no bundle — sem este
        // stub, a ausência de uma lib quebraria o build inteiro.
        const fromAppApi =
          typeof context.originModulePath === "string" &&
          context.originModulePath.startsWith(APP_DIR);
        if (fromAppApi && SHIM_TARGETS[moduleName]) {
          try {
            // Só prova que o módulo existe. Existindo, segue o fluxo normal
            // abaixo — o /app precisa do SHIM em dev, senão escritas feitas
            // pelos hooks não seriam instrumentadas.
            fallback(context, moduleName, platform);
          } catch {
            return { type: "sourceFile", filePath: path.join(SHIM_DIR, "missing-module.js") };
          }
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

module.exports = { withStorageInspector, SHIM_TARGETS, SESSION_MODULE, SHIM_DIR, APP_DIR };
