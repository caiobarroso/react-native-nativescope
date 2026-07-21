# NativeScope

NativeScope is a local, plug-and-play debugging studio for React Native. Its
storage module discovers AsyncStorage, MMKV, and expo-sqlite automatically,
then lets you inspect and edit live app data from the browser.

```bash
npm install --save-dev react-native-nativescope
npx nativescope
```

Open the app normally. NativeScope starts Metro, maintains the Android
`adb reverse` tunnel when needed, and opens the Studio. Core storage discovery
does not require app code or a config file.

See the [quickstart](https://nativescope.dev/docs/quickstart) for optional
React Query invalidation, the in-app update indicator, and manual Metro setup.

- Fully local: no account, telemetry, or cloud service.
- Development-only Metro instrumentation.
- Realtime, bidirectional editing.
- MIT licensed.
