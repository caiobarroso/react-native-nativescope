import { Database, KeyRound, Moon, Sun, SunMoon } from "lucide-react";
import { useStudio } from "../lib/store.ts";
import { useTheme } from "../lib/theme.ts";
import { loadKeys, loadTables } from "../lib/studio-client.ts";

export function Sidebar() {
  const providers = useStudio((s) => s.providers);
  const selection = useStudio((s) => s.selection);
  const select = useStudio((s) => s.select);
  const { mode, cycle } = useTheme();

  const ThemeIcon = mode === "light" ? Sun : mode === "dark" ? Moon : SunMoon;

  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-surface-sunken">
      <nav className="flex-1 overflow-y-auto p-2">
        {providers.length === 0 && (
          <p className="px-2 py-3 text-text-subtle">Nenhum storage ainda.</p>
        )}
        {providers.map((provider) => (
          <div key={provider.providerId} className="mb-1">
            <div className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              {provider.capabilities.includes("database.query") ? (
                <Database size={13} strokeWidth={1.5} />
              ) : (
                <KeyRound size={13} strokeWidth={1.5} />
              )}
              {provider.label}
            </div>
            {provider.instances.map((instance) => {
              const active =
                selection?.providerId === provider.providerId &&
                selection?.instanceId === instance.instanceId;
              return (
                <button
                  key={instance.instanceId}
                  onClick={() => {
                    select({
                      providerId: provider.providerId,
                      instanceId: instance.instanceId,
                    });
                    if (provider.capabilities.includes("database.query")) {
                      void loadTables(provider.providerId, instance.instanceId);
                    } else {
                      void loadKeys(provider.providerId, instance.instanceId);
                    }
                  }}
                  className={`block w-full rounded-md px-2 py-1.5 pl-7 text-left font-mono text-[12px] ${
                    active
                      ? "bg-accent-wash text-accent"
                      : "text-text-muted hover:bg-surface-hover hover:text-text"
                  }`}
                >
                  {instance.label}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <footer className="border-t border-border p-2">
        <button
          onClick={cycle}
          title={`Tema: ${mode === "system" ? "sistema" : mode === "light" ? "claro" : "escuro"}`}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-text-muted hover:bg-surface-hover hover:text-text"
        >
          <ThemeIcon size={14} strokeWidth={1.5} />
          {mode === "system" ? "Sistema" : mode === "light" ? "Claro" : "Escuro"}
        </button>
      </footer>
    </aside>
  );
}
