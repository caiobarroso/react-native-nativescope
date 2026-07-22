import { useStudio } from "../lib/store.ts";
import { switchDevice } from "../lib/studio-client.ts";
import { SnapshotTool } from "./SnapshotTool.tsx";

export function Header() {
  const phase = useStudio((s) => s.phase);
  const devices = useStudio((s) => s.devices);
  const selectedDeviceId = useStudio((s) => s.selectedDeviceId);

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

      <div className="ml-auto flex items-center gap-3">
        {phase === "connected" && <SnapshotTool />}
        {devices.length === 1 && (
          <span className="text-text-muted">
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
        <span className="flex items-center gap-1.5">
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
    </header>
  );
}
