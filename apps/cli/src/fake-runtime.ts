import { WebSocket } from "ws";
import { startRuntime, createMemoryAdapter } from "@rnsi/runtime";
import type { WebSocketLike } from "@rnsi/runtime";

/**
 * Runtime falso para desenvolvimento e E2E da UI sem device.
 *
 * Sobe o runtime real (mesmo código que roda no app) com um adapter de
 * memória, e simula atividade de app: token renovando, fila de sync
 * crescendo e drenando, feature flag alternando.
 */
export function startFakeRuntime(options: { port: number; sessionToken: string }) {
  const adapter = createMemoryAdapter({
    providerId: "async-storage",
    label: "AsyncStorage",
    seed: {
      default: {
        "auth.token": { type: "string", value: "eyJhbGciOiJIUzI1NiJ9.fake" },
        "user.profile": {
          type: "json",
          value: JSON.stringify({ name: "Caio", premium: false }),
        },
        "feature.flags": {
          type: "json",
          value: JSON.stringify({ newCheckout: true, darkLaunch: false }),
        },
        "sync.queue": { type: "json", value: "[]" },
        "device.info": { type: "json", value: JSON.stringify({ model: "Pixel 8" }) },
        "onboarding.done": { type: "boolean", value: true },
        "session.count": { type: "number", value: 7 },
      },
    },
  });

  const runtime = startRuntime({
    url: `ws://127.0.0.1:${options.port}`,
    sessionToken: options.sessionToken,
    client: { name: "app-playground (fake)", platform: "android" },
    createWebSocket: (url) => new WebSocket(url) as unknown as WebSocketLike,
  });

  runtime.registry.register(adapter);

  let sessionCount = 7;
  let queue: string[] = [];

  const timers = [
    // token renova a cada 8s
    setInterval(() => {
      adapter.writeFromApp("default", "auth.token", {
        type: "string",
        value: `eyJhbGciOiJIUzI1NiJ9.${Math.random().toString(36).slice(2)}`,
      });
    }, 8000),

    // fila de sync cresce e drena
    setInterval(() => {
      if (queue.length >= 3) {
        queue = [];
      } else {
        queue.push(`visit-${Date.now()}`);
      }
      adapter.writeFromApp("default", "sync.queue", {
        type: "json",
        value: JSON.stringify(queue),
      });
    }, 5000),

    // contador de sessão
    setInterval(() => {
      sessionCount += 1;
      adapter.writeFromApp("default", "session.count", {
        type: "number",
        value: sessionCount,
      });
    }, 13000),
  ];

  return {
    close() {
      for (const t of timers) clearInterval(t);
      runtime.close();
    },
  };
}
