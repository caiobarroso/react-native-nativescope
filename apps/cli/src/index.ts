import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { DEFAULT_PORT } from "@rnsi/protocol";
import { detectProject } from "./detect.ts";
import { startLocalServer } from "./server.ts";
import { startFakeRuntime } from "./fake-runtime.ts";
import { ensureMetroConfig, spawnMetro } from "./metro-config.ts";

const args = process.argv.slice(2);

function flag(name: string): boolean {
  return args.includes(`--${name}`);
}

function option(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function findUiDir(): string | null {
  const override = process.env["RNSI_UI_DIR"];
  if (override && existsSync(override)) return resolve(override);

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "..", "desktop", "dist"), // monorepo, rodando de src/
    join(here, "..", "..", "..", "desktop", "dist"), // monorepo, rodando de dist/
    join(here, "..", "ui"), // pacote publicado: UI embarcada
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "index.html"))) return resolve(candidate);
  }
  return null;
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  execFile(cmd, [url], () => {
    /* se falhar, a URL já foi impressa */
  });
}

/**
 * Sessão para o shim do Metro: porta + token viram um módulo JS bundlável,
 * resolvido pelo withStorageInspector como "__rnsi_session__".
 */
function writeSessionFile(projectDir: string, port: number, token: string): void {
  try {
    const dir = join(projectDir, "node_modules", ".cache", "rnsi");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "session.js"),
      `"use strict";\nmodule.exports = ${JSON.stringify({ port, token })};\n`,
    );
  } catch {
    /* sem node_modules ainda: o shim vira no-op, nada quebra */
  }
}

function tryAdbReverse(port: number): void {
  // Best-effort: emulador/device Android via USB passa a alcançar 127.0.0.1.
  execFile("adb", ["reverse", `tcp:${port}`, `tcp:${port}`], () => {
    /* sem adb ou sem device: silêncio — iOS Simulator não precisa */
  });
}

async function main(): Promise<void> {
  const port = Number(option("port") ?? DEFAULT_PORT);
  const sessionToken = option("token") ?? randomBytes(16).toString("hex");

  if (args[0] === "fake-runtime") {
    // Uso interno/testes: conecta um app falso num serviço já de pé.
    startFakeRuntime({ port, sessionToken });
    console.log(`fake-runtime conectando em ws://127.0.0.1:${port}`);
    return;
  }

  const projectDir = resolve(option("project") ?? process.cwd());
  const project = detectProject(projectDir);
  const uiDir = findUiDir();

  console.log("");
  console.log("React Native Storage Inspector");
  console.log("");
  console.log(`Projeto: ${project.name}`);
  if (project.providers.length > 0) {
    console.log("Detectado no package.json:");
    for (const p of project.providers) console.log(`  ✓ ${p.label}`);
  } else {
    console.log("Nenhum storage conhecido no package.json (MMKV, AsyncStorage, expo-sqlite).");
  }

  await startLocalServer({
    port,
    sessionToken,
    uiDir,
    project,
    log: (line) => console.log(line),
  });

  writeSessionFile(projectDir, port, sessionToken);
  tryAdbReverse(port);

  // Zero config: garante o wrap do Metro e sobe o Metro do projeto junto.
  const isAppProject = project.flavor !== "unknown";
  if (isAppProject && !flag("fake")) {
    const metroResult = ensureMetroConfig(projectDir, project.flavor);
    if (metroResult.status === "created") {
      console.log("metro.config.js criado com o inspector já aplicado.");
    } else if (metroResult.status === "wrapped") {
      console.log(
        `metro.config.js embrulhado (original preservado em ${metroResult.originalBackup}).`,
      );
    } else if (metroResult.status === "manual") {
      console.log("");
      console.log(metroResult.reason);
    }

    if (!flag("no-metro") && metroResult.status !== "manual") {
      const sessionFile = join(projectDir, "node_modules", ".cache", "rnsi", "session.js");
      spawnMetro(projectDir, project.flavor, sessionFile);
    }
  }

  const url = `http://127.0.0.1:${port}/?token=${sessionToken}`;
  console.log("");
  console.log(`Serviço local: ws://127.0.0.1:${port}`);
  console.log(`Studio: ${url}`);
  console.log("");

  if (flag("fake")) {
    startFakeRuntime({ port, sessionToken });
    console.log("(--fake: runtime simulado conectado)");
  }

  if (!flag("no-open")) openBrowser(url);
}

main().catch((error: Error) => {
  console.error(`erro: ${error.message}`);
  process.exit(1);
});
