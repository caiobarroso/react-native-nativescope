import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight, Check, CircleHelp, Copy } from "lucide-react";

const CONFIG_SNIPPET = `import { defineNativeScopeConfig } from "react-native-nativescope/app"

export default defineNativeScopeConfig({
  modules: {
    storage: {
      reactQuery: true,
    },
  },
})`;

export function StorageRealtimeStatus({ enabled }: { enabled: boolean | null }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  async function copyConfig() {
    await navigator.clipboard.writeText(CONFIG_SNIPPET);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  const active = enabled === true;
  const unknown = enabled === null;

  return (
    <div
      ref={rootRef}
      className="relative flex h-7 items-center rounded-md border border-border bg-surface-raised"
    >
      <span className="flex items-center gap-1.5 px-2 text-[11px] text-text-muted">
        <ArrowLeftRight
          size={13}
          strokeWidth={1.5}
          className={active ? "text-created" : unknown ? "text-text-subtle" : "text-updated"}
        />
        {active ? "App refresh on" : unknown ? "App refresh unknown" : "App refresh off"}
      </span>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex h-full w-7 items-center justify-center border-l border-border text-text-subtle hover:bg-surface-hover hover:text-text"
        aria-label="Explain app refresh status"
        aria-expanded={open}
      >
        <CircleHelp size={13} strokeWidth={1.5} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-1.5 w-[360px] rounded-md border border-border bg-surface-raised p-3 shadow-xl">
          <div className="flex items-start gap-2.5">
            <ArrowLeftRight
              size={15}
              strokeWidth={1.5}
              className={`mt-0.5 shrink-0 ${active ? "text-created" : "text-updated"}`}
            />
            <div>
              <h3 className="text-[12px] font-semibold text-text">
                {active
                  ? "Your app screen updates automatically"
                  : "Storage updates, but your screen may not"}
              </h3>
              <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
                {active
                  ? "Changes made in NativeScope automatically refresh screens powered by React Query."
                  : "NativeScope can change the stored value, but a React Query screen may only refresh after you leave and return."}
              </p>
            </div>
          </div>

          {!active && (
            <div className="mt-3 border-t border-border pt-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-medium text-text">Turn on automatic app refresh</p>
                  <p className="text-[10px] text-text-subtle">Add this to nativescope.config.ts</p>
                </div>
                <button
                  type="button"
                  onClick={() => void copyConfig()}
                  className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-[10px] text-text-muted hover:bg-surface-hover hover:text-text"
                >
                  {copied ? (
                    <Check size={12} strokeWidth={1.5} />
                  ) : (
                    <Copy size={12} strokeWidth={1.5} />
                  )}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <pre className="overflow-x-auto rounded-md border border-border bg-surface-sunken p-2.5 font-mono text-[10px] leading-relaxed text-text-muted">
                {CONFIG_SNIPPET}
              </pre>
              <p className="mt-2 text-[10px] leading-relaxed text-text-subtle">
                Not using React Query? You can ignore this setup. Your storage connection still
                works normally.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
