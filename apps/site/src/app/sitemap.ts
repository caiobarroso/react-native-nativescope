import type { MetadataRoute } from "next";
import { docsOrder } from "@content/docs/_meta";

const marketingRoutes = [
  "",
  "/our-goal",
  "/compare/rozenite",
  "/journal",
  "/journal/a-window-not-a-copy",
  "/journal/zero-config",
] as const;

const docsRoutes = ["/docs", ...docsOrder.map((slug) => `/docs/${slug}`)] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [...marketingRoutes, ...docsRoutes].map((route) => ({
    url: `https://nativescope.dev${route}`,
    lastModified: now,
    changeFrequency: route.startsWith("/docs") ? "weekly" : "monthly",
    priority: route === "" ? 1 : route.startsWith("/docs") ? 0.8 : 0.7,
  }));
}
