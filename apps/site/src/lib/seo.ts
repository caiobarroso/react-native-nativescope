/**
 * FONTE ÚNICA DE SEO.
 *
 * Um host só, um construtor de metadata por página e os geradores de JSON-LD.
 * Regra de ouro: canonical, openGraph.url e sitemap sempre concordam com o
 * host canônico real (apex → 308 → www na Vercel), então tudo aponta para www.
 *
 * `metadataBase` no layout resolve os caminhos relativos daqui para URLs
 * absolutas em www.
 */

import type { Metadata } from "next";

/** Host canônico. O apex nativescope.dev faz 308 para cá (Vercel). */
export const SITE_URL = "https://www.nativescope.dev";
export const SITE_NAME = "NativeScope";

export const AUTHOR = {
  name: "Caio Barroso",
  url: "https://github.com/caiobarroso",
  sameAs: ["https://github.com/caiobarroso", "https://x.com/_caiobarroso"],
} as const;

export const SOCIAL = {
  repo: "https://github.com/caiobarroso/react-native-nativescope",
  githubProfile: "https://github.com/caiobarroso",
  x: "https://x.com/_caiobarroso",
} as const;

const DEFAULT_OG_IMAGE = {
  // Gerada por código em src/app/og/route.tsx (next/og) — plataforma inteira
  // (Storage + Network). Trocar a copy é editar aquele arquivo.
  url: "/og",
  width: 1200,
  height: 630,
  alt: "NativeScope local React Native debugging Studio",
} as const;

/**
 * Caminho relativo → URL absoluta no host canônico.
 *
 * Remove a barra final para que o sitemap e os breadcrumbs batam exatamente
 * com o canonical que o Next emite (o Next resolve `canonical: "/"` como a
 * origem sem barra final).
 */
export function absoluteUrl(path = "/"): string {
  return new URL(path, SITE_URL).toString().replace(/\/$/, "");
}

interface PageSeoInput {
  /** Vira o <title> (o layout aplica o template "%s · NativeScope" em rotas filhas). */
  title: string;
  description: string;
  /** Caminho canônico desta página, ex.: "/journal/zero-config". */
  path: string;
  type?: "website" | "article";
  /** Título/descrição só para os cards sociais, quando diferem do <title>. */
  ogTitle?: string;
  ogDescription?: string;
  publishedTime?: string;
  modifiedTime?: string;
}

/**
 * Metadata completa e autorreferente por página.
 *
 * Importante: no Next, definir `openGraph`/`twitter` numa página SUBSTITUI o
 * bloco do layout inteiro (não é merge profundo). Por isso este helper sempre
 * emite o bloco completo — incluindo a imagem — para nenhuma página herdar o
 * card do layout por engano.
 */
export function pageMetadata({
  title,
  description,
  path,
  type = "website",
  ogTitle,
  ogDescription,
  publishedTime,
  modifiedTime,
}: PageSeoInput): Metadata {
  const socialTitle = ogTitle ?? title;
  const socialDescription = ogDescription ?? description;

  const openGraph = {
    type,
    siteName: SITE_NAME,
    locale: "en_US",
    url: path,
    title: socialTitle,
    description: socialDescription,
    images: [DEFAULT_OG_IMAGE],
    ...(type === "article" ? { publishedTime, modifiedTime, authors: [AUTHOR.name] } : {}),
  } satisfies Record<string, unknown>;

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: openGraph as Metadata["openGraph"],
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description: socialDescription,
      images: [DEFAULT_OG_IMAGE.url],
    },
  };
}

/* ------------------------------------------------------------------ *
 * JSON-LD (schema.org)
 * ------------------------------------------------------------------ */

const ORG_ID = `${SITE_URL}/#organization`;
const WEBSITE_ID = `${SITE_URL}/#website`;

/** Entidade da organização — referenciada por @id em todo o resto. */
export function organizationSchema() {
  return {
    "@type": "Organization",
    "@id": ORG_ID,
    name: SITE_NAME,
    url: SITE_URL,
    logo: {
      "@type": "ImageObject",
      url: absoluteUrl("/brand/nativescope-logo.png"),
    },
    sameAs: [SOCIAL.githubProfile, SOCIAL.repo, SOCIAL.x],
  };
}

export function websiteSchema() {
  return {
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: SITE_NAME,
    url: SITE_URL,
    inLanguage: "en",
    publisher: { "@id": ORG_ID },
  };
}

/** Grafo sitewide, injetado uma vez no layout. */
export function siteGraphSchema() {
  return {
    "@context": "https://schema.org",
    "@graph": [organizationSchema(), websiteSchema()],
  };
}

/** A NativeScope como aplicativo de desenvolvedor (home). Sem rating fake. */
export function softwareApplicationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    applicationCategory: "DeveloperApplication",
    applicationSubCategory: "React Native debugging and developer tools",
    operatingSystem: "macOS, Windows, Linux",
    description:
      "A plug-and-play, fully local debugging environment for React Native. Inspect storage, capture HTTP and GraphQL traffic, read JavaScript logs and keep debugging context in one Studio with Timeline.",
    url: SITE_URL,
    downloadUrl: SOCIAL.repo,
    softwareVersion: "1.0.0",
    author: { "@type": "Person", name: AUTHOR.name, url: AUTHOR.url },
    publisher: { "@id": ORG_ID },
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    isAccessibleForFree: true,
  };
}

/** FAQPage a partir dos itens realmente renderizados na home. */
export function faqPageSchema(items: { question: string; answer: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

export function breadcrumbSchema(crumbs: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  };
}

/** Nota de engenharia / doc técnica. Datas reais, nunca inventadas. */
export function techArticleSchema({
  title,
  description,
  path,
  published,
  modified,
}: {
  title: string;
  description: string;
  path: string;
  published: string;
  modified?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: title,
    description,
    url: absoluteUrl(path),
    mainEntityOfPage: absoluteUrl(path),
    image: absoluteUrl("/og"),
    datePublished: published,
    dateModified: modified ?? published,
    inLanguage: "en",
    author: {
      "@type": "Person",
      name: AUTHOR.name,
      url: AUTHOR.url,
      sameAs: AUTHOR.sameAs,
    },
    publisher: { "@id": ORG_ID },
  };
}
