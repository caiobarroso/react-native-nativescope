export { installLogsModule } from "./install.ts";
export {
  normalizeLogsOptions,
  isIgnoredMessage,
  serializeArg,
  formatMessage,
  deriveNamespace,
  isSameLogLine,
  createLogBatcher,
  LOG_LEVELS,
  type LogsOptions,
  type LogBatcher,
} from "./capture.ts";
