"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

export interface ArticleHeading {
  id: string;
  title: string;
}

/**
 * Resumo navegável com scroll-spy: o heading dentro da faixa superior da viewport
 * fica ativo, e uma barra de acento desliza (spring) até ele. Respeita
 * prefers-reduced-motion (a barra pula sem animar).
 */
export function OnThisPage({ headings }: { headings: ArticleHeading[] }) {
  const [activeId, setActiveId] = useState<string>(headings[0]?.id ?? "");
  const [bar, setBar] = useState({ top: 0, height: 0 });
  const linkRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const reduce = useReducedMotion();

  // Qual heading está na faixa de leitura (topo da viewport) manda no ativo.
  useEffect(() => {
    if (headings.length < 2) return;
    const els = headings
      .map((h) => document.getElementById(h.id))
      .filter((el): el is HTMLElement => el !== null);
    if (!els.length) return;

    const visible = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target.id, e.isIntersecting);
        const firstVisible = headings.find((h) => visible.get(h.id));
        if (firstVisible) setActiveId(firstVisible.id);
      },
      { rootMargin: "-88px 0px -70% 0px" },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [headings]);

  // Posiciona a barra sob o item ativo (recalcula em resize, caso o título quebre linha).
  useEffect(() => {
    const measure = () => {
      const link = linkRefs.current[activeId];
      if (link) setBar({ top: link.offsetTop, height: link.offsetHeight });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [activeId, headings]);

  if (headings.length < 2) return null;

  return (
    <aside data-on-this-page>
      <p>On this page</p>
      <nav aria-label="On this page">
        <motion.span
          data-toc-indicator
          aria-hidden
          initial={false}
          animate={{ y: bar.top, height: bar.height, opacity: bar.height ? 1 : 0 }}
          transition={
            reduce
              ? { duration: 0 }
              : { type: "spring", stiffness: 600, damping: 48, mass: 0.7 }
          }
        />
        {headings.map((heading) => (
          <Link
            key={heading.id}
            href={`#${heading.id}`}
            ref={(el) => {
              linkRefs.current[heading.id] = el;
            }}
            data-active={heading.id === activeId ? "true" : undefined}
          >
            {heading.title}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
