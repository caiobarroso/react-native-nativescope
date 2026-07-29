# NativeScope Playground

A tiny Expo app that exercises the real NativeScope stack end to end — the
Metro resolver, the injection seam, the shims, and the live Studio. Use it to
verify changes on a real device (not the `--fake` simulated runtime).

It has four bottom tabs. The storage screens are wired with React Query so
edits from the Studio show up live on screen:

- 🦁 **Zoo** — MMKV (nested arrays, high volume)
- 🧸 **Toys** — AsyncStorage (a small CRUD)
- 🏆 **Scores** — SQLite (a leaderboard, high volume)
- 🌐 **Request** — Network, divided into HTTP and GraphQL scenarios

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
    ✓ Network inspector
  ```

- The app boots with the four tabs.
- The Studio shows all three storages (MMKV, AsyncStorage, SQLite) — ideally
  together, not one-at-a-time.
- The Studio shows **Network → Requests** and records both HTTP and GraphQL in
  the same timeline.
- Edit a value in the Studio → the app flashes the "Storage updated" toast and
  the affected screen refreshes (React Query invalidation).

## Test the Network module

Open the **Request** tab in the app. Its segmented control keeps HTTP and
GraphQL scenarios separate in the playground while NativeScope displays both
protocols in one Network timeline.

### HTTP

The HTTP side uses public HTTPS endpoints and covers:

| Action           | What it validates                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------- |
| **Sign in**      | POST body, JSON response and Storage impact on AsyncStorage `auth.token` and MMKV `user` |
| **Load profile** | Authorization header, authenticated GET and Storage impact on MMKV `profile`             |
| **Browse ×3**    | Three concurrent requests to the same endpoint and request grouping                      |
| **Trigger 404**  | HTTP error status, status filters and error styling                                      |
| **Plain text**   | A complete non-JSON response with safe line wrapping                                     |

Run **Sign in** before **Load profile** so the authenticated request has a
current token.

### GraphQL

The GraphQL side uses GraphQLZero and covers:

| Action            | What it validates                                                                     |
| ----------------- | ------------------------------------------------------------------------------------- |
| **Get user**      | Named query, variables, nested data and Storage impact on MMKV `graphql.user`         |
| **Get posts**     | Named query with nested input variables and collection data                           |
| **Create post**   | Mutation, variables, replay editing and Storage impact on MMKV `graphql.lastMutation` |
| **GraphQL error** | A semantic GraphQL error returned over HTTP 200                                       |

In the Studio, verify that GraphQL rows use operation names instead of becoming
identical `POST /graphql` entries. Open a request to inspect the formatted
operation, variables, data and errors separately. HTTP and GraphQL requests
should also appear together in Network Insights.

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

`nativescope.config.js` enables both modules:

```js
module.exports = {
  modules: {
    storage: {
      indicator: true,
      reactQuery: true,
    },
    network: true,
  },
};
```

Storage uses the in-app indicator (the coral "Storage updated" toast) and the
React Query bridge installed by `installNativeScopeDevtools` in `App.js`.
Network instruments the global development `fetch` and `XMLHttpRequest`
surfaces. All of this is development-only.
