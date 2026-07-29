import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { MDXRemote } from "next-mdx-remote/rsc";
import { getAllSlugs, getDoc, getFirstSlug, getNeighbours } from "@/lib/content";
import { useMDXComponents as getMDXComponents } from "@/mdx-components";
import { OnThisPage } from "@/components/site/OnThisPage";
import { JsonLd } from "@/components/seo/JsonLd";
import { pageMetadata, breadcrumbSchema } from "@/lib/seo";
import rehypePrettyCode from "rehype-pretty-code";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";

interface PageProps {
  params: Promise<{ slug?: string[] }>;
}

/** /docs cai na primeira página; as demais vêm de _meta.ts. */
export function generateStaticParams() {
  return [{ slug: [] }, ...getAllSlugs().map((slug) => ({ slug: slug.split("/") }))];
}

function resolveSlug(segments: string[] | undefined): string {
  return segments?.join("/") || getFirstSlug();
}

function slugifyHeading(value: string) {
  return value
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function extractHeadings(source: string) {
  return Array.from(source.matchAll(/^##\s+(.+)$/gm), (match) => ({
    title: match[1].replace(/[`*_]/g, ""),
    id: slugifyHeading(match[1]),
  }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const segments = (await params).slug;
  const slug = resolveSlug(segments);
  const doc = getDoc(slug);
  if (!doc) return {};
  // `/docs` renderiza a introdução — canonicaliza para a URL com slug para não
  // competir como conteúdo duplicado de `/docs/storage/introduction`.
  const path = `/docs/${slug}`;
  return pageMetadata({
    title: doc.frontmatter.title,
    description: doc.frontmatter.description,
    path,
  });
}

export default async function DocPage({ params }: PageProps) {
  const doc = getDoc(resolveSlug((await params).slug));
  if (!doc) notFound();

  const { previous, next } = getNeighbours(doc.slug);
  const headings = extractHeadings(doc.body);
  const moduleName = doc.slug.startsWith("network/") ? "Network" : "Storage";

  return (
    <div data-doc-page>
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "Docs", path: "/docs" },
          { name: doc.frontmatter.title, path: `/docs/${doc.slug}` },
        ])}
      />
      <div data-doc-main>
        <header data-doc-header>
          <p data-doc-product>NativeScope / {moduleName}</p>
          <h1>{doc.frontmatter.title}</h1>
          <p data-doc-description>{doc.frontmatter.description}</p>
        </header>

        <div data-doc-mobile-toc>
          <details>
            <summary>On this page</summary>
            <OnThisPage headings={headings} />
          </details>
        </div>

        <div data-doc-body>
          <MDXRemote
            source={doc.body}
            components={getMDXComponents()}
            options={{
              mdxOptions: {
                remarkPlugins: [remarkGfm],
                rehypePlugins: [
                  rehypeSlug,
                  [
                    rehypePrettyCode,
                    {
                      theme: { light: "github-light", dark: "github-dark" },
                      keepBackground: false,
                    },
                  ],
                ],
              },
            }}
          />
        </div>

        <nav data-doc-pagination aria-label="Docs pages">
          {previous ? (
            <Link href={`/docs/${previous.slug}`} rel="prev">
              <span>Previous</span>
              <span>{previous.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link href={`/docs/${next.slug}`} rel="next">
              <span>Next</span>
              <span>{next.title}</span>
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </div>

      <OnThisPage headings={headings} />
    </div>
  );
}
