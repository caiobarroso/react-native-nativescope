"use strict";

/**
 * Stub de config-ausente: resolvido no lugar de "__rnsi_config__" quando o
 * projeto não tem nenhum nativescope.config.
 *
 * A sentinela __rnsiConfigAbsent permite o runtime distinguir "nenhum config"
 * (default legado: storage ligado, retrocompat) de um config real vazio `{}`
 * (fonte da verdade: nada ligado). Ver modules.cjs → computeEnabledModules.
 */
module.exports = { __rnsiConfigAbsent: true };
