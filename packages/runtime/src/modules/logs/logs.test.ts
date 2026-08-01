import { afterEach, describe, expect, it, vi } from "vitest";
import type { LogBatch, LogEntry } from "@rnsi/protocol";
import type { Runtime } from "../../bootstrap.ts";
import { installLogsModule } from "./install.ts";
import {
  createLogBatcher,
  deriveNamespace,
  normalizeLogsOptions,
  serializeArg,
} from "./capture.ts";

/* ------------------------------------------------------------------ *
 * Helpers puros
 * ------------------------------------------------------------------ */

describe("logs capture — helpers puros", () => {
  it("normaliza config ausente para defaults sãos", () => {
    const options = normalizeLogsOptions(undefined);
    expect(options.levels).toEqual(["debug", "log", "info", "warn", "error"]);
    expect(options.maxPerSecond).toBeGreaterThan(0);
    expect(options.ignorePatterns).toContain("[rnsi]");
  });

  it("ignora níveis desconhecidos e cai no default quando sobra nada", () => {
    expect(normalizeLogsOptions({ levels: ["warn", "nope"] }).levels).toEqual(["warn"]);
    expect(normalizeLogsOptions({ levels: ["nope"] }).levels).toHaveLength(5);
  });

  it("deriva namespace de [foo] e de foo:", () => {
    expect(deriveNamespace("[Auth] token expired")).toBe("Auth");
    expect(deriveNamespace("payment: charging card")).toBe("payment");
    expect(deriveNamespace("nothing to see here")).toBeNull();
  });

  it("marcador de nível no prefixo não é namespace", () => {
    // Regressão: `[ERROR] RnbgLocationService: falha` devolvia "ERROR". Isso
    // pintava dois badges idênticos no detalhe (nível + namespace), poluía o
    // filtro de namespace com ERROR/WARN/INFO e escondia o namespace real,
    // porque a regra de colchete vencia antes da de dois-pontos.
    expect(deriveNamespace("[ERROR] RnbgLocationService: falha ao iniciar")).toBe(
      "RnbgLocationService",
    );
    expect(deriveNamespace("[INFO] NetworkService: Initializing")).toBe("NetworkService");
    expect(deriveNamespace("[warn] cache miss")).toBeNull();
    expect(deriveNamespace("[DEBUG][Auth] token expired")).toBe("Auth");
  });

  it("colchete que só PARECE nível continua valendo como namespace", () => {
    // "Errors" e "Logger" não são níveis — quem taguear assim não pode perder
    // o namespace por causa do prefixo.
    expect(deriveNamespace("[Errors] boundary caught")).toBe("Errors");
    expect(deriveNamespace("[Logger] ready")).toBe("Logger");
  });

  it("preview cabe numa linha — degrada para silhueta em vez de despejar JSON", () => {
    const options = normalizeLogsOptions({});

    // Cabe: o valor aparece inteiro, o dev lê sem clicar.
    expect(serializeArg({ id: 7, ok: true }, options).preview).toBe('{"id":7,"ok":true}');

    // Não cabe: silhueta de chaves. Era este o log de três linhas na lista.
    const fat = {
      ts: "01/08/2026, 11:34:45",
      context: {},
      error: { name: "Error", message: "Waiting for previous start action to complete" },
    };
    expect(serializeArg(fat, options).preview).toBe("{ts, context, error}");

    // Nem a silhueta cabe: só a contagem.
    const wide = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`campoDeNomeLongo${i}`, i]),
    );
    expect(serializeArg(wide, options).preview).toBe("{40 keys}");

    // Array grande vira contagem, não 80 chars de números.
    expect(serializeArg(Array.from({ length: 200 }, (_, i) => i), options).preview).toBe(
      "[200 items]",
    );
  });

  it("erro no preview é o cabeçalho, não o objeto serializado", () => {
    const arg = serializeArg(new Error("Waiting for previous start action"), normalizeLogsOptions({}));
    expect(arg.kind).toBe("error");
    expect(arg.preview).toBe("Error: Waiting for previous start action");
  });

  it("redige segredos por padrão, sem precisar de config", () => {
    const options = normalizeLogsOptions({});
    const arg = serializeArg(
      {
        userId: 7,
        token: "eyJhbGciOi.SECRETO",
        access_token: "outro-SECRETO",
        "API-KEY": "k-SECRETO",
        nested: { password: "hunter2", keep: "visível" },
      },
      options,
    );

    expect(arg.json).not.toContain("SECRETO");
    expect(arg.json).not.toContain("hunter2");
    const parsed = JSON.parse(arg.json!);
    expect(parsed.userId).toBe(7); // o que não é segredo continua legível
    expect(parsed.token).toBe("«redacted»");
    expect(parsed.access_token).toBe("«redacted»");
    expect(parsed["API-KEY"]).toBe("«redacted»");
    expect(parsed.nested).toEqual({ password: "«redacted»", keep: "visível" });
  });

  it("nem invoca o getter de uma chave secreta", () => {
    let lido = false;
    const alvo = {
      get token() {
        lido = true;
        return "SECRETO";
      },
    };

    const arg = serializeArg(alvo, normalizeLogsOptions({}));
    expect(lido).toBe(false);
    expect(arg.json).toContain("«redacted»");
  });

  it("redação é desligável, e chaves extras somam aos defaults", () => {
    const off = serializeArg({ token: "abc" }, normalizeLogsOptions({ redact: false }));
    expect(JSON.parse(off.json!).token).toBe("abc");

    const extra = normalizeLogsOptions({ redactKeys: ["cpf"] });
    const arg = serializeArg({ cpf: "000", token: "abc", nome: "Ana" }, extra);
    const parsed = JSON.parse(arg.json!);
    expect(parsed.cpf).toBe("«redacted»");
    expect(parsed.token).toBe("«redacted»"); // default continua valendo
    expect(parsed.nome).toBe("Ana");
  });

  it("Map também é redigido — é objeto disfarçado", () => {
    const arg = serializeArg(new Map([["refreshToken", "SECRETO"]]), normalizeLogsOptions({}));
    expect(arg.json).not.toContain("SECRETO");
    expect(arg.json).toContain("«redacted»");
  });

  it("objeto hostil degrada para «unserializable» em vez de sumir a entrada", () => {
    // Regressão: o toPlain ficava FORA do try. Um Proxy cujo ownKeys lança
    // subia até o catch do capture() e a entrada inteira desaparecia — o app
    // não caía, mas o log nunca chegava e não havia rastro do porquê.
    const hostil = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("ownKeys explodiu");
        },
      },
    );

    const arg = serializeArg(hostil, normalizeLogsOptions({}));
    expect(arg.kind).toBe("unserializable");
    expect(arg.preview).toBe("«unserializable»");
    expect(arg.truncated).toBe(true);
  });

  it("serializa objeto em JSON válido para o viewer", () => {
    const arg = serializeArg({ user: { id: 7, name: "Ana" } }, normalizeLogsOptions({}));
    expect(arg.kind).toBe("json");
    expect(arg.json).not.toBeNull();
    expect(JSON.parse(arg.json!)).toEqual({ user: { id: 7, name: "Ana" } });
  });

  it("marca ciclo em vez de estourar a pilha", () => {
    const cyclic: Record<string, unknown> = { name: "root" };
    cyclic.self = cyclic;
    const arg = serializeArg(cyclic, normalizeLogsOptions({}));
    expect(arg.truncated).toBe(true);
    expect(arg.json).toContain("«circular»");
    expect(() => JSON.parse(arg.json!)).not.toThrow();
  });

  it("trata Error como cidadão de primeira classe", () => {
    const arg = serializeArg(new Error("boom"), normalizeLogsOptions({}));
    expect(arg.kind).toBe("error");
    expect(arg.preview).toContain("boom");
    expect(JSON.parse(arg.json!)).toMatchObject({ message: "boom" });
  });

  it("mantém o JSON VÁLIDO mesmo quando o objeto estoura o teto", () => {
    const big = { items: Array.from({ length: 5000 }, (_, i) => ({ i, pad: "x".repeat(200) })) };
    const arg = serializeArg(big, normalizeLogsOptions({ maxArgLength: 2048 }));
    expect(arg.truncated).toBe(true);
    expect(arg.json!.length).toBeLessThanOrEqual(2048);
    // O ponto: cortar string no meio quebraria o viewer do Studio.
    expect(() => JSON.parse(arg.json!)).not.toThrow();
  });

  it("não serializa função/symbol como se fossem dados", () => {
    expect(serializeArg(() => {}, normalizeLogsOptions({})).kind).toBe("unserializable");
    expect(serializeArg(Symbol("x"), normalizeLogsOptions({})).kind).toBe("unserializable");
  });
});

