# NativeScope

NativeScope is a fully local debugging studio for React Native. Its first
module discovers and edits AsyncStorage, MMKV, and expo-sqlite while the app is
running, with no provider, root wrapper, or instance registry.

```bash
npm install --save-dev react-native-nativescope
npx nativescope
```

NativeScope creates or composes a reversible `metro.config.js`, starts Metro,
maintains the Android `adb reverse` tunnel, and opens the Studio. Release
builds bypass every instrumentation shim.

## Optional app reactivity

Storage discovery and bidirectional editing need no app config. Add one root
file only when cached screens should react immediately to Studio edits:

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

`reactQuery: true` discovers QueryClient instances automatically and
invalidates them only for Studio-originated changes. `indicator: true` shows a
small in-app confirmation. Both options are development-only and optional.

Read the complete documentation at [nativescope.dev](https://nativescope.dev).

## Repository

| Path | Purpose |
| --- | --- |
| `apps/cli` | Public npm package, local server, Metro resolver, and shims |
| `apps/desktop` | Browser-based NativeScope Studio |
| `apps/playground` | Expo integration and release-bundle fixture |
| `apps/site` | Landing page, documentation, journal, and comparison pages |
| `packages/protocol` | Versioned wire schemas and payload budgets |
| `packages/runtime` | On-device registry, adapters, streams, and transport |
| `packages/testkit` | Contract, scale-budget, and adapter fixtures |

## Development

```bash
pnpm install --frozen-lockfile
pnpm -r typecheck
pnpm -r test
pnpm --filter react-native-nativescope build
node apps/cli/dist/cli.mjs --fake --no-open
```

The public-package build embeds the compiled Studio in `apps/cli/dist/ui`.
CI verifies that the npm tarball contains that UI, contains no workspace-only
dependencies, and that a real Expo release bundle contains no NativeScope shim
marker.

## License

[MIT](LICENSE)
