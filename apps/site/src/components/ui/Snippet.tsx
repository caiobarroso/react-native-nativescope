import { snippet, languageOf } from "@/lib/snippets";
import { CodeBlock } from "./CodeBlock";

/**
 * Bloco de código lido de um arquivo REAL do monorepo, em build time.
 *
 *   <Snippet file="apps/cli/app/index.d.ts" symbol="NativeScopeChange" />
 *
 * Se o símbolo sumir ou for renomeado, o build quebra — que é exatamente o
 * ponto. Docs que mentem são piores que docs que faltam.
 */
export function Snippet({
  file,
  symbol,
  region,
}: {
  file: string;
  symbol?: string;
  region?: string;
}) {
  const code = snippet(file, { ...(symbol ? { symbol } : {}), ...(region ? { region } : {}) });

  return (
    <div data-snippet>
      <CodeBlock>
        <code className={`language-${languageOf(file)}`}>{code}</code>
      </CodeBlock>
      <p data-snippet-source>
        From <code>{file}</code>
      </p>
    </div>
  );
}
