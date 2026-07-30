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
 *   const { withNativeScope } = require("react-native-nativescope/metro");
 *   module.exports = withNativeScope(config);
 */

const path = require("node:path");
const fs = require("node:fs");
const { CONFIG_CANDIDATES, findConfigFile } = require("./module-config.cjs");

const SHIM_DIR = path.join(__dirname, "shims");
const APP_DIR = path.join(__dirname, "..", "app");

/** módulo interceptado → arquivo de shim */
const SHIM_TARGETS = {
  "@react-native-async-storage/async-storage": "async-storage.js",
  "@tanstack/react-query": "react-query.js",
  "react-native-mmkv": "mmkv.js",
  "expo-sqlite": "expo-sqlite.js",
  "@op-engineering/op-sqlite": "op-sqlite.js",
};

/** módulo virtual que entrega porta+token da sessão ao shim */
const SESSION_MODULE = "__rnsi_session__";

/** módulo virtual que entrega a configuração plug-and-play do projeto */
const CONFIG_MODULE = "__rnsi_config__";

/**
 * Módulo virtual do boot do runtime. Independente de storage: é o que permite
 * módulos como network subirem sem nenhum import de lib de storage. O
 * babel-transformer.cjs o torna dependência do InitializeCore (sempre no grafo,
 * roda antes do main). Resolve para o boot real em dev e para um stub vazio em
 * prod (no-op absoluto — runtime-bundle nunca entra no bundle de produção).
 */
const BOOT_MODULE = "__rnsi_boot__";

/** módulos singleton que devem vir sempre do app consumidor */
const APP_SINGLETONS = new Set(["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-native"]);

function defaultSessionFile(projectRoot) {
  return path.join(projectRoot, "node_modules", ".cache", "rnsi", "session.js");
}

function withNativeScope(config, options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const sessionFile =
    process.env.RNSI_SESSION_FILE ?? options.sessionFile ?? defaultSessionFile(projectRoot);
  const stubFile = path.join(SHIM_DIR, "no-session.js");
  const configStubFile = path.join(SHIM_DIR, "no-config.js");

  const resolver = config.resolver ?? {};
  const previousResolveRequest = resolver.resolveRequest;

  // Instalado via file:/link:, o pacote é um symlink e os shims vivem FORA
  // do projeto. Duas consequências no Metro:
  // 1. watchFolders precisa incluir a raiz real do pacote, senão o Metro
  //    se recusa a servir os arquivos de shim;
  // 2. nodeModulesPaths precisa incluir o node_modules do projeto, senão o
  //    require() do módulo real feito de dentro do shim não resolve.
  const packageRoot = path.join(__dirname, "..");
  const projectNodeModules = path.join(projectRoot, "node_modules");

  function resolveFromProject(moduleName) {
    return require.resolve(moduleName, {
      paths: [projectNodeModules, projectRoot, process.cwd()],
    });
  }

  // Injeção do boot do runtime, independente de storage: um wrapper do
  // babelTransformerPath torna "__rnsi_boot__" dependência do InitializeCore
  // (sempre no grafo, roda antes do main). Ver babel-transformer.cjs. O caminho
  // original é passado via env para o wrapper delegar exatamente a ele nos
  // workers do Metro (forkados depois deste ponto, herdando o env).
  const upstreamBabelTransformer = config.transformer?.babelTransformerPath;
  if (upstreamBabelTransformer) {
    process.env.RNSI_UPSTREAM_BABEL_TRANSFORMER = upstreamBabelTransformer;
  }

  return {
    ...config,
    watchFolders: [...(config.watchFolders ?? []), packageRoot],
    transformer: {
      ...(config.transformer ?? {}),
      babelTransformerPath: path.join(__dirname, "babel-transformer.cjs"),
    },
    resolver: {
      ...resolver,
      nodeModulesPaths: [
        ...(resolver.nodeModulesPaths ?? []),
        projectNodeModules,
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
        if (
          fromShim &&
          moduleName !== SESSION_MODULE &&
          moduleName !== CONFIG_MODULE &&
          moduleName !== BOOT_MODULE
        ) {
          return fallback(context, moduleName, platform);
        }

        // react-native-nativescope/app referencia libs de storage que
        // o projeto pode não ter (ex.: app MMKV-only usando só o hook de
        // MMKV). O Metro resolve TODO require literal no bundle — sem este
        // stub, a ausência de uma lib quebraria o build inteiro.
        const fromAppApi =
          typeof context.originModulePath === "string" &&
          context.originModulePath.startsWith(APP_DIR);
        if (fromAppApi && APP_SINGLETONS.has(moduleName)) {
          try {
            return { type: "sourceFile", filePath: resolveFromProject(moduleName) };
          } catch {
            return fallback(context, moduleName, platform);
          }
        }

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

        if (moduleName === CONFIG_MODULE) {
          return {
            type: "sourceFile",
            filePath: findConfigFile(projectRoot) ?? configStubFile,
          };
        }

        if (moduleName === BOOT_MODULE) {
          // Prod: MÓDULO VAZIO, não um arquivo. O valor deste require é
          // descartado (`;require("__rnsi_boot__");`), então não há nada a
          // exportar — e resolver para um arquivo do pacote obrigaria o Metro a
          // hasheá-lo, num caminho fora da árvore do projeto. Era o que
          // derrubava o export de release no CI. Com o transformer não injetando
          // em release, este ramo é cinto: se outro transformer injetar o boot,
          // o build de produção segue, sem instrumentação e sem quebrar.
          if (context.dev === false) return { type: "empty" };
          return { type: "sourceFile", filePath: path.join(SHIM_DIR, "_boot.js") };
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

module.exports = {
  withNativeScope,
  SHIM_TARGETS,
  SESSION_MODULE,
  CONFIG_MODULE,
  BOOT_MODULE,
  CONFIG_CANDIDATES,
  SHIM_DIR,
  APP_DIR,
};