/* ------------------------------------------------------------------ *
 * Batcher
 * ------------------------------------------------------------------ */

function entry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: `id-${Math.random()}`,
    seq: 1,
    ts: 1000,
    level: "log",
    source: "console",
    message: "hello",
    namespace: null,
    args: [],
    stack: null,
    repeat: 1,
    truncated: false,
    ...overrides,
  };
}

describe("logs batcher", () => {
  it("só entrega quando está pronto — antes disso acumula", () => {
    const batches: LogBatch[] = [];
    const batcher = createLogBatcher((b) => batches.push(b), normalizeLogsOptions({}));

    batcher.push(entry({ message: "a" }));
    batcher.push(entry({ message: "b" }));
    batcher.flush();
    expect(batches).toHaveLength(0); // ainda sem handshake

    batcher.setReady(true);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.entries.map((e) => e.message)).toEqual(["a", "b"]);
  });

  it("funde idênticas consecutivas em repeat, sem inflar o lote", () => {
    const batches: LogBatch[] = [];
    const batcher = createLogBatcher((b) => batches.push(b), normalizeLogsOptions({}));
    batcher.setReady(true);

    for (let i = 0; i < 50; i += 1) batcher.push(entry({ message: "render loop" }));
    batcher.flush();

    expect(batches[0]!.entries).toHaveLength(1);
    expect(batches[0]!.entries[0]!.repeat).toBe(50);
  });

  it("NÃO funde quando só os argumentos diferem", () => {
    // Regressão: a identidade do ×N era nível+mensagem. Como a mensagem
    // carregava o JSON dos argumentos capado em 200 chars, dois payloads que
    // divergissem depois do corte fundiam — e o segundo nunca era emitido.
    // Com o preview reduzido a uma silhueta isso deixaria de ser exceção.
    const batches: LogBatch[] = [];
    const batcher = createLogBatcher((b) => batches.push(b), normalizeLogsOptions({}));
    batcher.setReady(true);

    const arg = (json: string): LogEntry["args"] => [
      { kind: "json", preview: "{id}", json, truncated: false },
    ];
    batcher.push(entry({ message: "state", args: arg('{"id":1}') }));
    batcher.push(entry({ message: "state", args: arg('{"id":2}') }));
    batcher.push(entry({ message: "state", args: arg('{"id":2}') })); // este sim funde
    batcher.flush();

    const entries = batches[0]!.entries;
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.repeat)).toEqual([1, 2]);
    expect(entries.map((e) => e.args[0]!.json)).toEqual(['{"id":1}', '{"id":2}']);
  });

  it("stack diferente também é linha diferente", () => {
    const batches: LogBatch[] = [];
    const batcher = createLogBatcher((b) => batches.push(b), normalizeLogsOptions({}));
    batcher.setReady(true);

    batcher.push(entry({ level: "error", message: "boom", stack: "at a()" }));
    batcher.push(entry({ level: "error", message: "boom", stack: "at b()" }));
    batcher.flush();

    expect(batches[0]!.entries).toHaveLength(2);
  });

  it("respeita o teto por segundo e conta os descartes", () => {
    const batches: LogBatch[] = [];
    const batcher = createLogBatcher(
      (b) => batches.push(b),
      normalizeLogsOptions({ maxPerSecond: 3 }),
    );
    batcher.setReady(true);

    for (let i = 0; i < 10; i += 1) batcher.push(entry({ message: `line ${i}`, ts: 1000 }));
    batcher.flush();

    const delivered = batches.flatMap((b) => b.entries);
    expect(delivered).toHaveLength(3);
    expect(batches.reduce((total, b) => total + b.dropped, 0)).toBe(7);
  });

  it("mantém as MAIS RECENTES quando o buffer pré-conexão enche", () => {
    const batches: LogBatch[] = [];
    const batcher = createLogBatcher(
      (b) => batches.push(b),
      normalizeLogsOptions({ preReadyBuffer: 3, maxPerSecond: 1000 }),
    );

    for (let i = 0; i < 6; i += 1) batcher.push(entry({ message: `line ${i}`, ts: 1000 + i }));
    batcher.setReady(true);

    const delivered = batches.flatMap((b) => b.entries).map((e) => e.message);
    expect(delivered).toEqual(["line 3", "line 4", "line 5"]);
    expect(batches.reduce((total, b) => total + b.dropped, 0)).toBe(3);
  });
});

