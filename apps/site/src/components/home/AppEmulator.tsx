"use client";

import { Bell, Mail, Volume2, Moon, Sun, Minus, Plus } from "lucide-react";
import type { Pulse } from "./JsonInspector";

const ACCENTS: Record<string, string> = { coral: "#d97757", sky: "#4a7fb5", moss: "#5c8a5c" };
const PLAN_CYCLE: Record<string, string> = { free: "pro", pro: "team", team: "free" };

function get(obj: unknown, path: (string | number)[]): unknown {
  return path.reduce<unknown>((o, k) => (o == null ? o : (o as Record<string, unknown>)[k as string]), obj);
}

/**
 * Réplica de um app real ligado ao MESMO estado do inspector. Cada controle
 * escreve num caminho do JSON; editar a tabela reflete aqui e vice-versa. O
 * pulse acende o campo exato dos dois lados.
 */
export function AppEmulator({
  data,
  onChange,
  pulse,
}: {
  data: unknown;
  onChange: (path: (string | number)[], value: unknown) => void;
  pulse: Pulse;
}) {
  const theme = String(get(data, ["appearance", "theme"]));
  const accentKey = String(get(data, ["appearance", "accent"]));
  const accent = ACCENTS[accentKey] ?? ACCENTS.coral;
  const name = String(get(data, ["profile", "displayName"]));
  const handle = String(get(data, ["profile", "handle"]));
  const plan = String(get(data, ["profile", "plan"]));
  const push = get(data, ["notifications", "push"]) === true;
  const email = get(data, ["notifications", "email"]) === true;
  const sound = get(data, ["notifications", "sound"]) === true;
  const digest = String(get(data, ["notifications", "digest"]));
  const fontScale = Number(get(data, ["appearance", "fontScale"])) || 1;
  const initials = name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  function Flash({ p }: { p: string }) {
    const id = pulse && pulse.path.join(".") === p ? pulse.id : null;
    return id ? <span key={id} data-json-flash aria-hidden /> : null;
  }

  return (
    <div data-emu>
      <div
        data-emu-phone
        data-theme={theme}
        style={{ ["--p-accent" as string]: accent, ["--p-scale" as string]: String(fontScale) }}
      >
        <span data-emu-notch aria-hidden />
        <div data-emu-screen>
          <div data-emu-statusbar aria-hidden>
            <span>9:41</span>
            <span data-emu-signal><i /><i /><i /><b /></span>
          </div>

          <div data-emu-scroll>
            <header data-emu-profile>
              <span data-emu-avatar aria-hidden>{initials}</span>
              <div data-emu-ident>
                <strong data-emu-name><Flash p="profile.displayName" />{name}</strong>
                <span data-emu-handle>{handle}</span>
              </div>
              <button type="button" data-emu-plan onClick={() => onChange(["profile", "plan"], PLAN_CYCLE[plan] ?? "free")}>
                <Flash p="profile.plan" />
                {plan}
              </button>
            </header>

            <p data-emu-label>Appearance</p>
            <div data-emu-card>
              <div data-emu-row>
                <Flash p="appearance.theme" />
                <span data-emu-rowlabel>Theme</span>
                <div data-emu-seg>
                  <button type="button" data-active={theme === "light" || undefined} onClick={() => onChange(["appearance", "theme"], "light")}>
                    <Sun size={12} strokeWidth={1.6} />Light
                  </button>
                  <button type="button" data-active={theme === "dark" || undefined} onClick={() => onChange(["appearance", "theme"], "dark")}>
                    <Moon size={12} strokeWidth={1.6} />Dark
                  </button>
                </div>
              </div>
              <div data-emu-row>
                <Flash p="appearance.accent" />
                <span data-emu-rowlabel>Accent</span>
                <div data-emu-swatches>
                  {Object.entries(ACCENTS).map(([k, c]) => (
                    <button
                      key={k}
                      type="button"
                      data-active={accentKey === k || undefined}
                      style={{ background: c }}
                      onClick={() => onChange(["appearance", "accent"], k)}
                      aria-label={k}
                    />
                  ))}
                </div>
              </div>
              <div data-emu-row>
                <Flash p="appearance.fontScale" />
                <span data-emu-rowlabel>Text size</span>
                <div data-emu-stepper>
                  <button type="button" onClick={() => onChange(["appearance", "fontScale"], Math.max(0.8, +(fontScale - 0.1).toFixed(1)))} aria-label="Diminuir"><Minus size={13} strokeWidth={1.8} /></button>
                  <b>{fontScale.toFixed(1)}×</b>
                  <button type="button" onClick={() => onChange(["appearance", "fontScale"], Math.min(1.6, +(fontScale + 0.1).toFixed(1)))} aria-label="Aumentar"><Plus size={13} strokeWidth={1.8} /></button>
                </div>
              </div>
            </div>

            <p data-emu-label>Notifications</p>
            <div data-emu-card>
              <button type="button" data-emu-row data-tap onClick={() => onChange(["notifications", "push"], !push)}>
                <Flash p="notifications.push" />
                <Bell size={15} strokeWidth={1.6} data-emu-ic />
                <span data-emu-rowlabel>Push</span>
                <span data-emu-switch data-on={push || undefined}><span /></span>
              </button>
              <button type="button" data-emu-row data-tap onClick={() => onChange(["notifications", "email"], !email)}>
                <Flash p="notifications.email" />
                <Mail size={15} strokeWidth={1.6} data-emu-ic />
                <span data-emu-rowlabel>Email</span>
                <span data-emu-switch data-on={email || undefined}><span /></span>
              </button>
              <button type="button" data-emu-row data-tap onClick={() => onChange(["notifications", "sound"], !sound)}>
                <Flash p="notifications.sound" />
                <Volume2 size={15} strokeWidth={1.6} data-emu-ic />
                <span data-emu-rowlabel>Sound</span>
                <span data-emu-switch data-on={sound || undefined}><span /></span>
              </button>
              <div data-emu-row>
                <Flash p="notifications.digest" />
                <span data-emu-rowlabel>Digest</span>
                <div data-emu-seg>
                  {["off", "daily", "weekly"].map((o) => (
                    <button key={o} type="button" data-active={digest === o || undefined} onClick={() => onChange(["notifications", "digest"], o)}>
                      {o}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div data-emu-foot>
              <span data-emu-live aria-hidden />
              live from the app
            </div>
          </div>
        </div>
      </div>
      <p data-emu-cap>Tap anything — the table lights the exact field. Edit the table — the app reacts.</p>
    </div>
  );
}
