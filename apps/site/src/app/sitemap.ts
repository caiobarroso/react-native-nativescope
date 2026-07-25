import type { MetadataRoute } from "next";
import { docsOrder } from "@content/docs/_meta";
import { absoluteUrl } from "@/lib/seo";

/**
 * Só URLs canônicas e indexáveis, no host canônico (www) — as mesmas que
 * cada página declara em `alternates.canonical`. Sem redirects na lista.
 *
 * `/docs` é omitido de propósito: ele renderiza o mesmo conteúdo de
 * `/docs/introduction` e canonicaliza para lá, então só a URL com slug entra.
 */
const marketingRoutes = [
  "/",
  "/our-goal",
  "/compare/rozenite",
  "/journal",
  "/journal/a-window-not-a-copy",
  "/journal/zero-config",
] as const;

const docsRoutes = docsOrder.map((slug) => `/docs/${slug}`);

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [...marketingRoutes, ...docsRoutes].map((route) => ({
    url: absoluteUrl(route),
    lastModified: now,
    changeFrequency: route.startsWith("/docs") ? "weekly" : "monthly",
    priority: route === "/" ? 1 : route.startsWith("/docs") ? 0.8 : 0.7,
  }));
}
