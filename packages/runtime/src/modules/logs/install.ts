import { LOGS_EVENT, LOGS_MODULE, type LogArg, type LogEntry, type LogLevel } from "@rnsi/protocol";
import type { Runtime } from "../../bootstrap.ts";
import {
  createLogBatcher,
  deriveNamespace,
  formatMessage,
  isIgnoredMessage,
  normalizeLogsOptions,
  serializeArg,
  type LogsOptions,
} from "./capture.ts";

/**
 * Módulo de Logs: instrumenta `console.*` e as falhas globais do JS.
 *
 * Princípio inegociável (o mesmo do network): o inspector NUNCA derruba o app.
 * Toda captura vive num try/catch e o método original é sempre chamado FORA
 * dele — se a instrumentação falhar, o console do usuário continua idêntico e
 * o Metro segue recebendo tudo. Não sequestramos nada.
 *
 * O risco específico deste módulo, que não existe em nenhum outro: nosso
 * PRÓPRIO código chama `console.*`. `bootstrap.ts` grita com `console.error`
 * quando um frame estoura o orçamento de fio — e esse grito acontece DENTRO do
 * caminho de envio. Capturar essa linha e emiti-la faria o frame seguinte
 * embutir o anterior: um ciclo que não só se sustenta, ele CRESCE. Daí o guard
 * de reentrância abaixo ser a primeira coisa do módulo, e não um detalhe.
 */

type ConsoleMethod = (...args: unknown[]) => void;

interface PatchableConsole extends Record<string, unknown> {
  __rnsiLogsPatched?: boolean;
  __rnsiLogsUninstall?: () => void;
}

interface ErrorUtilsLike {
  getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
}

/** RN reporta rejeições não tratadas por aqui — vira `source: "rejection"`. */
const REJECTION_MARKER = "Possible Unhandled Promise Rejection";

let nextId = 0;

function generateId(): string {
  nextId += 1;
  return `l-${nextId}-${Math.random().toString(36).slice(2, 8)}`;
}

