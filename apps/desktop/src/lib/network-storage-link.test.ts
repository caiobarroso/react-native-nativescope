import { describe, expect, it } from "vitest";
import type { ActivityItem } from "./store.ts";
import { buildStorageAttribution, groupImpact } from "./network-storage-link.ts";

let seq = 0;
function change(p: Partial<ActivityItem> & { timestamp: number }): ActivityItem {
  const key = p.key ?? "k";
  return {
    id: seq++,
    timestamp: p.timestamp,
    providerId: p.providerId ?? "async-storage",
    providerLabel: p.providerLabel ?? "AsyncStorage",
    instanceId: p.instanceId ?? "default",
    key,
    change: p.change ?? "updated",
    source: p.source ?? "app",
    preview: null,
    target: p.target ?? { kind: "key-value", key },
  };
}

const requests = [
  { id: "r1", endedAt: 100 },
  { id: "r2", endedAt: 200 },
];

describe("buildStorageAttribution (nearest-preceding)", () => {
  it("atribui a mudança ao request que terminou logo antes", () => {
    const { counts } = buildStorageAttribution(requests, [change({ timestamp: 250 })], 1500);
    expect(counts.get("r2")).toBe(1);
    expect(counts.get("r1")).toBeUndefined();
  });

  it("uma mudança entre r1 e r2 vai para r1", () => {
    const { counts } = buildStorageAttribution(requests, [change({ timestamp: 150 })], 1500);
    expect(counts.get("r1")).toBe(1);
  });

  it("mudança na borda (== endedAt) conta para o request", () => {
    const { counts } = buildStorageAttribution(requests, [change({ timestamp: 100 })], 1500);
    expect(counts.get("r1")).toBe(1);
  });

  it("ignora mudanças além da janela Δ", () => {
    const { counts } = buildStorageAttribution(requests, [change({ timestamp: 5000 })], 1500);
    expect(counts.size).toBe(0);
  });

  it("ignora mudanças originadas no Studio (só source app conta)", () => {
    const { counts } = buildStorageAttribution(
      requests,
      [change({ timestamp: 250, source: "studio" })],
      1500,
    );
    expect(counts.size).toBe(0);
  });

  it("coleta os items atribuídos com o alvo para 'Abrir no Storage'", () => {
    const { items } = buildStorageAttribution(
      requests,
      [
        change({ timestamp: 250, key: "auth.token" }),
        change({ timestamp: 260, providerLabel: "MMKV", providerId: "mmkv", key: "auth.user" }),
      ],
      1500,
    );
    const r2 = items.get("r2");
    expect(r2).toHaveLength(2);
    expect(r2?.map((i) => (i.target.kind === "key-value" ? i.target.key : ""))).toEqual([
      "auth.token",
      "auth.user",
    ]);
  });

  it("sem requests → sem atribuição", () => {
    const { counts } = buildStorageAttribution([], [change({ timestamp: 250 })], 1500);
    expect(counts.size).toBe(0);
  });
});

describe("groupImpact", () => {
  it("agrupa por provider + instância", () => {
    const { items } = buildStorageAttribution(
      requests,
      [
        change({ timestamp: 250, providerId: "mmkv", providerLabel: "MMKV", key: "a" }),
        change({ timestamp: 255, providerId: "mmkv", providerLabel: "MMKV", key: "b" }),
        change({ timestamp: 258, providerId: "async-storage", providerLabel: "AsyncStorage", key: "c" }),
      ],
      1500,
    );
    const groups = groupImpact(items.get("r2") ?? []);
    expect(groups).toHaveLength(2);
    const mmkv = groups.find((g) => g.providerId === "mmkv");
    expect(mmkv?.items).toHaveLength(2);
  });
});
