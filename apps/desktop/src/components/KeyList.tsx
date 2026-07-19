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

  if (!selection) return null;

  return (
    <div className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-border">
      {keys === undefined && (
        <p className="p-4 text-text-subtle">Carregando chaves…</p>
      )}
      {keys?.length === 0 && (
        <p className="p-4 text-text-subtle">Nenhuma chave nesta instância.</p>
      )}
      {keys?.map((entry) => {
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
  );
}
