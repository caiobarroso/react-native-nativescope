"use strict";

/**
 * Wrapper do babelTransformerPath do Metro.
 *
 * Objetivo: injetar o boot do runtime (`__rnsi_boot__`) como dependência de um
 * módulo que **sempre está no grafo e roda antes do main** —
 * `react-native/.../Core/InitializeCore.js`, que o próprio RN lista em
 * getModulesRunBeforeMainModule. Assim o runtime sobe independente de qualquer
 * import de storage (o que o módulo de network precisa), sem tocar no código do
 * app.
 *
 * Por que não `getModulesRunBeforeMainModule` direto: aquele hook só REORDENA
 * módulos que já estão no grafo (ver getAppendScripts.js do Metro) — não injeta
 * um módulo novo. A única forma de colocar o boot no grafo sem editar o app é
 * torná-lo dependência de um módulo que já está lá.
 *
 * Tudo o mais é delegado, sem alteração, para o transformer upstream (expo/RN).
 *
 * Em produção NÃO injetamos nada. Antes a injeção era incondicional e o resolver
 * trocava `__rnsi_boot__` por um stub — mas aquele stub é um arquivo do PACOTE,
 * fora da árvore do projeto, e o Metro precisa hasheá-lo para colocar no grafo.
 * No export de release do CI isso quebrava com "Failed to get the SHA-1 for
 * .../metro/shims/no-config.js": o pacote entra por symlink e o caminho real
 * dependia de watchFolders ter pegado. Não injetar é mais simples e é uma
 * garantia mais forte do que um stub vazio — em bundle de produção não existe
 * NADA nosso a resolver.
 */

let upstreamCache = null;

function getUpstream() {
  if (upstreamCache) return upstreamCache;
  const candidates = [
    process.env.RNSI_UPSTREAM_BABEL_TRANSFORMER,
    "@expo/metro-config/build/babel-transformer",
    "@react-native/metro-babel-transformer",
    "metro-react-native-babel-transformer",
  ].filter(Boolean);

  for (const name of candidates) {
    try {
      upstreamCache = require(require.resolve(name, { paths: [process.cwd(), __dirname] }));
      break;
    } catch {
      /* tenta o próximo candidato */
    }
  }
  if (!upstreamCache) {
    // Aparece no terminal do Metro do usuário — inglês, e com o caminho de saída.
    throw new Error(
      "[nativescope] could not find the upstream babel transformer to delegate to. " +
        "Set RNSI_UPSTREAM_BABEL_TRANSFORMER to your project's babelTransformerPath, " +
        "or report it: https://github.com/caiobarroso/react-native-nativescope/issues",
    );
  }
  return upstreamCache;
}

/** InitializeCore do react-native — alvo estável, sempre no grafo, roda antes do main. */
const INITIALIZE_CORE = /[/\\]react-native[/\\]Libraries[/\\]Core[/\\]InitializeCore\.js$/;

function transform(params) {
  const upstream = getUpstream();
  // `options.dev` vem do Metro em toda transformação (metro-transform-worker
  // repassa as transform options ao transformer). Só `=== false` desliga: se o
  // campo faltasse, o comportamento seguro é o de dev.
  const isRelease = params.options?.dev === false;
  if (!isRelease && typeof params.src === "string" && INITIALIZE_CORE.test(params.filename || "")) {
    // Append (não prepend): roda DEPOIS do core do RN estar de pé — Platform e
    // afins já disponíveis — porém ainda antes do módulo principal do app.
    return upstream.transform({
      ...params,
      src: params.src + '\n;require("__rnsi_boot__");\n',
    });
  }
  return upstream.transform(params);
}

module.exports = {
  transform,
  getCacheKey(...args) {
    const upstream = getUpstream();
    const base =
      typeof upstream.getCacheKey === "function" ? String(upstream.getCacheKey(...args)) : "";
    // Bump próprio: garante que a mudança de comportamento invalide o cache do Metro.
    return base + "|rnsi-boot-inject-v2";
  },
};