/* ------------------------------------------------------------------ *
 * Patch do console
 * ------------------------------------------------------------------ */

interface FakeRuntime {
  runtime: Runtime;
  events: Array<{ module: string; event: string; data: unknown }>;
  setReady: (ready: boolean) => void;
}

function fakeRuntime(options: { initialReady?: boolean; onSend?: () => void } = {}): FakeRuntime {
  const events: FakeRuntime["events"] = [];
  let readyHandler: ((ready: boolean) => void) | null = null;
  const runtime = {
    registry: {} as Runtime["registry"],
    sendModuleEvent: (module: string, event: string, data?: unknown) => {
      events.push({ module, event, data });
      options.onSend?.();
    },
    onModuleCommand: () => () => {},
    onReadyChange: (handler: (ready: boolean) => void) => {
      readyHandler = handler;
      handler(options.initialReady ?? true);
      return () => {
        readyHandler = null;
      };
    },
    close: () => {},
  } satisfies Runtime;
  return { runtime, events, setReady: (ready) => readyHandler?.(ready) };
}

const realConsole = globalThis.console;
let uninstall: (() => void) | null = null;

afterEach(() => {
  uninstall?.();
  uninstall = null;
  globalThis.console = realConsole;
});

interface Passthrough {
  level: string;
  args: unknown[];
}

