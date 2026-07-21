import { useStudio } from "../lib/store.ts";
import { SnapshotTool } from "./SnapshotTool.tsx";

export function Header() {
  const phase = useStudio((s) => s.phase);
  const appClient = useStudio((s) => s.appClient);

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
        {appClient && (
          <span className="text-text-muted">
            {appClient.name}
            <span className="text-text-subtle"> · {appClient.platform}</span>
          </span>
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
                : "connecting"}
          </span>
        </span>
      </div>
    </header>
  );
}
