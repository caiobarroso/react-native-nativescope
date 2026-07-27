# NativeScope Playground

A tiny Expo app that exercises the real NativeScope stack end to end — the
Metro resolver, the injection seam, the shims, and the live Studio. Use it to
verify changes on a real device (not the `--fake` simulated runtime).

It has three bottom tabs, all wired with React Query so edits from the Studio
show up live on screen:

- 🦁 **Zoo** — MMKV (nested arrays, high volume)
- 🧸 **Toys** — AsyncStorage (a small CRUD)
- 🏆 **Scores** — SQLite (a leaderboard, high volume)

The playground is intentionally **excluded from the pnpm workspace** and installs
its own `node_modules` with `react-native-nativescope` linked as `file:../cli`.
So it always runs against your local CLI build.

## Prerequisites

```bash
# 1. Build the local CLI + runtime bundle (from the repo root)
pnpm --filter react-native-nativescope build

# 2. Install the playground's own deps (first time only)
cd apps/playground && npm install
```

Re-run the CLI build (step 1) whenever you change anything under
`apps/cli/metro`, `apps/cli/src`, or `packages/runtime` — the playground picks
up the fresh build through the `file:../cli` link.

## Run it on the iOS Simulator

Two terminals. Terminal 1 serves the Studio + WebSocket and writes the session
file; Terminal 2 builds the native app and runs its own Metro.

```bash
# Terminal 1 — inspector only (no Metro; the app brings its own)
cd apps/playground
npx nativescope --no-metro --no-open
```

```bash
# Terminal 2 — build + run the app on the booted simulator
cd apps/playground
npx expo run:ios
```

Then open the Studio URL that Terminal 1 printed (it includes the session token):

```
http://127.0.0.1:4782/?token=<printed-token>
```

> **Port already in use?** The default WebSocket port is `4782`. If another
> NativeScope is running (e.g. a second app), pass a free port to Terminal 1 —
> `npx nativescope --no-metro --no-open --port 4783` — and open the Studio on
> that port. The app reads the port from the session file automatically.
>
> If `expo run:ios` reports Metro's port `8081` is taken, accept its offer to
> use another one.

## What "working" looks like

- Terminal 1 prints the module status, e.g.:

  ```
  Config: nativescope.config.js
  Modules enabled:
    ✓ Storage inspector
  ```

- The app boots with the three tabs.
- The Studio shows all three storages (MMKV, AsyncStorage, SQLite) — ideally
  together, not one-at-a-time.
- Edit a value in the Studio → the app flashes the "Storage updated" toast and
  the affected screen refreshes (React Query invalidation).

## Quick check without a native build

To sanity-check the Studio itself with a simulated device (no simulator, no
build), run from the repo root:

```bash
node apps/cli/dist/cli.mjs --fake --no-open
```

This connects a fake runtime full of storage data. It exercises the Studio and
server, but **not** the app, the injection seam, or module gating — for those,
use the real simulator flow above.

## Config

`nativescope.config.js` enables the in-app indicator (the coral "Storage
updated" toast). The React Query bridge is installed in `App.js` via
`installNativeScopeDevtools`. Both are development-only.