function setup(config?: unknown, runtimeOptions?: Parameters<typeof fakeRuntime>[0]) {
  const passthrough: Passthrough[] = [];
  // Objeto FRESCO por teste: o marcador de patch não pode vazar entre casos.
  const fake = {
    debug: (...args: unknown[]) => passthrough.push({ level: "debug", args }),
    log: (...args: unknown[]) => passthrough.push({ level: "log", args }),
    info: (...args: unknown[]) => passthrough.push({ level: "info", args }),
    warn: (...args: unknown[]) => passthrough.push({ level: "warn", args }),
    error: (...args: unknown[]) => passthrough.push({ level: "error", args }),
  };
  globalThis.console = fake as unknown as Console;
  // Snapshot ANTES do patch: depois, `fake.log` já é o método instrumentado.
  const originals = { ...fake };
  const rt = fakeRuntime(runtimeOptions);
  uninstall = installLogsModule(rt.runtime, { maxBatchEntries: 1, ...(config as object) });
  return { rt, passthrough, fake, originals };
}

function batches(rt: FakeRuntime): LogBatch[] {
  return rt.events.map((event) => event.data as LogBatch);
}

describe("logs module — patch de console", () => {
  it("captura console.log e emite um lote", () => {
    const { rt } = setup();
    console.log("[Auth] hello");

    expect(rt.events).toHaveLength(1);
    expect(rt.events[0]!.module).toBe("logs");
    expect(rt.events[0]!.event).toBe("batch");
    const entries = batches(rt)[0]!.entries;
    expect(entries[0]!.message).toBe("[Auth] hello");
    expect(entries[0]!.namespace).toBe("Auth");
    expect(entries[0]!.level).toBe("log");
  });

  it("NUNCA sequestra o console: o original continua sendo chamado", () => {
    const { passthrough } = setup();
    console.warn("still reaches metro", 42);

    expect(passthrough).toHaveLength(1);
    expect(passthrough[0]!.level).toBe("warn");
    expect(passthrough[0]!.args).toEqual(["still reaches metro", 42]);
  });

  it("anexa o stack quando um Error é logado", () => {
    const { rt } = setup();
    console.error(new Error("kaboom"));

    const entry = batches(rt)[0]!.entries[0]!;
    expect(entry.level).toBe("error");
    expect(entry.stack).toContain("kaboom");
    expect(entry.args[0]!.kind).toBe("error");
  });

  it("marca rejeição não tratada com a origem certa", () => {
    const { rt } = setup();
    console.warn("Possible Unhandled Promise Rejection (id: 0): boom");

    expect(batches(rt)[0]!.entries[0]!.source).toBe("rejection");
  });

  it("não captura o ruído do próprio inspector", () => {
    const { rt, passthrough } = setup();
    console.error("[rnsi] frame acima do orçamento de fio");

    expect(rt.events).toHaveLength(0);
    expect(passthrough).toHaveLength(1); // mas o original continua recebendo
  });

  it("respeita a lista de níveis: fora dela o console nem é tocado", () => {
    const { rt, fake } = setup({ levels: ["error"] });
    const untouchedLog = fake.log;
    expect(console.log).toBe(untouchedLog);

    console.log("ignored");
    console.error("captured");
    expect(rt.events).toHaveLength(1);
    expect(batches(rt)[0]!.entries[0]!.message).toBe("captured");
  });

  it("não derruba o app: instalar duas vezes é idempotente", () => {
    const { rt } = setup();
    const patched = console.log;
    expect(() => installLogsModule(rt.runtime, {})).not.toThrow();
    expect(console.log).toBe(patched);
  });

  it("uninstall devolve os métodos originais", () => {
    const { originals } = setup();
    expect(console.log).not.toBe(originals.log);
    uninstall?.();
    uninstall = null;
    expect(console.log).toBe(originals.log);
  });

  /**
   * O teste que justifica o guard de reentrância existir.
   *
   * `bootstrap.ts` chama `console.error` DENTRO de `send()` quando um frame
   * estoura o orçamento de fio. Sem o guard, capturar essa linha e emiti-la
   * gera um ciclo que não só se sustenta — ele CRESCE, porque cada frame embute
   * o anterior. Aqui simulamos exatamente isso.
   */
  it("não entra em recursão quando o próprio envio grita no console", () => {
    const { rt } = setup(undefined, {
      onSend: () => {
        console.error("[wire] frame acima do orçamento");
      },
    });

    console.log("gatilho");

    expect(rt.events.length).toBeLessThanOrEqual(2);
    expect(rt.events.length).toBeGreaterThan(0);
  });

  it("não perde os logs anteriores ao handshake e drena ao conectar", () => {
    const { rt } = setup({ maxBatchEntries: 50 }, { initialReady: false });

    console.log("startup 1");
    console.log("startup 2");
    expect(rt.events).toHaveLength(0); // gate do sendEvent descartaria isto

    rt.setReady(true);
    const entries = batches(rt).flatMap((batch) => batch.entries);
    expect(entries.map((e) => e.message)).toEqual(["startup 1", "startup 2"]);
  });

  it("volta a bufferizar quando a conexão cai e drena na reconexão", () => {
    const { rt } = setup({ maxBatchEntries: 50 });

    rt.setReady(false);
    console.log("offline");
    const before = rt.events.length;

    rt.setReady(true);
    const entries = batches(rt)
      .slice(before)
      .flatMap((batch) => batch.entries);
    expect(entries.map((e) => e.message)).toEqual(["offline"]);
  });

  it("agrupa por janela quando não força flush por contagem", async () => {
    const { rt } = setup({ maxBatchEntries: 100, flushMs: 5 });

    console.log("a");
    console.log("b");
    expect(rt.events).toHaveLength(0);

    await vi.waitFor(() => expect(rt.events).toHaveLength(1));
    expect(batches(rt)[0]!.entries).toHaveLength(2);
  });

  it("captura exceções globais pelo ErrorUtils, encadeando o handler anterior", () => {
    const previous = vi.fn();
    const root = globalThis as unknown as { ErrorUtils?: unknown };
    const originalErrorUtils = root.ErrorUtils;
    let handler: ((error: unknown, isFatal?: boolean) => void) | undefined = previous;
    root.ErrorUtils = {
      getGlobalHandler: () => handler,
      setGlobalHandler: (next: (error: unknown, isFatal?: boolean) => void) => {
        handler = next;
      },
    };

    try {
      const { rt } = setup();
      handler?.(new Error("fatal boom"), true);

      const entry = batches(rt)[0]!.entries[0]!;
      expect(entry.source).toBe("exception");
      expect(entry.message).toContain("fatal boom");
      expect(entry.message).toContain("(fatal)");
      expect(previous).toHaveBeenCalledTimes(1);
    } finally {
      root.ErrorUtils = originalErrorUtils;
    }
  });
});
