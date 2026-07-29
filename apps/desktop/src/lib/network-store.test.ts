import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NetworkRequest } from "@rnsi/protocol";
import { useNetwork } from "./network-store.ts";

function request(id: string): NetworkRequest {
  return {
    id,
    method: "GET",
    url: `https://api.example.com/${id}`,
    origin: "https://api.example.com",
    path: `/${id}`,
    query: null,
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
  };
}

describe("network capture state", () => {
  beforeEach(() => {
    useNetwork.getState().reset();
    useNetwork
      .getState()
      .setSound({ mode: "off", endpointRules: [], volume: 0.7 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves earlier requests behind a new capture boundary", () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(1234);
    useNetwork.getState().addRequest(request("before"));
    useNetwork.getState().startNewCapture();
    useNetwork.getState().addRequest(request("after"));

    const state = useNetwork.getState();
    expect(state.requests.map((item) => item.id)).toEqual(["after", "before"]);
    expect(state.sessionStartedAt).toBe(1234);
    expect(state.sessionEarlierIds).toEqual(["before"]);
  });

  it("can discard only the requests before the active boundary", () => {
    useNetwork.getState().addRequest(request("before"));
    useNetwork.getState().startNewCapture();
    useNetwork.getState().addRequest(request("after"));
    useNetwork.getState().clearEarlier();

    const state = useNetwork.getState();
    expect(state.requests.map((item) => item.id)).toEqual(["after"]);
    expect(state.sessionStartedAt).toBeNull();
    expect(state.byId.before).toBeUndefined();
  });

  it("ignores incoming requests while capture is paused", () => {
    useNetwork.getState().setCapturePaused(true);
    useNetwork.getState().addRequest(request("ignored"));
    expect(useNetwork.getState().requests).toHaveLength(0);

    useNetwork.getState().setCapturePaused(false);
    useNetwork.getState().addRequest(request("captured"));
    expect(useNetwork.getState().requests.map((item) => item.id)).toEqual([
      "captured",
    ]);
  });

  it("clears the list without changing sound preferences or pause state", () => {
    useNetwork
      .getState()
      .setSound({ mode: "errors", endpointRules: [], volume: 0.7 });
    useNetwork.getState().setCapturePaused(false);
    useNetwork.getState().addRequest(request("one"));
    useNetwork.getState().clearRequests();

    const state = useNetwork.getState();
    expect(state.requests).toHaveLength(0);
    expect(state.sound.mode).toBe("errors");
    expect(state.capturePaused).toBe(false);
  });
});
