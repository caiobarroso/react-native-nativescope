export const HELP_TEXT = `NativeScope

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
  --no-metro           Start the Studio without starting Metro
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
