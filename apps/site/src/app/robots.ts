import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

/**
 * Nada privado a bloquear (site totalmente estático, sem busca interna nem
 * páginas de ação). Sitemap e host apontam para o host canônico (www).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
