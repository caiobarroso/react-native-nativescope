import { useState } from "react";
import { ArrowUpRight, Check, Copy, Database, HelpCircle, KeyRound } from "lucide-react";
import type { NetworkRequest } from "@rnsi/protocol";
import { useStudio } from "../../lib/store.ts";
import { openInStorage } from "../../lib/studio-client.ts";
import { useStorageAttribution } from "../../lib/use-storage-impact.ts";
import { groupImpact, type StorageImpactItem } from "../../lib/network-storage-link.ts";

const CONFIG_SNIPPET = `// nativescope.config.js
module.exports = {
  modules: {
    storage: true,
  },
};`;

export function StorageImpactPanel({ request }: { request: NetworkRequest }) {
  const attribution = useStorageAttribution();
  const storageActive = useStudio((s) => s.providers.length > 0);
  const items = attribution.items.get(request.id) ?? [];

  return (
    <div className="shrink-0 border-b border-border bg-surface px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5">
        <h3 className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
          Storage impact
        </h3>
        <span title="Storage the app changed right after this response (temporal correlation, not guaranteed causation).">
          <HelpCircle size={11} strokeWidth={1.5} className="text-text-subtle" />
        </span>
      </div>

      {items.length > 0 ? (
        <ImpactChips items={items} />
      ) : storageActive ? (
        <p className="text-[11px] text-text-subtle">No storage changes right after this response.</p>
      ) : (
        <EnableStorageCard />
      )}
    </div>
  );
}

function ImpactChips({ items }: { items: StorageImpactItem[] }) {
  const groups = groupImpact(items);
  return (
    <div className="flex flex-col gap-1.5">
      {groups.map((group) => (
        <div key={`${group.providerId} ${group.instanceId}`} className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
            {group.providerLabel}
          </span>
          {group.items.map((item, index) => (
            <ImpactChip key={`${item.timestamp}-${index}`} item={item} />
          ))}
        </div>
      ))}
    </div>
  );
}

function ImpactChip({ item }: { item: StorageImpactItem }) {
  const label =
    item.target.kind === "key-value"
      ? item.target.key
      : item.target.rowId !== null
        ? `${item.target.table} · row ${item.target.rowId}`
        : item.target.table;
  const Icon = item.target.kind === "database" ? Database : KeyRound;
  return (
    <button
      onClick={() =>
        openInStorage({
          providerId: item.providerId,
          providerLabel: item.providerLabel,
          instanceId: item.instanceId,
          target: item.target,
        })
      }
      title="Open in Storage"
      className="group inline-flex max-w-[240px] items-center gap-1 rounded border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[11px] text-text-muted hover:border-accent hover:text-accent"
    >
      <Icon size={11} strokeWidth={1.5} className="shrink-0" />
      <span className="truncate">{label}</span>
      <ArrowUpRight size={11} strokeWidth={1.5} className="shrink-0 text-text-subtle group-hover:text-accent" />
    </button>
  );
}

function EnableStorageCard() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(CONFIG_SNIPPET);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* silencioso */
    }
  };

  return (
    <div className="rounded-md border border-border bg-surface-raised p-2">
      <p className="text-[11px] text-text-muted">
        See exactly what each request changed in local storage.
        <button onClick={() => setOpen((o) => !o)} className="ml-1 font-medium text-accent hover:underline">
          {open ? "Hide" : "Enable the Storage module"}
        </button>
      </p>
      {open && (
        <div className="mt-2">
          <div className="relative">
            <pre className="overflow-x-auto rounded border border-border bg-surface-sunken p-2 font-mono text-[10px] leading-relaxed text-text-muted">
              {CONFIG_SNIPPET}
            </pre>
            <button
              onClick={copy}
              className="absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded border border-border bg-surface-raised px-1.5 py-0.5 text-[10px] text-text-muted hover:text-text"
            >
              {copied ? <Check size={10} className="text-created" /> : <Copy size={10} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-text-subtle">
            Then reload the app. Or run <span className="font-mono text-text-muted">npx nativescope init</span>.
            The Studio can't enable it remotely — it's set at app boot.
          </p>
        </div>
      )}
    </div>
  );
}
