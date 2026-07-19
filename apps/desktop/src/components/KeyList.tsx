import { Plus, Search } from "lucide-react";
import { useStudio, keysId } from "../lib/store.ts";

const TYPE_LABEL: Record<string, string> = {
  string: "str",
  number: "num",
  boolean: "bool",
  json: "json",
  buffer: "buf",
  null: "null",
};

export function KeyList() {
  const selection = useStudio((s) => s.selection);
  const keys = useStudio((s) =>
    selection ? s.keys[keysId(selection.providerId, selection.instanceId)] : undefined,
  );
  const selectedKey = useStudio((s) => s.selectedKey);
  const selectKey = useStudio((s) => s.selectKey);
  const recentChanges = useStudio((s) => s.recentChanges);
  const creating = useStudio((s) => s.creating);
  const setCreating = useStudio((s) => s.setCreating);
  const keyFilter = useStudio((s) => s.keyFilter);
  const setKeyFilter = useStudio((s) => s.setKeyFilter);

  if (!selection) return null;

  const filtered =
    keyFilter.trim() === ""
      ? keys
      : keys?.filter(
          (e) =>
            e.key.toLowerCase().includes(keyFilter.toLowerCase()) ||
            e.preview.toLowerCase().includes(keyFilter.toLowerCase()),
        );

  return (
    <div className="flex w-72 shrink-0 flex-col border-r border-border">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-2">
        <Search size={13} strokeWidth={1.5} className="shrink-0 text-text-subtle" />
        <input
          type="text"
          value={keyFilter}
          onChange={(e) => setKeyFilter(e.target.value)}
          placeholder="Filtrar chaves e valores"
          className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-text-subtle"
        />
        <button
          onClick={() => setCreating(true)}
          title="Nova chave"
          className={`shrink-0 rounded p-1 ${
            creating
              ? "bg-accent-wash text-accent"
              : "text-text-subtle hover:bg-surface-hover hover:text-text"
          }`}
        >
          <Plus size={14} strokeWidth={1.5} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
      {keys === undefined && (
        <p className="p-4 text-text-subtle">Carregando chaves…</p>
      )}
      {keys?.length === 0 && (
        <p className="p-4 text-text-subtle">Nenhuma chave nesta instância.</p>
      )}
      {keys && keys.length > 0 && filtered?.length === 0 && (
        <p className="p-4 text-text-subtle">Nada bate com "{keyFilter}".</p>
      )}
      {filtered?.map((entry) => {
        const active = entry.key === selectedKey;
        const changeStamp =
          recentChanges[`${keysId(selection.providerId, selection.instanceId)} ${entry.key}`];
        const flash = changeStamp && Date.now() - changeStamp < 950;
        return (
          <button
            key={`${entry.key}-${changeStamp ?? 0}`}
            onClick={() => selectKey(entry.key)}
            className={`flex h-8 shrink-0 items-center gap-2 border-l-2 px-3 text-left ${
              active
                ? "border-accent bg-accent-wash"
                : "border-transparent hover:bg-surface-hover"
            } ${flash ? "rnsi-flash" : ""}`}
          >
            <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
              {entry.key}
            </span>
            <span className="shrink-0 rounded border border-border px-1 py-px text-[10px] text-text-subtle">
              {TYPE_LABEL[entry.valueType] ?? entry.valueType}
            </span>
          </button>
        );
      })}
      </div>
    </div>
  );
}
