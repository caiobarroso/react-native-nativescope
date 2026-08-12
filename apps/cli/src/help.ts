export const HELP_TEXT = `NativeScope

Runs the Studio and, unless you pass --no-metro, starts your project's Metro
(npx expo start / npx react-native start) in this same terminal with an explicit
port. NativeScope prints the exact command it owns. Do not start Metro in
another terminal at the same time: a second bundler creates a competing bundle.

Usage:
  nativescope [options]
  nativescope init [options]

Commands:
  init                 Create nativescope.config.ts

Options:
  --project <path>     React Native project directory (default: current directory)
  --port <number>      Local Studio port
  --token <value>      Override the persistent session token
  --new-token          Rotate the persistent session token
  --lan                Allow a physical iPhone on the same trusted network to connect
  --no-open            Do not open the Studio in a browser
  --no-metro           Start the Studio only; you start Metro yourself
  --fake               Connect the bundled simulated app
  --fake-scale         Populate the simulated app with large datasets
  --help, -h           Show this help

Examples:
  npx nativescope
  npx nativescope init
  npx nativescope --lan
  npx nativescope --no-metro --no-open

Documentation: https://nativescope.dev/docs
`;
