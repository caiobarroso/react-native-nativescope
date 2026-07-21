/**
 * NAVEGAÇÃO DAS DOCS — CONGELADO.
 *
 * Ordem e agrupamento da sidebar. O `slug` casa com o nome do arquivo .mdx
 * em content/docs/. A implementação de design estiliza a sidebar, mas não
 * reordena nem renomeia — isso é decisão de produto.
 *
 * O primeiro slug do primeiro grupo é o destino de /docs.
 */

export interface DocGroup {
  title: string;
  product?: string;
  items: { slug: string; title: string }[];
}

export const docsNav: DocGroup[] = [
  {
    product: "Storage Engine",
    title: "Getting started",
    items: [
      { slug: "introduction", title: "Introduction" },
      { slug: "quickstart", title: "Quickstart" },
      { slug: "devices", title: "Devices & connection" },
      { slug: "storage-providers", title: "Storage providers" },
    ],
  },
  {
    product: "Storage Engine",
    title: "Guides",
    items: [
      { slug: "configuration", title: "Configuration" },
      { slug: "react-query", title: "React Query bridge" },
      { slug: "large-datasets", title: "Large datasets" },
    ],
  },
  {
    product: "Storage Engine",
    title: "Reference",
    items: [
      { slug: "cli", title: "CLI" },
      { slug: "api", title: "App API" },
      { slug: "privacy", title: "Privacy & security" },
    ],
  },
];

/** Ordem linear achatada — alimenta os links de anterior/próximo. */
export const docsOrder: string[] = docsNav.flatMap((group) =>
  group.items.map((item) => item.slug),
);
