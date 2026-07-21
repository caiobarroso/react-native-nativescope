/**
 * Aviso dentro das docs. Usado direto no MDX:
 *
 *   <Callout kind="warning">Buffers ainda não são graváveis.</Callout>
 *
 * Os três tipos existem porque mapeiam nos tokens semânticos que o Studio já
 * usa: `note` é neutro, `warning` usa o acento, `danger` usa --deleted.
 */
export type CalloutKind = "note" | "warning" | "danger";

export function Callout({
  kind = "note",
  children,
}: {
  kind?: CalloutKind;
  children: React.ReactNode;
}) {
  return (
    <aside data-callout={kind} role={kind === "note" ? undefined : "note"}>
      {children}
    </aside>
  );
}
