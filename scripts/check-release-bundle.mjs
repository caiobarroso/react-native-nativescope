#!/usr/bin/env node
/**
 * Guard de bundle de produção (plano §3.1 — inegociável).
 *
 * Vazar o shim para um bundle de release significa embrulhar as chamadas de
 * storage do app de alguém em produção: o pior bug possível deste projeto.
 * Todo arquivo de shim carrega o marcador __RNSI_SHIM__; este script varre
 * um bundle de release e falha se encontrá-lo.
 *
 * Uso:
 *   node scripts/check-release-bundle.mjs <caminho-do-bundle.js> [...mais]
 *
 * Gerando um bundle de release do playground para verificar:
 *   cd apps/playground && npx expo export --platform android
 *   node ../../scripts/check-release-bundle.mjs dist/_expo/static/js/android/*.js
 */
import { readFileSync } from "node:fs";

const MARKER = "__RNSI_SHIM__";
const bundles = process.argv.slice(2);

if (bundles.length === 0) {
  console.error("uso: check-release-bundle.mjs <bundle.js> [...mais]");
  process.exit(2);
}

let failed = false;
for (const bundlePath of bundles) {
  const content = readFileSync(bundlePath, "utf8");
  if (content.includes(MARKER)) {
    console.error(`✗ ${bundlePath}: marcador ${MARKER} encontrado — o shim vazou para o release!`);
    failed = true;
  } else {
    console.log(`✓ ${bundlePath}: limpo (${(content.length / 1024).toFixed(0)} KB varridos)`);
  }
}

process.exit(failed ? 1 : 0);
