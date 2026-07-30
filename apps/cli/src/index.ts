import { networkInterfaces } from "node:os";
import { basename, resolve } from "node:path";
import { execFile, type ChildProcess } from "node:child_process";
import { DEFAULT_PORT } from "@rnsi/protocol";
import { detectProject, KNOWN_PROVIDER_LABELS, type DetectedProject } from "./detect.ts";
import { runInit } from "./init.ts";
import { MODULES, resolveEnabledModules } from "./modules-cli.ts";
import { startLocalServer } from "./server.ts";
import { startFakeRuntime } from "./fake-runtime.ts";
import { ensureMetroConfig, spawnMetro } from "./metro-config.ts";
import { startAdbWatcher } from "./android.ts";
import {
  removeSessionFile,
  resolveSessionToken,
  writeSessionFile,
} from "./session-token.ts";
import { createShutdown } from "./shutdown.ts";
import { findUiDir } from "./ui-dir.ts";
import { HELP_TEXT } from "./help.ts";

const args = process.argv.slice(2);

function flag(name: string): boolean {
  return args.includes(`--${name}`);
}

function option(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  execFile(cmd, [url], () => {
    /* se falhar, a URL já foi impressa */
  });
}

/** Primeiro IPv4 não-interno — usado só para imprimir a URL de LAN. */
function lanIp(): string | null {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4" && !addr.internal) return addr.address;
    }
  }
  return null;
}

/**
 * Túnel Android contínuo: reaplica `adb reverse` quando um device é plugado
 * depois, o cabo cai, ou o adb server reinicia — e reporta problemas
 * (mais de um device, depuração não autorizada) em vez de falhar em
 * silêncio. iOS Simulator não precisa de nada disso.
 */
function watchAndroid(port: number): () => void {
  return startAdbWatcher(port, (state) => {
    if (!state.available) return; // sem adb no PATH: irrelevante fora do Android
    if (state.problem) {
      console.log(`android: ${state.problem}`);
    } else if (state.reversed.length > 0) {
      console.log(
        `android: adb reverse active (${state.reversed.length} device${state.reversed.length > 1 ? "s" : ""})`,
      );
    }
  });
}

/**
 * Estado de módulos no terminal. Foco: deixar EXTREMAMENTE claro o que o
 * usuário deve fazer — sem quebrar quem já tem a lib e nunca criou config.
 */
function printModuleStatus(projectDir: string, project: DetectedProject): void {
  const result = resolveEnabledModules(projectDir);
  console.log("");

  if (result.configPath) {
    console.log(`Config: ${basename(result.configPath)}`);
    if (result.unreadable) {
      // .ts: a CLI não avalia; o gating real acontece em runtime.
      console.log("Modules: resolved at runtime (TypeScript config).");
      return;
    }
    const on = MODULES.filter((m) => result.enabled[m.key]);
    if (on.length > 0) {
      console.log("Modules enabled:");
      for (const m of on) console.log(`  ✓ ${m.label}`);
    } else {
      console.log("No modules enabled in your config.");
      console.log(
        "  Turn some on: edit the config or run `npx nativescope init`.",
      );
    }
    return;
  }

  // Sem config: comportamento de hoje preservado (storage on) + o que fazer.
  if (project.providers.length > 0) {
    console.log(
      "⚠ No nativescope.config found — running with defaults (Storage on).",
    );
    console.log(
      "  NativeScope is becoming modular and opt-in. To choose exactly",
    );
    console.log("  which modules you want (and silence this notice):");
    console.log("");
    console.log("      npx nativescope init");
    console.log("");
    console.log(
      "  Nothing changes today. Explicit config will be required in a future major.",
    );
  } else {
    console.log(
      "No storage dependency detected and no nativescope.config found.",
    );
    console.log("  Get started:  npx nativescope init");
  }
}

