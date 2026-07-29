"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown, Database, Globe2, Menu, X } from "lucide-react";
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
  const activeModule = pathname.startsWith("/docs/network") ? "network" : "storage";
  const visibleGroups = groups.filter((group) => group.module === activeModule);
  const current = visibleGroups
    .flatMap((group) => group.items)
    .find((item) => pathname === `/docs/${item.slug}`);
  const productName = activeModule === "network" ? "Network" : "Storage";

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
        <span>
          <small>{productName}</small>
          {current?.title ?? "Documentation"}
        </span>
      </button>

      {open ? (
        <button
          type="button"
          data-docs-backdrop
          onClick={() => setOpen(false)}
          aria-label="Close documentation navigation"
        />
      ) : null}

      <nav
        id="docs-sidebar"
        data-docs-sidebar
        data-open={open ? "true" : "false"}
        aria-label="Documentation"
      >
        <div data-sidebar-header>
          <span>Documentation</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close documentation navigation"
          >
            <X size={17} aria-hidden />
          </button>
        </div>

        <div data-docs-module-switcher aria-label="Documentation module">
          <Link
            href="/docs/storage/introduction"
            data-active={activeModule === "storage" ? "true" : undefined}
          >
            <Database size={15} aria-hidden />
            <span>
              <small>Module</small>Storage
            </span>
          </Link>
          <Link
            href="/docs/network/introduction"
            data-active={activeModule === "network" ? "true" : undefined}
          >
            <Globe2 size={15} aria-hidden />
            <span>
              <small>Module</small>Network
            </span>
          </Link>
        </div>

        {visibleGroups.map((group) => (
          <details key={group.title} open>
            <summary data-sidebar-group>
              {group.title}
              <ChevronDown size={14} aria-hidden />
            </summary>
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
          <small>NativeScope environment</small>
          <span>Two modules. One local Studio.</span>
        </div>
      </nav>
    </>
  );
}
