"use strict";

/**
 * Boot do runtime independente de storage (marcador: __RNSI_SHIM__).
 *
 * Resolvido a partir do módulo virtual "__rnsi_boot__" — que o
 * babel-transformer.cjs torna dependência do InitializeCore do React Native
 * (sempre no grafo, roda ANTES do módulo principal do app). Isso permite a
 * módulos como network instrumentarem globals (fetch/XHR) antes do primeiro
 * request, sem depender de nenhum import de lib de storage.
 *
 * Em produção o resolver troca "__rnsi_boot__" por um stub vazio, então nada
 * disto entra no bundle de release (verificado no bundle: runtime-bundle
 * ausente em prod).
 */
const bootstrap = require("./_bootstrap.js");

// bootModules() sobe o runtime e chama os installers dos módulos com earlyBoot
// que estiverem ligados no config (ex.: network). É no-op para storage, que se
// auto-instala nos próprios shims. Guardado porque a Fase 3 é quem o adiciona.
if (typeof bootstrap.bootModules === "function") {
  bootstrap.bootModules();
}
