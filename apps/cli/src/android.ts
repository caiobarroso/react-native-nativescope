import { execFile } from "node:child_process";

/**
 * Ponte com o Android via adb.
 *
 * `adb reverse tcp:P tcp:P` faz o localhost do device apontar para o
 * localhost da máquina — é o mesmo mecanismo que o Metro usa na 8081, e
 * funciona igual em emulador e em device físico por USB.
 *
 * Rodar isso uma vez no boot da CLI não basta: o device pode ser plugado
 * depois, o cabo pode cair, o device pode reiniciar e o adb server pode
 * ser derrubado. Por isso aqui existe um watcher que reaplica — e que
 * reporta o que aconteceu, em vez de falhar em silêncio.
 */

export interface AdbState {
  /** false quando o binário adb não existe no PATH. */
  available: boolean;
  /** seriais dos devices prontos (exclui unauthorized/offline). */
  devices: string[];
  /** seriais onde o reverse está aplicado. */
  reversed: string[];
  /** motivo legível quando algo impede o túnel. */
  problem: string | null;
}

export const EMPTY_ADB_STATE: AdbState = {
  available: false,
  devices: [],
  reversed: [],
  problem: null,
};

function run(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile("adb", args, { timeout: 5000 }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: String(stdout), stderr: String(stderr || error?.message || "") });
    });
  });
}

/**
 * Extrai os seriais prontos da saída de `adb devices`.
 * Ignora cabeçalho, linhas vazias, e estados que não são `device`
 * (`unauthorized` = falta autorizar o depuração USB na tela; `offline`).
 */
export function parseDevices(stdout: string): { ready: string[]; unauthorized: string[] } {
  const ready: string[] = [];
  const unauthorized: string[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("List of devices")) continue;
    const [serial, state] = trimmed.split(/\s+/);
    if (!serial || !state) continue;
    if (state === "device") ready.push(serial);
    else if (state === "unauthorized") unauthorized.push(serial);
  }
  return { ready, unauthorized };
}

/** Uma varredura: lista devices e aplica o reverse em cada um. */
export async function applyReverse(port: number): Promise<AdbState> {
  const listing = await run(["devices"]);
  if (!listing.ok) {
    const missing = /ENOENT|not found/i.test(listing.stderr);
    return {
      available: !missing,
      devices: [],
      reversed: [],
      problem: missing
        ? "adb was not found in PATH. Install Android SDK Platform Tools (Android only)."
        : `adb failed: ${listing.stderr.trim()}`,
    };
  }

  const { ready, unauthorized } = parseDevices(listing.stdout);

  if (ready.length === 0) {
    return {
      available: true,
      devices: [],
      reversed: [],
      problem:
        unauthorized.length > 0
          ? "A connected device is not authorized. Accept USB debugging on the device."
          : null,
    };
  }

  // -s por device: sem isso, com emulador + físico juntos o adb recusa
  // com "more than one device/emulator".
  const reversed: string[] = [];
  const failures: string[] = [];
  for (const serial of ready) {
    const result = await run(["-s", serial, "reverse", `tcp:${port}`, `tcp:${port}`]);
    if (result.ok) reversed.push(serial);
    else failures.push(`${serial}: ${result.stderr.trim()}`);
  }

  return {
    available: true,
    devices: ready,
    reversed,
    problem: failures.length > 0 ? `adb reverse failed: ${failures.join("; ")}` : null,
  };
}

/**
 * Reaplica o reverse periodicamente e chama `onChange` quando o estado
 * muda de verdade (evita poluir o terminal a cada varredura).
 */
export function startAdbWatcher(
  port: number,
  onChange: (state: AdbState) => void,
  intervalMs = 3000,
): () => void {
  let previous = "";
  let stopped = false;
  let ticking = false;

  const tick = async (): Promise<void> => {
    if (stopped || ticking) return;
    ticking = true;
    try {
      const state = await applyReverse(port);
      if (stopped) return;
      const fingerprint = JSON.stringify(state);
      if (fingerprint !== previous) {
        previous = fingerprint;
        onChange(state);
      }
    } finally {
      ticking = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
