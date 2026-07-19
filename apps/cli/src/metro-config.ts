import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import type { DetectedProject } from "./detect.ts";

/**
 * Auto-configuração do Metro (plano P1: zero linhas manuais).
 *
 * Estratégias, na ordem:
 * 1. Já embrulhado → não toca.
 * 2. Sem metro.config.js → cria um mínimo para o flavor do projeto.
 * 3. metro.config.js simples → renomeia para metro.config.original.js e
 *    escreve um delegate que embrulha o original. Reversível: apagar o novo
 *    e renomear o original de volta.
 * 4. Variantes .cjs/.mjs/.ts → não arriscamos codemod: instruções claras.
 */
export type MetroConfigResult =
  | { status: "already-wrapped" }
  | { status: "created" }
  | { status: "wrapped"; originalBackup: string }
  | { status: "manual"; reason: string };

const ORIGINAL_NAME = "metro.config.original.js";

function delegateSource(): string {
  return `// Gerado por react-native-storage-inspector.
// Seu config original está em ${ORIGINAL_NAME} — para desfazer, apague este
// arquivo e renomeie o original de volta para metro.config.js.
const original = require("./${ORIGINAL_NAME}");
const { withStorageInspector } = require("react-native-storage-inspector/metro");

module.exports = withStorageInspector(original, { projectRoot: __dirname });
`;
}

function freshSource(flavor: DetectedProject["flavor"]): string {
  const base =
    flavor === "expo"
      ? `const { getDefaultConfig } = require("expo/metro-config");\nconst config = getDefaultConfig(__dirname);`
      : `const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");\nconst config = mergeConfig(getDefaultConfig(__dirname), {});`;
  return `// Gerado por react-native-storage-inspector.
const { withStorageInspector } = require("react-native-storage-inspector/metro");
${base}

module.exports = withStorageInspector(config, { projectRoot: __dirname });
`;
}

export function ensureMetroConfig(
  projectDir: string,
  flavor: DetectedProject["flavor"],
): MetroConfigResult {
  for (const variant of ["metro.config.cjs", "metro.config.mjs", "metro.config.ts"]) {
    if (existsSync(join(projectDir, variant))) {
      return {
        status: "manual",
        reason:
          `${variant} detectado — embrulhe manualmente:\n` +
          `  const { withStorageInspector } = require("react-native-storage-inspector/metro");\n` +
          `  module.exports = withStorageInspector(seuConfig, { projectRoot: __dirname });`,
      };
    }
  }

  const configPath = join(projectDir, "metro.config.js");

  if (!existsSync(configPath)) {
    writeFileSync(configPath, freshSource(flavor));
    return { status: "created" };
  }

  const source = readFileSync(configPath, "utf8");
  if (source.includes("withStorageInspector")) {
    return { status: "already-wrapped" };
  }

  const backupPath = join(projectDir, ORIGINAL_NAME);
  if (existsSync(backupPath)) {
    return {
      status: "manual",
      reason: `${ORIGINAL_NAME} já existe — resolva o estado do config antes de continuar.`,
    };
  }

  renameSync(configPath, backupPath);
  writeFileSync(configPath, delegateSource());
  return { status: "wrapped", originalBackup: ORIGINAL_NAME };
}

/**
 * Sobe o Metro do projeto como processo filho, com o arquivo de sessão no
 * ambiente. `expo start` para Expo, `react-native start` para bare.
 */
export function spawnMetro(
  projectDir: string,
  flavor: DetectedProject["flavor"],
  sessionFile: string,
): ChildProcess | null {
  const args =
    flavor === "expo" ? ["expo", "start"] : ["react-native", "start"];
  const child = spawn("npx", args, {
    cwd: projectDir,
    stdio: "inherit",
    env: { ...process.env, RNSI_SESSION_FILE: sessionFile },
  });
  child.on("error", () => {
    console.error("não consegui subir o Metro — rode o start do projeto manualmente.");
  });
  return child;
}
