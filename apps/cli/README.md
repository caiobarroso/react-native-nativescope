<p align="center">
  <img src="https://github.com/caiobarroso/react-native-nativescope/raw/main/assets/nativescope-banner.png" alt="NativeScope" width="100%" />
</p>

# NativeScope

**A fully local debugging environment for React Native.**

NativeScope is a plug-and-play debug environment for React Native apps. It is designed to grow as a local Studio with focused modules, simple configuration, and no hosted data path.

Three modules ship today:

- **Storage** automatically discovers AsyncStorage, MMKV, expo-sqlite, and op-sqlite and adds professional inspection, editing, diff, restore, JSON, and SQL tooling.
- **Network** captures HTTP and GraphQL operations in one timeline with structured replay, filters, capture sessions, performance insights, and automatic storage impact.
- **Logs** captures JavaScript console output from boot, keeps structured values and stacks inspectable, protects the app from noisy bursts, and opens useful moments in Timeline.

**Timeline** is the shared desktop lens across the modules. Start from a log, error, failed request or
Mark, then see Logs, Network and Storage together around that moment.

No account. No cloud. No provider. No root wrapper. Your development data stays on your machine.

```bash
npm install --save-dev react-native-nativescope
npx nativescope
```

Open your app normally. NativeScope composes Metro in development, maintains the Android `adb reverse` tunnel when needed, opens the Studio, and bypasses every instrumentation shim in release builds.

## What ships today

- Storage discovery for AsyncStorage, MMKV, expo-sqlite, and op-sqlite.
- Realtime, bidirectional editing between the Studio and the running app.
- Visual JSON navigation for nested objects, arrays, inline edits, and TypeScript shape export.
- SQLite table tooling with tabs, sorting, selection, inline edits, inserts, bulk delete, and SQL execution.
- Snapshots and diff to compare storage changes and restore safely.
- HTTP and GraphQL inspection with structured replay, session insights, sound rules, and storage impact.
- JavaScript log inspection with namespaces, structured values, stacks, repeat grouping, burst limits, Marks, and Timeline.
- A local-first workflow over `127.0.0.1`, with no login, telemetry, or hosted data path.

## Optional modules and app reactivity

Core Storage discovery does not require app code or a config file. Add one root config file to enable Network or make app screens react immediately after Studio-originated storage edits:

```ts
// nativescope.config.ts
import { defineNativeScopeConfig } from "react-native-nativescope/app";

export default defineNativeScopeConfig({
  modules: {
    network: true,
    logs: true,
    storage: {
      reactQuery: true,
      indicator: true,
    },
  },
});
```

`network: true` enables HTTP and GraphQL capture. `logs: true` captures JavaScript console output and global errors in development. `reactQuery: true` automatically finds QueryClient instances and invalidates them after Studio edits. `indicator: true` shows a small in-app confirmation when storage is updated from the Studio. Every option is development-only.

## Documentation

Read the quickstart, configuration guide, and engineering notes at [nativescope.dev](https://nativescope.dev).

## License

MIT
