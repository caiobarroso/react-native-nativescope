import {
  ChevronDown,
  ChevronRight,
  Database,
  Globe,
  KeyRound,
  Mail,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  SunMoon,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useStudio } from "../lib/store.ts";
import { useNetwork } from "../lib/network-store.ts";
import { useLayout } from "../lib/layout.ts";
import { useTheme } from "../lib/theme.ts";
import { loadKeys, loadTables } from "../lib/studio-client.ts";
import { ResizeHandle } from "./ResizeHandle.tsx";

const FEEDBACK_URL =
  "mailto:caiobarroso511@yahoo.com.br?subject=NativeScope%20feedback&body=Hi%20Caio%2C%0A%0AI%27d%20like%20to%20share%20a%20suggestion%20or%20report%20a%20bug%3A%0A%0A";

function ModuleSection({
  label,
  icon: Icon,
  active,
  onActivate,
  children,
}: {
  label: string;
  icon: LucideIcon;
  active: boolean;
  onActivate: () => void;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);

  function handleModuleClick(): void {
    if (!active) {
      onActivate();
      setExpanded(true);
      return;
    }
    setExpanded((current) => !current);
  }

  return (
    <section className="mt-1.5" aria-label={`${label} module`}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-current={active ? "page" : undefined}
        onClick={handleModuleClick}
        className={`group flex h-9 w-full items-center gap-2 rounded-md border px-2 text-left text-[12px] font-semibold transition-colors ${
          active
            ? "border-border bg-surface-raised text-text"
            : "border-transparent bg-transparent text-text-muted hover:border-border hover:bg-surface-hover hover:text-text"
        }`}
      >
        {expanded ? (
          <ChevronDown size={13} strokeWidth={1.5} className="shrink-0 text-text-subtle" />
        ) : (
          <ChevronRight size={13} strokeWidth={1.5} className="shrink-0 text-text-subtle" />
        )}
        <Icon
          size={14}
          strokeWidth={1.5}
          className={`shrink-0 transition-colors ${
            active ? "text-accent" : "text-text-subtle group-hover:text-accent"
          }`}
        />
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
      {expanded && (
        <div className="ml-[15px] mt-1 border-l border-border pl-3">
          {children}
        </div>
      )}
    </section>
  );
}

export function Sidebar() {
  const providers = useStudio((s) => s.providers);
  const arrivedLate = useStudio((s) => s.arrivedLate);
  const selection = useStudio((s) => s.selection);
  const select = useStudio((s) => s.select);
  const activeModule = useStudio((s) => s.activeModule);
  const setActiveModule = useStudio((s) => s.setActiveModule);
  const requestCount = useNetwork((s) => s.requests.length);
  const size = useLayout((s) => s.panels.sidebar.size);
  const collapsed = useLayout((s) => s.panels.sidebar.collapsed);
  const toggleCollapsed = useLayout((s) => s.toggleCollapsed);
  const { mode, cycle } = useTheme();
  const ThemeIcon = mode === "light" ? Sun : mode === "dark" ? Moon : SunMoon;

  if (collapsed) {
    return (
      <div className="flex w-9 shrink-0 flex-col items-center border-r border-border bg-surface-sunken py-2">
        <button
          onClick={() => toggleCollapsed("sidebar")}
          title="Expand storage list"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-subtle hover:bg-surface-hover hover:text-text"
        >
          <PanelLeftOpen size={16} strokeWidth={1.5} />
        </button>
      </div>
    );
  }

  return (
    <aside
      style={{ width: size }}
      className="relative flex shrink-0 flex-col border-r border-border bg-surface-sunken"
    >
      <nav className="flex-1 overflow-y-auto p-2" aria-label="Modules">
        <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
          Modules
        </p>
        <ModuleSection
          label="Storage"
          icon={KeyRound}
          active={activeModule === "storage"}
          onActivate={() => setActiveModule("storage")}
        >
          {providers.length === 0 && (
            <p className="px-2 py-3 text-[12px] text-text-subtle">No storage detected yet.</p>
          )}
          {providers.map((provider) => (
            <div key={provider.providerId} className="relative mb-1 before:absolute before:-left-3 before:top-[16px] before:h-px before:w-3 before:bg-border">
              <div
                className={`flex h-8 items-center gap-2 rounded px-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted ${
                  arrivedLate.includes(provider.providerId) ? "rnsi-flash" : ""
                }`}
              >
                {provider.capabilities.includes("database.query") ? (
                  <Database size={13} strokeWidth={1.5} />
                ) : (
                  <KeyRound size={13} strokeWidth={1.5} />
                )}
                {provider.label}
              </div>
              {provider.instances.map((instance) => {
                const active =
                  activeModule === "storage" &&
                  selection?.providerId === provider.providerId &&
                  selection?.instanceId === instance.instanceId;
                return (
                  <button
                    key={instance.instanceId}
                    onClick={() => {
                      setActiveModule("storage");
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
                    className={`block w-full rounded-md py-1.5 pl-8 pr-2 text-left font-mono text-[12px] transition-colors ${
                      active
                        ? "bg-accent-wash font-medium text-accent"
                        : "text-text-muted hover:bg-surface-hover hover:text-text"
                    }`}
                  >
                    {instance.label}
                  </button>
                );
              })}
            </div>
          ))}
        </ModuleSection>

        <ModuleSection
          label="Network"
          icon={Globe}
          active={activeModule === "network"}
          onActivate={() => setActiveModule("network")}
        >
          <button
            onClick={() => setActiveModule("network")}
            className={`flex w-full items-center gap-2 rounded-md py-1.5 pl-5 pr-2 text-left font-mono text-[12px] transition-colors ${
              activeModule === "network"
                ? "bg-accent-wash font-medium text-accent"
                : "text-text-muted hover:bg-surface-hover hover:text-text"
            }`}
          >
            <span className="min-w-0 flex-1">Requests</span>
            {requestCount > 0 && (
              <span className="shrink-0 rounded bg-surface-sunken px-1.5 py-0.5 text-[10px] tabular-nums text-text-subtle">
                {requestCount > 999 ? "999+" : requestCount}
              </span>
            )}
          </button>
        </ModuleSection>
      </nav>

      <footer className="border-t border-border p-2">
        <div className="flex items-center gap-1">
          <a
            href={FEEDBACK_URL}
            className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-[12px] text-text-muted hover:bg-surface-hover hover:text-text"
          >
            <Mail size={14} strokeWidth={1.5} />
            Send feedback
          </a>
        </div>
        <div className="mt-1 flex items-center gap-1">
          <button
            onClick={cycle}
            title={`Theme: ${mode}`}
            aria-label={`Change theme. Current theme: ${mode}`}
            className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-[12px] text-text-muted hover:bg-surface-hover hover:text-text"
          >
            <ThemeIcon size={14} strokeWidth={1.5} />
            <span className="min-w-0 flex-1">Theme</span>
            <span className="capitalize text-text-subtle">{mode}</span>
          </button>
          <button
            onClick={() => toggleCollapsed("sidebar")}
            title="Collapse panel"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-subtle hover:bg-surface-hover hover:text-text"
          >
            <PanelLeftClose size={15} strokeWidth={1.5} />
          </button>
        </div>
      </footer>
      <ResizeHandle panelId="sidebar" edge="right" />
    </aside>
  );
}