export function installLogsModule(runtime: Runtime, config?: unknown): () => void {
  const options: LogsOptions = normalizeLogsOptions(config);

  const root = globalThis as unknown as { console?: PatchableConsole; ErrorUtils?: ErrorUtilsLike };
  const target = root.console;
  if (!target) return () => {};
  if (target.__rnsiLogsPatched) {
    return target.__rnsiLogsUninstall ?? (() => {});
  }

  /**
   * Guard de reentrância. Enquanto capturamos ou emitimos, qualquer `console.*`
   * disparado por nós mesmos passa direto ao original sem virar evento.
   */
  let inside = false;
  let seq = 0;

  const batcher = createLogBatcher((batch) => {
    // O envio pode gritar no console (guard de orçamento de fio do bootstrap):
    // o flush TAMBÉM precisa rodar dentro do guard.
    const previous = inside;
    inside = true;
    try {
      runtime.sendModuleEvent(LOGS_MODULE, LOGS_EVENT.batch, batch);
    } catch {
      /* nunca propaga */
    } finally {
      inside = previous;
    }
  }, options);

  function makeEntry(
    level: LogLevel,
    source: LogEntry["source"],
    args: LogArg[],
    stack: string | null,
  ): LogEntry {
    const message = formatMessage(args, options);
    seq += 1;
    return {
      id: generateId(),
      seq,
      ts: Date.now(),
      level,
      source,
      message,
      namespace: deriveNamespace(message),
      args,
      stack,
      repeat: 1,
      truncated: args.some((arg) => arg.truncated),
    };
  }

  function serializeArgs(raw: unknown[]): { args: LogArg[]; stack: string | null } {
    const limit = Math.min(raw.length, options.maxArgs);
    const args: LogArg[] = [];
    let stack: string | null = null;
    for (let i = 0; i < limit; i += 1) {
      const value = raw[i];
      if (stack === null && value instanceof Error && typeof value.stack === "string") {
        stack = value.stack;
      }
      args.push(serializeArg(value, options));
    }
    if (raw.length > limit) {
      args.push({
        kind: "text",
        preview: `«+${raw.length - limit} args»`,
        json: null,
        truncated: true,
      });
    }
    return { args, stack };
  }

  function capture(level: LogLevel, raw: unknown[]): void {
    if (inside) return;
    inside = true;
    try {
      // Pré-filtro barato antes de serializar: o ruído do próprio inspector
      // sempre começa por uma string com prefixo, e serializar args só para
      // descartar seria pagar o caminho caro à toa no caso mais comum.
      if (typeof raw[0] === "string" && isIgnoredMessage(raw[0], options)) return;

      const { args, stack } = serializeArgs(raw);
      const entry = makeEntry(level, "console", args, stack);
      if (isIgnoredMessage(entry.message, options)) return;
      if (entry.message.indexOf(REJECTION_MARKER) !== -1) entry.source = "rejection";
      batcher.push(entry);
    } catch {
      /* a instrumentação nunca derruba o app, nem ao capturar */
    } finally {
      inside = false;
    }
  }

  function captureException(error: unknown, isFatal?: boolean): void {
    if (inside) return;
    inside = true;
    try {
      const arg = serializeArg(error, options);
      const stack = error instanceof Error && typeof error.stack === "string" ? error.stack : null;
      const entry = makeEntry("error", "exception", [arg], stack);
      if (isFatal) entry.message = `${entry.message} (fatal)`;
      batcher.push(entry);
      // Crash: o lote seguinte pode nunca sair. Empurra o que dá agora.
      batcher.flush();
    } catch {
      /* nunca propaga */
    } finally {
      inside = false;
    }
  }

  /* ---------------------------------------------------------------- *
   * Patch do console
   * ---------------------------------------------------------------- */

  const originals = new Map<LogLevel, ConsoleMethod>();
  for (const level of options.levels) {
    const original = target[level];
    if (typeof original !== "function") continue;
    const originalMethod = original as ConsoleMethod;
    originals.set(level, originalMethod);
    target[level] = function patched(this: unknown, ...args: unknown[]): void {
      capture(level, args);
      // Passthrough incondicional e FORA do try: o Metro continua recebendo
      // tudo, o LogBox continua funcionando, nada é sequestrado.
      return originalMethod.apply(this, args);
    } as ConsoleMethod;
  }

  const uninstall = (): void => {
    for (const [level, original] of originals) target[level] = original;
    delete target.__rnsiLogsPatched;
    delete target.__rnsiLogsUninstall;
  };

  target.__rnsiLogsPatched = true;
  target.__rnsiLogsUninstall = uninstall;

  /* ---------------------------------------------------------------- *
   * Falhas globais
   * ---------------------------------------------------------------- */

  let restoreErrorHandler = (): void => {};
  try {
    const errorUtils = root.ErrorUtils;
    if (
      errorUtils &&
      typeof errorUtils.getGlobalHandler === "function" &&
      typeof errorUtils.setGlobalHandler === "function"
    ) {
      const previous = errorUtils.getGlobalHandler();
      const handler = (error: unknown, isFatal?: boolean): void => {
        captureException(error, isFatal);
        // Encadeia: o handler do RN (LogBox / red box) continua sendo o dono.
        if (typeof previous === "function") previous(error, isFatal);
      };
      errorUtils.setGlobalHandler(handler);
      restoreErrorHandler = () => {
        try {
          if (errorUtils.getGlobalHandler?.() === handler && previous) {
            errorUtils.setGlobalHandler?.(previous);
          }
        } catch {
          /* nunca propaga */
        }
      };
    }
  } catch {
    /* sem ErrorUtils (web/teste): segue só com console */
  }

  /* ---------------------------------------------------------------- *
   * Conexão
   * ---------------------------------------------------------------- */

  // Sem isto, TODO log anterior ao hello-ack morre no gate do sendEvent — e o
  // módulo sobe com earlyBoot, ou seja, a janela perdida é exatamente o
  // startup do app, que é o que mais interessa depurar. Vale em toda
  // reconexão também: o handshake reabre a janela.
  let removeReady = (): void => {};
  try {
    if (typeof runtime.onReadyChange === "function") {
      removeReady = runtime.onReadyChange((ready) => {
        batcher.setReady(ready);
      });
    } else {
      batcher.setReady(true);
    }
  } catch {
    batcher.setReady(true);
  }

  return () => {
    try {
      uninstall();
      restoreErrorHandler();
      removeReady();
      batcher.dispose();
    } catch {
      /* nunca propaga */
    }
  };
}
