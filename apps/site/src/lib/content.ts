/**
 * CARREGAMENTO DE CONTEÚDO — CONGELADO.
 *
 * Lê os .mdx de content/docs/ e cruza com a ordem declarada em _meta.ts.
 * A implementação de design consome estas funções; não as reescreve.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { docsNav, docsOrder, type DocGroup } from "@content/docs/_meta";

const DOCS_DIR = join(process.cwd(), "content", "docs");

export interface DocFrontmatter {
  title: string;
  description: string;
}

export interface Doc {
  slug: string;
  frontmatter: DocFrontmatter;
  body: string;
}

export interface DocNeighbours {
  previous: { slug: string; title: string } | null;
  next: { slug: string; title: string } | null;
}

export function getNav(): DocGroup[] {
  return docsNav;
}

/** Todos os slugs, na ordem da sidebar. Alimenta o generateStaticParams. */
export function getAllSlugs(): string[] {
  return docsOrder;
}

/** O destino de /docs — o primeiro item do primeiro grupo. */
export function getFirstSlug(): string {
  const first = docsOrder[0];
  if (!first) throw new Error("content: _meta.ts não declara nenhuma página");
  return first;
}

export function getDoc(slug: string): Doc | null {
  const path = join(DOCS_DIR, `${slug}.mdx`);
  if (!existsSync(path)) return null;

  const parsed = matter(readFileSync(path, "utf8"));
  const data = parsed.data as Partial<DocFrontmatter>;

  if (!data.title || !data.description) {
    throw new Error(`content: ${slug}.mdx precisa de title e description no frontmatter`);
  }

  return {
    slug,
    frontmatter: { title: data.title, description: data.description },
    body: parsed.content,
  };
}

function titleOf(slug: string): string {
  for (const group of docsNav) {
    const found = group.items.find((item) => item.slug === slug);
    if (found) return found.title;
  }
  return slug;
}

export function getNeighbours(slug: string): DocNeighbours {
  const index = docsOrder.indexOf(slug);
  if (index === -1) return { previous: null, next: null };

  const previousSlug = index > 0 ? docsOrder[index - 1] : undefined;
  const nextSlug = index < docsOrder.length - 1 ? docsOrder[index + 1] : undefined;

  return {
    previous: previousSlug ? { slug: previousSlug, title: titleOf(previousSlug) } : null,
    next: nextSlug ? { slug: nextSlug, title: titleOf(nextSlug) } : null,
  };
}

/**
 * Falha o build se _meta.ts declarar uma página que não existe como arquivo.
 * Sem isso, um slug errado vira um 404 silencioso em produção.
 */
export function assertContentIntegrity(): void {
  const missing = docsOrder.filter((slug) => !existsSync(join(DOCS_DIR, `${slug}.mdx`)));
  if (missing.length > 0) {
    throw new Error(
      `content: _meta.ts referencia páginas inexistentes: ${missing.join(", ")}`,
    );
  }
}
