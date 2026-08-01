import { describe, expect, it } from "vitest";
import type { LogEntry, NetworkRequest } from "@rnsi/protocol";
import type { ActivityItem } from "./store.ts";
import {
  EVENT_COUNT_OPTIONS,
  anchorWindow,
  buildTimeline,
  collectAnchors,
  eventCountLabel,
  isAnchorRow,
  type TimelineAnchor,
} from "./timeline-select.ts";

let seq = 0;

function log(overrides: Partial<LogEntry> = {}): LogEntry {
  seq += 1;
  return {
    id: `l-${seq}`,
    seq,
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

function request(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  seq += 1;
  return {
    id: `r-${seq}`,
    method: "GET",
    url: "https://api.test/me",
    origin: "https://api.test",
    path: "/me",
    query: null,
    status: 200,
    ok: true,
    error: null,
    startedAt: 1000,
    endedAt: 1100,
    duration: 100,
    requestSize: 0,
    responseSize: 0,
    requestHeaders: {},
    responseHeaders: {},
    requestBody: null,
    responseBody: null,
    ...overrides,
  };
}

function activity(overrides: Partial<ActivityItem> & { timestamp: number }): ActivityItem {
  seq += 1;
  return {
    id: seq,
    providerId: "mmkv",
    providerLabel: "MMKV",
    instanceId: "default",
    key: "auth.token",
    change: "updated",
    source: "app",
    preview: null,
    target: { kind: "key-value", key: "auth.token" },
    ...overrides,
  };
}

const ALL_SOURCES = ["logs", "network", "storage"] as const;

const anchor: TimelineAnchor = {
  id: "a",
  kind: "error",
  ts: 10_000,
  label: "boom",
  detail: null,
};

describe("anchorWindow", () => {
  it("marca olha para frente — o interesse é o que veio depois", () => {
    const window = anchorWindow({ ...anchor, kind: "mark" }, 1000);
    expect(window).toEqual({ from: 10_000, to: 12_000 });
  });

  it("erro olha para os dois lados", () => {
    expect(anchorWindow(anchor, 1000)).toEqual({ from: 9_000, to: 11_000 });
  });

  it("log e request olham para trás também — a causa está ANTES deles", () => {
    // Regressão: um log não-erro já foi ancorado como `mark` e ganhava janela
    // só-para-frente, escondendo exatamente a request que o provocou.
    expect(anchorWindow({ ...anchor, kind: "log" }, 1000)).toEqual({ from: 9_000, to: 11_000 });
    expect(anchorWindow({ ...anchor, kind: "request" }, 1000)).toEqual({ from: 9_000, to: 11_000 });
  });
});

describe("buildTimeline", () => {
  it("sem âncora não devolve nada — não existe modo firehose", () => {
    const rows = buildTimeline({
      logs: [log()],
      requests: [request()],
      activity: [activity({ timestamp: 1000 })],
      anchor: null,
      windowMs: 1000,
      sources: [...ALL_SOURCES],
    });
    expect(rows).toEqual([]);
  });

  it("mescla as três fontes em ordem cronológica", () => {
    const rows = buildTimeline({
      logs: [log({ ts: 10_200, message: "persisting session" })],
      requests: [request({ startedAt: 10_100 })],
      activity: [activity({ timestamp: 10_300 })],
      anchor,
      windowMs: 1000,
      sources: [...ALL_SOURCES],
    });

    expect(rows.map((row) => row.kind)).toEqual(["request", "log", "storage"]);
    expect(rows.map((row) => row.ts)).toEqual([10_100, 10_200, 10_300]);
  });

  it("respeita a janela", () => {
    const rows = buildTimeline({
      logs: [log({ ts: 10_100 }), log({ ts: 99_999 })],
      requests: [],
      activity: [],
      anchor,
      windowMs: 1000,
      sources: [...ALL_SOURCES],
    });
    expect(rows).toHaveLength(1);
  });

  it("ignora trilhas desligadas", () => {
    const rows = buildTimeline({
      logs: [log({ ts: 10_100 })],
      requests: [request({ startedAt: 10_100 })],
      activity: [],
      anchor,
      windowMs: 1000,
      sources: ["logs"],
    });
    expect(rows.map((row) => row.kind)).toEqual(["log"]);
  });

  it("nunca mostra mudança feita pelo próprio Studio", () => {
    const rows = buildTimeline({
      logs: [],
      requests: [],
      activity: [
        activity({ timestamp: 10_100, source: "studio" }),
        activity({ timestamp: 10_200, source: "app" }),
      ],
      anchor,
      windowMs: 1000,
      sources: [...ALL_SOURCES],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ts).toBe(10_200);
  });

  it("no modo por eventos, mantém N antes, o alvo e N depois", () => {
    const target = log({ id: "target", ts: 10_000 });
    const rows = buildTimeline({
      logs: [
        log({ ts: 9_000 }),
        log({ ts: 9_100 }),
        log({ ts: 9_200 }),
        target,
        log({ ts: 10_100 }),
        log({ ts: 10_200 }),
        log({ ts: 10_300 }),
      ],
      requests: [],
      activity: [],
      anchor: { ...anchor, id: "log:target" },
      windowMs: 1,
      windowMode: "events",
      eventCount: 2,
      sources: [...ALL_SOURCES],
    });

    expect(rows.map((row) => row.ts)).toEqual([9_100, 9_200, 10_000, 10_100, 10_200]);
    expect(isAnchorRow(rows[2]!, { ...anchor, id: "log:target" })).toBe(true);
  });

  it("no modo por eventos, descarta o que está a minutos da âncora antes de ordenar", () => {
    // O corte grosso é performance, não semântica: nada a 5 min de distância
    // caberia num recorte de N eventos. Mas precisa continuar SEM efeito no
    // resultado — o vizinho real, mesmo a 1 min, tem que entrar.
    const rows = buildTimeline({
      logs: [
        log({ ts: 10_000 - 10 * 60_000, message: "antigo demais" }),
        log({ ts: 10_000 - 60_000, message: "vizinho de 1 min" }),
        log({ id: "target", ts: 10_000 }),
        log({ ts: 10_000 + 10 * 60_000, message: "futuro demais" }),
      ],
      requests: [],
      activity: [],
      anchor: { ...anchor, id: "log:target" },
      windowMs: 1,
      windowMode: "events",
      eventCount: 5,
      sources: [...ALL_SOURCES],
    });

    expect(rows.map((row) => (row.kind === "log" ? row.entry.message : ""))).toEqual([
      "vizinho de 1 min",
      "hello",
    ]);
  });
});

describe("eventCountLabel", () => {
  it("marca não tem 'antes' — o rótulo não pode prometer", () => {
    // buildTimeline sempre filtrou `ts >= anchor.ts` e cortou em N para marcas,
    // mas o seletor prometia "5 before / 5 after" e entregava 5 no total.
    const option = EVENT_COUNT_OPTIONS[0]!;
    expect(eventCountLabel(option, { ...anchor, kind: "mark" })).toBe("5 after the mark");
    expect(eventCountLabel(option, anchor)).toBe("5 before / 5 after");
    expect(eventCountLabel(option, null)).toBe("5 before / 5 after");
  });
});

describe("collectAnchors", () => {
  it("oferece marca, erros e requests que falharam", () => {
    const anchors = collectAnchors({
      logs: [log({ level: "error", message: "kaboom" }), log({ level: "log" })],
      requests: [request({ status: 401 }), request({ status: 200 })],
      markedAt: 500,
    });

    expect(anchors.map((item) => item.kind)).toEqual(["mark", "error", "request"]);
    expect(anchors[1]!.label).toBe("kaboom");
  });

  it("sem nada relevante, não inventa âncora", () => {
    expect(collectAnchors({ logs: [], requests: [request()], markedAt: null })).toEqual([]);
  });
});
