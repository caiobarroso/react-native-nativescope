import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createConnection } from "node:net";

/**
 * Porta do Metro — não a nossa (essa é a do Studio, DEFAULT_PORT).
 *
 * O Metro moderno escolhe uma porta livre quando a preferida está ocupada.
 * Isso é conveniente para o bundler, mas perigoso para NativeScope: o app
 * pode carregar o bundle de um Metro e a CLI instrumentar outro. Por isso a
 * CLI resolve e passa a porta explicitamente ao processo filho.
 */

export const METRO_DEFAULT_PORT = 8081;
const DEFAULT_PORT_SCAN_LIMIT = 20;

function validPort(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const parsed = Number(raw.trim());
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536
    ? parsed
    : null;
}

function isTruthyEnv(raw: string | undefined): boolean {
  return raw !== undefined && /^(1|true|yes|on)$/i.test(raw.trim());
}

/** Lê apenas RCT_METRO_PORT; não tenta reimplementar todo o dotenv. */
function readMetroPortFromEnvFile(path: string): string | undefined {
  if (!existsSync(path)) return undefined;

  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = line.match(
        /^\s*(?:export\s+)?RCT_METRO_PORT\s*=\s*(.*?)\s*$/,
      );
      if (!match) continue;

      let value = match[1] ?? "";
      const quoted = value.match(/^(["'])(.*?)\1(?:\s+#.*)?$/);
      if (quoted) {
        value = quoted[2] ?? "";
      } else {
        value = value.split(/\s+#/, 1)[0]?.trim() ?? "";
      }
      return value;
    }
  } catch {
    // A missing/unreadable env file should not prevent the CLI from starting.
  }
  return undefined;
}

/**
 * Resolve the same project-level RCT_METRO_PORT that Expo can load from its
 * dotenv files. A value already present in the shell always wins.
 */
export function resolveMetroPort(
  projectDir: string,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const fromProcess = env.RCT_METRO_PORT;
  if (fromProcess !== undefined)
    return validPort(fromProcess) ?? METRO_DEFAULT_PORT;
  if (isTruthyEnv(env.EXPO_NO_DOTENV)) return METRO_DEFAULT_PORT;

  const mode = env.NODE_ENV?.trim() || "development";
  const envFiles =
    mode === "test"
      ? [".env.test.local", ".env.test", ".env"]
      : [`.env.${mode}.local`, ".env.local", `.env.${mode}`, ".env"];
  for (const file of envFiles) {
    const raw = readMetroPortFromEnvFile(join(projectDir, file));
    if (raw !== undefined) return validPort(raw) ?? METRO_DEFAULT_PORT;
  }

  return METRO_DEFAULT_PORT;
}

function probeHost(
  port: number,
  host: string,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });
    let settled = false;

    const finish = (inUse: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(inUse);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

/**
 * Alguém está servindo nesta porta? A checagem cobre os dois loopbacks porque
 * um processo que escuta apenas em ::1 não aceita conexões em 127.0.0.1.
 * Recusa, erro e timeout contam como livre: na dúvida, deixamos o Metro
 * tentar e reportar o erro real.
 */
export async function isPortInUse(
  port: number,
  options: { host?: string | readonly string[]; timeoutMs?: number } = {},
): Promise<boolean> {
  const hosts = options.host
    ? typeof options.host === "string"
      ? [options.host]
      : options.host
    : ["127.0.0.1", "::1"];
  const timeoutMs = options.timeoutMs ?? 500;

  for (const host of hosts) {
    if (await probeHost(port, host, timeoutMs)) return true;
  }
  return false;
}

/**
 * Escolhe uma porta livre para o Metro que NativeScope vai iniciar. A busca é
 * limitada para não transformar um projeto com muitas portas ocupadas em um
 * loop infinito. `probe` existe para tornar a política determinística nos
 * testes. A sonda não reserva a porta; se outro processo ganhar a corrida,
 * o Metro recebe a porta explícita e o handler de saída reporta o erro real.
 */
export async function findFreeMetroPort(
  startPort: number,
  options: {
    maxAttempts?: number;
    probe?: (port: number) => Promise<boolean>;
  } = {},
): Promise<number | null> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_PORT_SCAN_LIMIT;
  const probe = options.probe ?? ((port: number) => isPortInUse(port));

  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const port = startPort + offset;
    if (port > 65535) return null;
    if (!(await probe(port))) return port;
  }
  return null;
}
