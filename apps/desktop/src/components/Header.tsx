import { useStudio } from "../lib/store.ts";
import { switchDevice } from "../lib/studio-client.ts";
import { Search } from "lucide-react";
import { SnapshotTool } from "./SnapshotTool.tsx";
import { StorageRealtimeStatus } from "./StorageRealtimeStatus.tsx";

export function Header() {
  const phase = useStudio((s) => s.phase);
  const activeModule = useStudio((s) => s.activeModule);
  const devices = useStudio((s) => s.devices);
  const selectedDeviceId = useStudio((s) => s.selectedDeviceId);
  const selectedDevice = devices.find((device) => device.deviceId === selectedDeviceId) ?? null;
  const isStorageModule = activeModule === "storage";

  return (
    <header className="flex h-11 items-center gap-3 border-b border-border bg-surface px-4">
      <div className="flex h-full items-center" aria-label="NativeScope">
        <img
          src="/brand/nativescope-logo.png"
          alt="NativeScope"
          className="h-[18px] w-auto dark:hidden"
        />
        <img
          src="/brand/nativescope-logo-reversed.png"
          alt=""
          aria-hidden="true"
          className="hidden h-[18px] w-auto dark:block"
        />
      </div>

      <div className="ml-auto flex min-w-0 items-center gap-2.5">
        {isStorageModule && (
          <>
            <div className="flex shrink-0 items-center gap-1.5" aria-label="Storage module actions">
              <button
                onClick={() => window.dispatchEvent(new Event("nativescope:open-global-search"))}
                title="Search storage (Ctrl or Cmd K)"
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface-raised px-2 text-[11px] text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
              >
                <Search size={13} strokeWidth={1.5} />
                <span>Search storage</span>
                <kbd className="rounded border border-border bg-surface-sunken px-1 font-mono text-[9px] text-text-subtle">
                  Ctrl K
                </kbd>
              </button>
              {phase === "connected" && (
                <StorageRealtimeStatus enabled={selectedDevice?.storageReactQuerySync ?? null} />
              )}
              {phase === "connected" && <SnapshotTool />}
            </div>

            <div className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
          </>
        )}

        <div className="flex min-w-0 items-center gap-2" aria-label="Device connection">
          {devices.length === 1 && (
            <span className="min-w-0 truncate text-[12px] text-text-muted">
              {devices[0]!.name}
              <span className="text-text-subtle"> · {devices[0]!.label}</span>
            </span>
          )}
          {devices.length >= 2 && (
            <div
              role="tablist"
              aria-label="Connected devices"
              className="flex items-center gap-0.5 rounded-md bg-surface-sunken p-0.5"
            >
              {devices.map((d) => {
                const active = d.deviceId === selectedDeviceId;
                return (
                  <button
                    key={d.deviceId}
                    role="tab"
                    aria-selected={active}
                    onClick={() => switchDevice(d.deviceId)}
                    title={`${d.name} · ${d.label}`}
                    className={`rounded px-2 py-1 text-[12px] transition-colors ${
                      active
                        ? "bg-surface-raised text-text shadow-sm"
                        : "text-text-muted hover:text-text"
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          )}
          <span className="flex shrink-0 items-center gap-1.5">
            <span
              className={`h-2 w-2 rounded-full ${
                phase === "connected"
                  ? "bg-created"
                  : phase === "waiting-app"
                    ? "bg-updated"
                    : "bg-text-subtle"
              }`}
            />
            <span className="text-text-muted">
              {phase === "connected"
                ? "connected"
                : phase === "waiting-app"
                  ? "waiting for app"
                  : // "rejected" é terminal: dizer "connecting" contradiria a tela.
                    phase === "rejected" || phase === "no-token"
                    ? "disconnected"
                    : "connecting"}
            </span>
          </span>
        </div>
      </div>
    </header>
  );
}
