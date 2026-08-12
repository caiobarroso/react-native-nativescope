import type { DetectedProject } from "./detect.ts";

/**
 * Tudo que a CLI fala sobre o Metro, em um lugar só.
 *
 * O Metro é um processo filho com stdio herdado, portanto suas linhas e as
 * linhas do NativeScope dividem o mesmo terminal. Estas mensagens deixam
 * explícito quem iniciou o bundler, qual comando foi executado e como separar
 * os logs depois do spawn.
 */

/** Prefixo de toda linha que a CLI imprime DEPOIS de o Metro assumir o terminal. */
export const NOTE_PREFIX = "[nativescope]";

/** Prefixa cada linha física, inclusive linhas vazias, para não perder autoria. */
export function prefixedLines(line: string): string[] {
  return line.split(/\r?\n/).map((part) => `${NOTE_PREFIX} ${part}`);
}

/** Quem é o dono do terminal daqui para baixo, pelo nome que o usuário conhece. */
export function toolLabel(flavor: DetectedProject["flavor"]): string {
  return flavor === "expo" ? "Expo" : "React Native CLI";
}

/**
 * Régua que marca a fronteira. Vai rotulada com o comando exato para que,
 * mesmo em um terminal com scroll longo, dê para saber de quem é a saída.
 */
export function separator(label: string, width = 80): string {
  const text = ` ${label} `;
  const fill = Math.max(4, width - text.length - 2);
  return `${"-".repeat(fill)}${text}--`;
}

export function startingMetroLines(command: string, tool: string): string[] {
  return [
    "Metro",
    `  NativeScope is starting Metro for you:  ${command}`,
    "",
    "  Do not start another Metro for this project in a second terminal.",
    "  NativeScope starts this process with the exact port and its Metro config,",
    "  so the app and the Studio use the same instrumented bundler.",
    "",
    "  To manage Metro yourself:  press Ctrl+C, then rerun with --no-metro.",
    "",
    `  Unprefixed output below the line comes from ${tool}, including the`,
    `  interactive keys it lists and any error they produce.`,
    `  NativeScope's own messages remain prefixed with ${NOTE_PREFIX}.`,
  ];
}

export function metroPortChangedLines(
  requestedPort: number,
  selectedPort: number,
  command: string,
): string[] {
  return [
    "Metro",
    `  Port ${requestedPort} is already in use. NativeScope will use port ${selectedPort}`,
    `  for the Metro it starts:  ${command}`,
    "",
    "  This avoids letting the bundler silently choose a different port.",
    "  Do not start another Metro for this project; use the command above and",
    "  reload the app so it loads the NativeScope-enabled bundle.",
  ];
}

export function metroPortUnavailableLines(
  requestedPort: number,
  command: string,
): string[] {
  return [
    "Metro",
    `  NativeScope could not find a free Metro port starting at ${requestedPort}.`,
    `  The command it would run is:  ${command}`,
    "",
    "  Stop an unused bundler, or use --no-metro with a Metro you manage, then run",
    "  NativeScope again.",
    "  The Studio above is already running and will close when you press Ctrl+C.",
  ];
}

export function noMetroLines(command: string): string[] {
  return [
    "Metro",
    "  Not starting Metro (--no-metro).",
    "",
    "  Start it yourself, from this project, so the NativeScope Metro config",
    `  applies:  ${command}`,
    "",
    "  Keep this process running: it serves the Studio and the app connects to it.",
  ];
}

export function manualConfigLines(reason: string, command: string): string[] {
  return [
    "Metro",
    "  NativeScope did not start Metro: your Metro config needs one manual step",
    "  first, and starting Metro now would produce a bundle without NativeScope.",
    "",
    ...reason.split("\n").map((line) => `  ${line}`),
    "",
    `  After wrapping it, run NativeScope again — or start Metro yourself with  ${command}`,
  ];
}

export function noSessionLines(): string[] {
  return [
    "Metro",
    "  NativeScope did not start Metro: it could not write",
    "  node_modules/.cache/rnsi/session.js, which is how the app learns the port",
    "  and token to connect to.",
    "",
    "  Install dependencies in this project (so node_modules exists), check that",
    "  the folder is writable, and run NativeScope again.",
  ];
}

export function unknownProjectLines(): string[] {
  return [
    "Metro",
    "  NativeScope did not start Metro: no `expo` or `react-native` dependency was",
    "  found in package.json, so there is no way to tell which command to run.",
    "",
    "  Start Metro yourself and keep this process running, or point NativeScope at",
    "  the right folder with  --project <path>",
  ];
}

export function metroExitLines(
  command: string,
  code: number | null,
  signal: string | null,
): string[] {
  const status =
    code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`;
  return [
    `Metro stopped unexpectedly (${status}).`,
    `NativeScope is shutting down because its bundler exited:  ${command}`,
    "Run that command by hand in this folder to see the full error.",
  ];
}

export function metroStartFailureLines(
  command: string,
  message: string,
): string[] {
  return [
    `Could not start Metro (${message}).`,
    `Run it by hand in this folder to see the full error:  ${command}`,
  ];
}
