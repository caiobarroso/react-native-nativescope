<p align="center">
  <img src="https://github.com/caiobarroso/react-native-nativescope/raw/main/assets/nativescope-banner.png" alt="NativeScope" width="100%" />
</p>

# NativeScope

**A fully local debugging environment for React Native.**

NativeScope is a plug-and-play debug environment for React Native apps. It is designed to grow as a local Studio with focused modules, simple configuration, and no hosted data path.

The first module is **Storage**: automatic discovery and professional tooling for AsyncStorage, MMKV, and expo-sqlite while your app is running.

No account. No cloud. No provider. No root wrapper. Your development data stays on your machine.

```bash
npm install --save-dev react-native-nativescope
npx nativescope
```

Open your app normally. NativeScope composes Metro in development, maintains the Android `adb reverse` tunnel when needed, opens the Studio, and bypasses every instrumentation shim in release builds.

## What ships today

- Storage discovery for AsyncStorage, MMKV, and expo-sqlite.
- Realtime, bidirectional editing between the Studio and the running app.
- Visual JSON navigation for nested objects, arrays, inline edits, and TypeScript shape export.
- SQLite table tooling with tabs, sorting, selection, inline edits, inserts, and SQL execution.
- Snapshots and diff to compare storage changes and restore safely.
- A local-first workflow over `127.0.0.1`, with no login, telemetry, or hosted data path.

## Optional app reactivity

Core Storage discovery does not require app code or a config file. Add this only when app screens should react immediately after Studio-originated storage edits:

```ts
// nativescope.config.ts
import { defineNativeScopeConfig } from "react-native-nativescope/app";

export default defineNativeScopeConfig({
  modules: {
    storage: {
      reactQuery: true,
      indicator: true,
    },
  },
});
```

`reactQuery: true` automatically finds QueryClient instances and invalidates them after Studio edits. `indicator: true` shows a small in-app confirmation when storage is updated from the Studio.

## Documentation

Read the quickstart, configuration guide, and engineering notes at [nativescope.dev](https://nativescope.dev).

## License

MIT
