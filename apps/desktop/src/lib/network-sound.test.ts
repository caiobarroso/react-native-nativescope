import { describe, expect, it } from "vitest";
import type { NetworkRequest } from "@rnsi/protocol";
import {
  clampVolume,
  requestMatchesSoundRule,
  shouldPlayNetworkSound,
  type NetworkSoundSettings,
} from "./network-sound.ts";

function request(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: "request-1",
    method: "POST",
    url: "https://api.example.com/auth/login?source=app",
    origin: "https://api.example.com",
    path: "/auth/login",
    query: "source=app",
    status: 200,
    ok: true,
    error: null,
    startedAt: 1,
    endedAt: 2,
    duration: 1,
    requestSize: 0,
    responseSize: 0,
    requestHeaders: {},
    responseHeaders: {},
    requestBody: null,
    responseBody: null,
    ...overrides,
  };
}

describe("network sound rules", () => {
  it("matches paths, method + path and wildcard rules", () => {
    const value = request();
    expect(requestMatchesSoundRule(value, "/auth/login")).toBe(true);
    expect(requestMatchesSoundRule(value, "POST /auth/login")).toBe(true);
    expect(requestMatchesSoundRule(value, "POST /auth/*")).toBe(true);
    expect(requestMatchesSoundRule(value, "GET /auth/*")).toBe(false);
  });

  it("supports all, errors and endpoint-only modes", () => {
    const all: NetworkSoundSettings = {
      mode: "all",
      endpointRules: [],
      volume: 0.7,
    };
    const errors: NetworkSoundSettings = {
      mode: "errors",
      endpointRules: [],
      volume: 0.7,
    };
    const endpoints: NetworkSoundSettings = {
      mode: "endpoints",
      endpointRules: ["POST /auth/*"],
      volume: 0.7,
    };

    expect(shouldPlayNetworkSound(request(), all)).toBe(true);
    expect(shouldPlayNetworkSound(request(), errors)).toBe(false);
    expect(
      shouldPlayNetworkSound(request({ status: 500, ok: false }), errors),
    ).toBe(true);
    expect(shouldPlayNetworkSound(request(), endpoints)).toBe(true);
    expect(
      shouldPlayNetworkSound(request({ path: "/products" }), endpoints),
    ).toBe(false);
  });

  it("keeps persisted volume inside the Web Audio gain range", () => {
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume(0.65)).toBe(0.65);
    expect(clampVolume(2)).toBe(1);
    expect(clampVolume(Number.NaN)).toBe(0.7);
  });
});
