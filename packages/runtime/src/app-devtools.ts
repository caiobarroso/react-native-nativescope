import type { ChangeSource, KeyEntry } from "@rnsi/protocol";
import type { DatabaseChange, KeyValueChange } from "./adapter.ts";

export type AppDevtoolsChange =
  | {
      kind: "key-value";
      providerId: string;
      instanceId: string;
      key: string;
      change: KeyValueChange["change"];
      source: ChangeSource;
      entry: KeyEntry | null;
      timestamp: number;
    }
  | {
      kind: "database";
      providerId: string;
      instanceId: string;
      table: string;
      rowId: number | null;
      operation: DatabaseChange["operation"];
      source: ChangeSource;
      timestamp: number;
    };

type AppDevtoolsBus = {
  version: number;
  lastEvent: AppDevtoolsChange | null;
  listeners: Set<(event: AppDevtoolsChange) => void>;
};

const GLOBAL_KEY = "__RNSI_APP_DEVTOOLS__";

function getBus(): AppDevtoolsBus {
  const root = globalThis as unknown as Record<string, AppDevtoolsBus | undefined>;
  let bus = root[GLOBAL_KEY];
  if (!bus) {
    bus = { version: 0, lastEvent: null, listeners: new Set() };
    root[GLOBAL_KEY] = bus;
  }
  return bus;
}

export function emitAppDevtoolsChange(event: AppDevtoolsChange): void {
  const bus = getBus();
  bus.version += 1;
  bus.lastEvent = event;
  for (const listener of bus.listeners) {
    try {
      listener(event);
    } catch {
      /* never let app-side devtools listeners affect app execution */
    }
  }
}
