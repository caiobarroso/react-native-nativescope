import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/**
 * Ponte para o manifesto de módulos e a resolução de config, que vivem em
 * metro/*.cjs (compartilhados com o resolver e o runtime). Carregados em
 * runtime via createRequire — NÃO bundlados pelo esbuild — para reusar a MESMA
 * fonte da verdade em vez de duplicar a regra aqui. O caminho relativo resolve
 * igual em dev (src/index.ts → ../metro) e no build (dist/cli.mjs → ../metro).
 */
const requireCjs = createRequire(import.meta.url);

export interface ModuleManifestEntry {
  key: string;
  label: string;
  description: string;
  earlyBoot: boolean;
  available: boolean;
  configTemplate: string;
}

export interface EnabledModulesResult {
  enabled: Record<string, boolean>;
  source: "legacy-default" | "config";
  configPath: string | null;
  unreadable: boolean;
}

function loadCjs<T>(relative: string): T {
  return requireCjs(fileURLToPath(new URL(relative, import.meta.url))) as T;
}

const { MODULES } = loadCjs<{ MODULES: ModuleManifestEntry[] }>("../metro/modules.cjs");
const { resolveEnabledModules } = loadCjs<{
  resolveEnabledModules: (projectDir: string) => EnabledModulesResult;
}>("../metro/module-config.cjs");

export { MODULES, resolveEnabledModules };

/** Só os módulos que existem hoje (a IA de network marca `available: true`). */
export function availableModules(): ModuleManifestEntry[] {
  return MODULES.filter((m) => m.available);
}

export function moduleLabel(key: string): string {
  return MODULES.find((m) => m.key === key)?.label ?? key;
}
