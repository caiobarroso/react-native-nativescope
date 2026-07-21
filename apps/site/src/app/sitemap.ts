import type { MetadataRoute } from "next";

const routes = [
  "",
  "/our-goal",
  "/compare/rozenite",
  "/journal",
  "/journal/a-window-not-a-copy",
  "/journal/zero-config",
  "/docs",
  "/docs/quickstart",
  "/docs/configuration",
  "/docs/storage-providers",
  "/docs/react-query",
  "/docs/large-datasets",
  "/docs/api",
  "/docs/cli",
  "/docs/privacy",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((route) => ({
    url: `https://nativescope.dev${route}`,
    changeFrequency: route.startsWith("/docs") ? "weekly" : "monthly",
    priority: route === "" ? 1 : route.startsWith("/docs") ? 0.8 : 0.7,
  }));
}
