import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

const articles = [
  {
    href: "/journal/a-window-not-a-copy",
    label: "Performance",
    title: "A window, not a copy",
    description: "How NativeScope reads gigabytes without freezing the app or the dashboard.",
    meta: "12 min read",
  },
  {
    href: "/journal/zero-config",
    label: "Architecture",
    title: "Plug-and-play, by construction",
    description: "The resolver, transparent shims and release guard behind the one-command setup.",
    meta: "8 min read",
  },
];

/**
 * `teaser` (home): cabeçalho + link "All notes" para /journal.
 * `index` (/journal): só a grade. Na página de índice o próprio page-lead já é
 * o cabeçalho — repetir o kicker/heading e apontar "All notes" para a própria
 * página seria redundante.
 */
export function Journal({ variant = "teaser" }: { variant?: "teaser" | "index" }) {
  const isIndex = variant === "index";

  return (
    <section
      data-journal
      aria-labelledby={isIndex ? undefined : "journal-heading"}
      aria-label={isIndex ? "All engineering notes" : undefined}
    >
      {!isIndex && (
        <header>
          <div>
            <p data-section-kicker>Engineering journal</p>
            <h2 id="journal-heading">No magic. Just decisions you can inspect.</h2>
          </div>
          <Link href="/journal">All notes <ArrowUpRight size={15} aria-hidden /></Link>
        </header>
      )}
      <div data-journal-grid>
        {articles.map((article, index) => (
          <Link href={article.href} key={article.href} data-article-card>
            <span data-article-index>0{index + 1}</span>
            <div>
              <small>{article.label}</small>
              <h3>{article.title}</h3>
              <p>{article.description}</p>
            </div>
            <span data-article-meta>{article.meta} <ArrowUpRight size={15} aria-hidden /></span>
          </Link>
        ))}
      </div>
    </section>
  );
}
