import { useStudio } from "../lib/store.ts";

export function Header() {
  const phase = useStudio((s) => s.phase);
  const appClient = useStudio((s) => s.appClient);

  return (
    <header className="flex h-11 items-center gap-3 border-b border-border bg-surface px-4">
      <span className="text-[13px] font-semibold tracking-tight">
        Storage Inspector
      </span>

      <div className="ml-auto flex items-center gap-3">
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
              ? "conectado"
              : phase === "waiting-app"
                ? "aguardando o app"
                : "conectando"}
          </span>
        </span>
      </div>
    </header>
  );
}
