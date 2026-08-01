"use strict";

/**
 * Manifesto de módulos do NativeScope + a regra ÚNICA de habilitação.
 *
 * Puro de propósito (sem node:fs/path, sem RN): é importado nos TRÊS contextos —
 * resolver do Metro (Node), CLI (Node) e bootstrap do runtime (React Native).
 * Qualquer dependência de plataforma quebraria um deles.
 *
 * Fonte da verdade única para:
 *   - o menu do `nativescope init`,
 *   - a mensageria de terminal,
 *   - o gating opt-in em runtime.
 *
 * Para plugar um módulo novo (ex.: network), adicione uma entrada em MODULES.
 * Ela passa a aparecer no init e a ser respeitada no gating automaticamente.
 */

const MODULES = [
  {
    key: "storage",
    label: "Storage inspector",
    description: "AsyncStorage, MMKV, expo-sqlite, op-sqlite",
    // Storage se auto-instala nos próprios shims quando a lib é importada, então
    // não precisa do boot antecipado. Ver _bootstrap.js.
    earlyBoot: false,
    available: true,
    // Trecho inserido pelo `nativescope init` dentro de `modules: { ... }`.
    configTemplate: "storage: true,",
  },
  {
    key: "network",
    label: "Network inspector",
    description: "fetch / XHR requests",
    // Precisa subir ANTES do app para instrumentar o XMLHttpRequest global
    // (o fetch do RN roda sobre XHR). Ver _bootstrap.js → MODULE_INSTALLERS.
    earlyBoot: true,
    available: true,
    configTemplate: "network: true,",
  },
  {
    key: "logs",
    label: "Logs",
    description: "console.*, exceptions e rejections",
    // Precisa subir ANTES do app para instrumentar o `console` global e não
    // perder os logs de startup — que são justamente os mais difíceis de ver.
    earlyBoot: true,
    available: true,
    configTemplate: "logs: true,",
  },
];

const MODULE_KEYS = MODULES.map((m) => m.key);

/**
 * Sentinela exportada pelo stub de config-ausente (shims/no-config.js). Permite
 * distinguir "nenhum config no projeto" (default legado: storage ligado) de um
 * config real vazio `{}` (fonte da verdade: nada ligado) — os dois seriam `{}`
 * sem a sentinela.
 */
const NO_CONFIG_SENTINEL = "__rnsiConfigAbsent";

function isModuleValueEnabled(value) {
  // `true` ou um objeto de config (ex.: { indicator: true }) ligam o módulo.
  // `false`/`undefined`/`null` desligam.
  if (value === true) return true;
  return typeof value === "object" && value !== null;
}

/**
 * Regra única de habilitação a partir de um objeto de config já carregado.
 *
 *  - config ausente (null/undefined ou a sentinela) → default LEGADO: só storage
 *    ligado. É a retrocompatibilidade — quem já tem a lib e nunca criou config
 *    continua funcionando.
 *  - config presente → fonte da verdade: cada módulo liga só se declarado em
 *    `modules.<key>` (opt-in). Módulo não-listado = desligado.
 *
 * Retorna { enabled: { [key]: boolean }, source: "legacy-default" | "config" }.
 */
function computeEnabledModules(config) {
  const absent = !config || config[NO_CONFIG_SENTINEL] === true;
  const enabled = {};

  if (absent) {
    for (const key of MODULE_KEYS) enabled[key] = key === "storage";
    return { enabled, source: "legacy-default" };
  }

  const modules = (config && config.modules) || {};
  for (const key of MODULE_KEYS) enabled[key] = isModuleValueEnabled(modules[key]);
  return { enabled, source: "config" };
}

module.exports = {
  MODULES,
  MODULE_KEYS,
  NO_CONFIG_SENTINEL,
  isModuleValueEnabled,
  computeEnabledModules,
};
