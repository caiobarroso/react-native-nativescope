"use strict";

/**
 * Camada Node (fs) da resolução de config: descoberta e carga do
 * nativescope.config do disco, e cálculo de módulos habilitados para a CLI.
 *
 * Usada pelo resolver do Metro (withNativeScope.cjs) e pela CLI. NÃO é
 * importada pelo bootstrap do runtime — lá o config já vem carregado pelo Metro
 * (funciona até para .ts), e a regra pura vem de modules.cjs (computeEnabledModules).
 */

const fs = require("node:fs");
const path = require("node:path");
const { computeEnabledModules } = require("./modules.cjs");

/** Nomes de arquivo aceitos, em ordem de precedência. */
const CONFIG_CANDIDATES = [
  "nativescope.config.ts",
  "nativescope.config.tsx",
  "nativescope.config.js",
  "nativescope.config.cjs",
  "storage-inspector.config.ts",
  "storage-inspector.config.tsx",
  "storage-inspector.config.js",
  "storage-inspector.config.cjs",
  "rnsi.config.ts",
  "rnsi.config.tsx",
  "rnsi.config.js",
  "rnsi.config.cjs",
];

function findConfigFile(projectDir) {
  for (const candidate of CONFIG_CANDIDATES) {
    const filePath = path.join(projectDir, candidate);
    if (fs.existsSync(filePath)) return filePath;
  }
  return null;
}

/**
 * Carrega o objeto de config no contexto Node.
 *   - sem arquivo → { path: null, config: null, unreadable: false }
 *   - .js/.cjs   → require (resolve default export e função factory)
 *   - .ts/.tsx   → { unreadable: true } (a CLI não transpila TS; o gating real
 *                  acontece em runtime, onde o Metro já bundlou o config)
 */
function loadConfigObject(projectDir) {
  const configPath = findConfigFile(projectDir);
  if (!configPath) return { path: null, config: null, unreadable: false };
  if (/\.tsx?$/.test(configPath)) return { path: configPath, config: null, unreadable: true };

  try {
    const resolved = require.resolve(configPath);
    delete require.cache[resolved];
    const mod = require(resolved);
    const value = mod && (mod.default || mod);
    const config = typeof value === "function" ? value() : value;
    return { path: configPath, config, unreadable: false };
  } catch {
    return { path: configPath, config: null, unreadable: true };
  }
}

/**
 * Módulos habilitados no contexto Node (CLI → mensageria).
 *
 * Retorna { enabled, source, configPath, unreadable }. Para .ts ilegível assume
 * o default legado no texto, mas mantém configPath preenchido — a CLI usa isso
 * para NÃO imprimir o aviso de "sem config" quando há um config .ts.
 */
function resolveEnabledModules(projectDir) {
  const { path: configPath, config, unreadable } = loadConfigObject(projectDir);
  const base = computeEnabledModules(unreadable ? null : config);
  return { ...base, configPath, unreadable };
}

module.exports = {
  CONFIG_CANDIDATES,
  findConfigFile,
  loadConfigObject,
  resolveEnabledModules,
};
