import type { MDXComponents } from "mdx/types";
import Link from "next/link";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Callout } from "@/components/ui/Callout";
import { Snippet } from "@/components/ui/Snippet";
import { InstallCommand } from "@/components/ui/InstallCommand";

/**
 * O MAPA DE COMPONENTES DO MDX — este é o principal ponto de estilo das docs.
 *
 * Estilizar a prosa das docs é estilizar ESTE arquivo. O conteúdo em
 * content/docs/*.mdx não deve ganhar classe nenhuma; toda decisão visual de
 * h2, p, table, blockquote etc. mora aqui.
 *
 * `Callout` e `Snippet` são usados diretamente dentro do MDX.
 */
export function useMDXComponents(components: MDXComponents = {}): MDXComponents {
  return {
    h1: (props) => <h1 {...props} />,
    h2: (props) => <h2 {...props} />,
    h3: (props) => <h3 {...props} />,
    p: (props) => <p {...props} />,
    ul: (props) => <ul {...props} />,
    ol: (props) => <ol {...props} />,
    li: (props) => <li {...props} />,
    blockquote: (props) => <blockquote {...props} />,
    hr: (props) => <hr {...props} />,
    table: (props) => (
      // Tabela larga não pode empurrar a página. O scroll é dela.
      <div data-doc-table-scroll style={{ overflowX: "auto" }}>
        <table {...props} />
      </div>
    ),
    th: (props) => <th {...props} />,
    td: (props) => <td {...props} />,

    a: ({ href = "", ...props }) => {
      const external = href.startsWith("http");
      if (external) {
        return <a href={href} target="_blank" rel="noreferrer noopener" {...props} />;
      }
      return <Link href={href} {...props} />;
    },

    // Código inline. Blocos cercados chegam como <pre><code>.
    code: (props) => <code {...props} />,
    pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,

    Callout,
    Snippet,
    InstallCommand,

    ...components,
  };
}
