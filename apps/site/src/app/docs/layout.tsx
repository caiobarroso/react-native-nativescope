import { getNav, assertContentIntegrity } from "@/lib/content";
import { DocsSidebar } from "@/components/site/DocsSidebar";

/**
 * Casca das docs: sidebar + área de conteúdo.
 *
 * A checagem de integridade roda no build. Um slug declarado em _meta.ts sem
 * arquivo correspondente quebra o build em vez de virar 404 em produção.
 */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  assertContentIntegrity();

  return (
    <div data-docs-shell>
      <DocsSidebar groups={getNav()} />
      <article data-docs-content>{children}</article>
    </div>
  );
}