async function main(): Promise<void> {
  if (flag("help") || args.includes("-h")) {
    process.stdout.write(HELP_TEXT);
    return;
  }

  const port = Number(option("port") ?? DEFAULT_PORT);
  const projectDir = resolve(option("project") ?? process.cwd());
  // Estável por projeto: reiniciar a CLI não invalida a aba do Studio já aberta
  // nem o bundle já carregado no device. Ver session-token.ts.
  const { token: sessionToken } = resolveSessionToken(projectDir, {
    override: option("token"),
    fresh: flag("new-token"),
  });
  // Opt-in: expõe o serviço na LAN para conectar iPhone físico na mesma Wi-Fi.
  const lan = flag("lan");

  if (args[0] === "fake-runtime") {
    // Uso interno/testes: conecta um app falso num serviço já de pé. Com
    // --platform ios (+ um `--fake` android noutro terminal) testa multi-device.
    const platform = option("platform");
    const deviceId = option("device-id");
    startFakeRuntime({
      port,
      sessionToken,
      scale: flag("fake-scale"),
      ...(platform ? { platform } : {}),
      ...(deviceId ? { deviceId } : {}),
    });
    console.log(
      `fake-runtime (${platform ?? "android"}) connecting to ws://127.0.0.1:${port}`,
    );
    return;
  }

  if (args[0] === "init") {
    await runInit(projectDir, { force: flag("force"), yes: flag("yes") });
    return;
  }

  const project = detectProject(projectDir);
  const uiDir = findUiDir();

  console.log("");
  console.log("NativeScope");
  console.log("");
  console.log(`Project: ${project.name}`);
  if (project.providers.length > 0) {
    console.log("Detected in package.json:");
    for (const p of project.providers) console.log(`  ✓ ${p.label}`);
  } else {
    console.log(
      `No supported storage dependency found in package.json (${KNOWN_PROVIDER_LABELS}).`,
    );
  }

  printModuleStatus(projectDir, project);

  const service = await startLocalServer({
    port,
    sessionToken,
    uiDir,
    project,
    log: (line) => console.log(line),
    host: lan ? "0.0.0.0" : "127.0.0.1",
  });

  const session = writeSessionFile(projectDir, {
    port,
    token: sessionToken,
    lan,
  });
  const stopAdbWatcher = watchAndroid(port);

  let metro: ChildProcess | null = null;

  // Encerramento ordenado: sem isto o processo sobrevivia ao Ctrl+C que o Expo
  // consome como tecla, e seguia segurando o terminal, a porta e o watcher.
  const shutdown = createShutdown({
    steps: [
      { name: "adb", run: stopAdbWatcher },
      { name: "service", run: () => service.close() },
      // Sessão fora do disco: sem ela, um `expo start` posterior embutiria
      // porta e token mortos e o app tentaria reconectar para sempre.
      { name: "session", run: () => removeSessionFile(session) },
      {
        name: "metro",
        run: () => {
          if (metro && metro.exitCode === null && !metro.killed)
            metro.kill("SIGTERM");
        },
      },
    ],
    exit: (code) => process.exit(code),
    onStepError: (name, error) =>
      console.error(
        `shutdown: ${name} failed (${error instanceof Error ? error.message : String(error)})`,
      ),
  });

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));

  // Zero config: garante o wrap do Metro e sobe o Metro do projeto junto.
  const isAppProject = project.flavor !== "unknown";
  if (isAppProject && !flag("fake")) {
    const metroResult = ensureMetroConfig(projectDir, project.flavor);
    if (metroResult.status === "created") {
      console.log("Created metro.config.js with NativeScope enabled.");
    } else if (metroResult.status === "wrapped") {
      console.log(
        `Wrapped metro.config.js (original preserved as ${metroResult.originalBackup}).`,
      );
    } else if (metroResult.status === "manual") {
      console.log("");
      console.log(metroResult.reason);
    }

    if (!flag("no-metro") && metroResult.status !== "manual" && session) {
      metro = spawnMetro(projectDir, project.flavor, session.path);
      // O Metro morrendo (inclusive pelo Ctrl+C que o Expo trata como tecla,
      // sem sinal nenhum chegar aqui) encerra a CLI junto: o terminal volta ao
      // prompt em vez de ficar com um serviço órfão logando sozinho.
      metro?.on("exit", () => {
        console.log("Metro stopped — shutting down NativeScope.");
        shutdown(0);
      });
    }
  }

  const url = `http://127.0.0.1:${port}/?token=${sessionToken}`;
  console.log("");
  console.log(`Local service: ws://127.0.0.1:${port}`);
  console.log(`Studio: ${url}`);
  if (lan) {
    const ip = lanIp();
    console.log("");
    console.log(
      "LAN mode (--lan): a physical iPhone on the same Wi-Fi can connect.",
    );
    if (ip) console.log(`  The app reaches the service at ws://${ip}:${port}`);
    console.log(
      "  ⚠ Reachable on your local network, gated only by the session token — use on trusted networks only.",
    );
    console.log(
      "  The token persists across runs (node_modules/.cache/rnsi/token); rotate it with --new-token.",
    );
    console.log("  (Android and the iOS Simulator keep using loopback.)");
  }
  console.log("");

  if (flag("fake")) {
    const scale = flag("fake-scale");
    startFakeRuntime({ port, sessionToken, scale });
    console.log(
      scale
        ? "(--fake --fake-scale: simulated runtime with 100k rows and MB-sized values)"
        : "(--fake: simulated runtime connected)",
    );
  }

  if (!flag("no-open")) openBrowser(url);
}

main().catch((error: Error) => {
  console.error(`error: ${error.message}`);
  process.exit(1);
});
