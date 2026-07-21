import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export function ArticleShell({
  eyebrow,
  title,
  description,
  readTime,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  readTime: string;
  children: React.ReactNode;
}) {
  return (
    <article data-engineering-article>
      <Link href="/journal" data-article-back><ArrowLeft size={15} aria-hidden /> Journal</Link>
      <header data-article-lead>
        <p>{eyebrow}</p>
        <h1>{title}</h1>
        <span>{description}</span>
        <small>{readTime} · NativeScope engineering</small>
      </header>
      <div data-article-body>{children}</div>
    </article>
  );
}
