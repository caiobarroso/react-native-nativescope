"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown, Database, Menu, X } from "lucide-react";
import type { DocGroup } from "@content/docs/_meta";

/**
 * Navegação das docs. A ordem vem de content/docs/_meta.ts e não deve ser
 * reordenada aqui — é decisão de produto, não de layout.
 *
 * `aria-current="page"` marca o item ativo. É o hook de estilo do estado
 * ativo e também o que um leitor de tela anuncia; não troque por classe.
 */
export function DocsSidebar({ groups }: { groups: DocGroup[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const current = groups.flatMap((group) => group.items).find((item) => pathname.endsWith(item.slug));

  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <button
        type="button"
        data-docs-mobile-trigger
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls="docs-sidebar"
      >
        <Menu size={17} aria-hidden />
        <span><small>Storage Engine</small>{current?.title ?? "Documentation"}</span>
      </button>

      {open ? <button type="button" data-docs-backdrop onClick={() => setOpen(false)} aria-label="Close documentation navigation" /> : null}

      <nav id="docs-sidebar" data-docs-sidebar data-open={open ? "true" : "false"} aria-label="Documentation">
        <div data-sidebar-header>
          <span>Documentation</span>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close documentation navigation"><X size={17} aria-hidden /></button>
        </div>

        <div data-sidebar-product>
          <Database size={16} aria-hidden />
          <span><small>Product</small>{groups[0]?.product ?? "Storage Engine"}</span>
        </div>

        {groups.map((group) => (
          <details key={group.title} open>
            <summary data-sidebar-group>{group.title}<ChevronDown size={14} aria-hidden /></summary>
            <ul>
              {group.items.map((item) => {
                const href = `/docs/${item.slug}`;
                const active = pathname === href;
                return (
                  <li key={item.slug}>
                    <Link href={href} aria-current={active ? "page" : undefined}>
                      {item.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </details>
        ))}

        <div data-sidebar-coming>
          <small>Platform</small>
          <span>More scopes, same studio.</span>
        </div>
      </nav>
    </>
  );
}
