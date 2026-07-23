"use client";

import { useEffect, useState } from "react";
import { JsonInspector, setAtPath, type Pulse } from "./JsonInspector";
import { AppEmulator } from "./AppEmulator";

/**
 * Hands-on da home: o produto de verdade rodando no browser. O inspector é a
 * porta fiel do dashboard (mesmas classes/tokens) e o emulador é um app ligado
 * ao MESMO estado. Editar de um lado acende o campo exato do outro.
 *
 * "Gigante" é sensação, não DOM: `events` tem centenas de itens, mas a
 * virtualização (a mesma do Studio) mantém ~30 nós na tela.
 */

type Json = Record<string, unknown>;

function buildInitial(): Json {
  return {
    profile: {
      displayName: "Ada Lovelace",
      handle: "@ada",
      plan: "pro",
      memberSince: 2021,
    },
    appearance: {
      theme: "dark",
      accent: "coral",
      fontScale: 1,
      reduceMotion: false,
    },
    notifications: {
      push: true,
      email: false,
      sound: true,
      digest: "weekly",
    },
    badges: { unread: 3, mentions: 1 },
    session: {
      token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI5MDQzMiJ9.7sIgnA",
      lastSeen: 1721490000,
      devices: [
        { id: "iphone-15", platform: "ios", version: "17.4", current: true },
        { id: "pixel-8", platform: "android", version: "14", current: false },
        { id: "web-chrome", platform: "web", version: "126", current: false },
      ],
    },
    cache: {
      sizeKb: 4192,
      entries: { user: 1, feed: 88, search: 12, media: 341 },
      events: Array.from({ length: 840 }, (_, i) => ({
        index: i,
        status: i % 11 === 0 ? "error" : i % 4 === 0 ? "stale" : "done",
        ms: 40 + ((i * 37) % 920),
        route: `/api/v${1 + (i % 3)}/items`,
      })),
    },
  };
}

export function StorageDemo() {
  const [data, setData] = useState<Json>(buildInitial);
  const [pulse, setPulse] = useState<Pulse>(null);

  useEffect(() => {
    const root = document.documentElement;
    const syncTheme = () => {
      const pageTheme = root.classList.contains("dark") ? "dark" : "light";
      setData((current) => {
        if (current.appearance && typeof current.appearance === "object") {
          const appearance = current.appearance as Record<string, unknown>;
          if (appearance.theme === pageTheme) return current;
          return { ...current, appearance: { ...appearance, theme: pageTheme } };
        }
        return current;
      });
    };

    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  function firePulse(path: (string | number)[]) {
    setPulse((p) => ({ path, id: (p?.id ?? 0) + 1 }));
  }

  // Edição vinda do inspector: já entrega o valor raiz novo + o caminho alterado.
  function handleInspectorChange(nextValue: unknown, changedPath: (string | number)[]) {
    setData(nextValue as Json);
    firePulse(changedPath);
  }

  // Ação vinda do app: aplica no caminho e pulsa.
  function handleEmulatorChange(path: (string | number)[], value: unknown) {
    setData((d) => setAtPath(d, path, value) as Json);
    firePulse(path);
  }

  return (
    <section data-storage-demo aria-labelledby="demo-heading">
      <header data-demo-head>
        <p data-section-kicker>A hands-on taste — the real product, in your browser</p>
        <h2 id="demo-heading">
          Your storage is a nested mess.
          <br />
          Go ahead — edit it anyway.
        </h2>
        <p>
          Every inspector hands a value back as a raw tree and wishes you luck. We built a table you
          can actually work in. Change something on the left and watch the app react live — then tap
          the app and watch the exact field light up. This is the Studio, running right here.
        </p>
      </header>

      <div data-demo-stage>
        <JsonInspector
          value={data}
          sourceName="@user_session"
          onChange={handleInspectorChange}
          pulse={pulse}
        />
        <AppEmulator data={data} onChange={handleEmulatorChange} pulse={pulse} />
      </div>
    </section>
  );
}
