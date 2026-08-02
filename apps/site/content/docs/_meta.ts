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
  module: "storage" | "network" | "logs";
  items: { slug: string; title: string }[];
}

export const storageDocsNav: DocGroup[] = [
  {
    module: "storage",
    product: "Storage",
    title: "Getting started",
    items: [
      { slug: "storage/introduction", title: "Introduction" },
      { slug: "storage/quickstart", title: "Quickstart" },
      { slug: "storage/devices", title: "Devices & connection" },
      { slug: "storage/storage-providers", title: "Storage providers" },
    ],
  },
  {
    module: "storage",
    product: "Storage",
    title: "Guides",
    items: [
      { slug: "storage/configuration", title: "Configuration" },
      { slug: "storage/react-query", title: "React Query bridge" },
      { slug: "storage/large-datasets", title: "Large datasets" },
      { slug: "storage/adding-a-provider", title: "Adding a database provider" },
    ],
  },
  {
    module: "storage",
    product: "Storage",
    title: "Reference",
    items: [
      { slug: "storage/cli", title: "CLI" },
      { slug: "storage/api", title: "App API" },
      { slug: "storage/privacy", title: "Privacy & security" },
    ],
  },
];

export const networkDocsNav: DocGroup[] = [
  {
    module: "network",
    product: "Network",
    title: "Getting started",
    items: [
      { slug: "network/introduction", title: "Introduction" },
      { slug: "network/quickstart", title: "Quickstart" },
    ],
  },
  {
    module: "network",
    product: "Network",
    title: "Inspect",
    items: [
      { slug: "network/requests", title: "Inspecting requests" },
      { slug: "network/graphql", title: "GraphQL" },
      { slug: "network/insights", title: "Network Insights" },
    ],
  },
  {
    module: "network",
    product: "Network",
    title: "Workflows",
    items: [
      {
        slug: "network/capture-controls",
        title: "Capture controls & sounds",
      },
      { slug: "network/replay", title: "Replay & compare" },
      { slug: "network/storage-impact", title: "Storage impact" },
    ],
  },
  {
    module: "network",
    product: "Network",
    title: "Reference",
    items: [
      { slug: "network/configuration", title: "Configuration" },
      { slug: "network/safety", title: "Safety & limits" },
    ],
  },
];

export const logsDocsNav: DocGroup[] = [
  {
    module: "logs",
    product: "Logs",
    title: "Getting started",
    items: [
      { slug: "logs/introduction", title: "Introduction" },
      { slug: "logs/quickstart", title: "Quickstart" },
    ],
  },
  {
    module: "logs",
    product: "Logs",
    title: "Inspect",
    items: [
      { slug: "logs/reading-logs", title: "Reading logs" },
      { slug: "logs/structured-data", title: "Structured data" },
      { slug: "logs/namespaces", title: "Namespaces & levels" },
    ],
  },
  {
    module: "logs",
    product: "Logs",
    title: "Workflows",
    items: [
      { slug: "logs/mark", title: "Mark a moment" },
      { slug: "logs/timeline", title: "Timeline" },
    ],
  },
  {
    module: "logs",
    product: "Logs",
    title: "Reference",
    items: [
      { slug: "logs/configuration", title: "Configuration" },
      { slug: "logs/safety", title: "Safety & limits" },
    ],
  },
];

export const docsNav: DocGroup[] = [...storageDocsNav, ...networkDocsNav, ...logsDocsNav];

/** Ordem linear achatada — alimenta os links de anterior/próximo. */
export const docsOrder: string[] = docsNav.flatMap((group) => group.items.map((item) => item.slug));
