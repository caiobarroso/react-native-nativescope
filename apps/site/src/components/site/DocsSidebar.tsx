"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, ChevronDown, Database, Globe2, Menu, ScrollText, X } from "lucide-react";
import type { DocGroup } from "@content/docs/_meta";

const moduleOptions = [
  { value: "storage", label: "Storage", href: "/docs/storage/introduction", icon: Database },
  { value: "network", label: "Network", href: "/docs/network/introduction", icon: Globe2 },
  { value: "logs", label: "Logs", href: "/docs/logs/introduction", icon: ScrollText },
] as const;

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
  const [moduleMenuOpen, setModuleMenuOpen] = useState(false);
  const moduleSwitcherRef = useRef<HTMLDivElement | null>(null);
  const moduleOptionRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const focusOptionOnOpen = useRef(false);
  const reduceMotion = useReducedMotion();
  const activeModule = pathname.startsWith("/docs/logs")
    ? "logs"
    : pathname.startsWith("/docs/network")
      ? "network"
      : "storage";
  const visibleGroups = groups.filter((group) => group.module === activeModule);
  const current = visibleGroups
    .flatMap((group) => group.items)
    .find((item) => pathname === `/docs/${item.slug}`);
  const activeOption =
    moduleOptions.find((option) => option.value === activeModule) ?? moduleOptions[0];
  const ActiveModuleIcon = activeOption.icon;

  useEffect(() => {
    setOpen(false);
    setModuleMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moduleMenuOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!moduleSwitcherRef.current?.contains(event.target as Node)) {
        setModuleMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setModuleMenuOpen(false);
        moduleSwitcherRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [moduleMenuOpen]);

  useEffect(() => {
    if (!moduleMenuOpen || !focusOptionOnOpen.current) return;
    focusOptionOnOpen.current = false;
    requestAnimationFrame(() => {
      moduleOptionRefs.current[0]?.focus();
    });
  }, [moduleMenuOpen]);

  const toggleModuleMenu = (focusFirst = false) => {
    focusOptionOnOpen.current = focusFirst;
    setModuleMenuOpen((value) => !value);
  };

  const moveModuleFocus = (currentIndex: number, direction: 1 | -1) => {
    const nextIndex = (currentIndex + direction + moduleOptions.length) % moduleOptions.length;
    moduleOptionRefs.current[nextIndex]?.focus();
  };

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
          <small>{activeOption.label}</small>
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

        <div
          ref={moduleSwitcherRef}
          data-docs-module-switcher
          data-open={moduleMenuOpen ? "true" : undefined}
        >
          <button
            type="button"
            data-docs-module-trigger
            aria-haspopup="menu"
            aria-expanded={moduleMenuOpen}
            aria-controls="docs-module-menu"
            onClick={() => toggleModuleMenu()}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                if (!moduleMenuOpen) toggleModuleMenu(true);
                else moduleOptionRefs.current[0]?.focus();
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                if (!moduleMenuOpen) {
                  focusOptionOnOpen.current = true;
                  setModuleMenuOpen(true);
                } else {
                  moduleOptionRefs.current[moduleOptions.length - 1]?.focus();
                }
              }
            }}
          >
            <ActiveModuleIcon size={16} aria-hidden />
            <span>
              <small>Module</small>
              <strong>{activeOption.label}</strong>
            </span>
            <ChevronDown size={15} aria-hidden />
          </button>

          <AnimatePresence>
            {moduleMenuOpen ? (
              <motion.div
                id="docs-module-menu"
                data-docs-module-menu
                role="menu"
                initial={reduceMotion ? false : { opacity: 0, y: 5, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 3, scale: 0.99 }}
                transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
              >
                {moduleOptions.map((option, index) => {
                  const Icon = option.icon;
                  const active = activeModule === option.value;
                  return (
                    <Link
                      key={option.value}
                      ref={(element) => {
                        moduleOptionRefs.current[index] = element;
                      }}
                      href={option.href}
                      role="menuitem"
                      data-active={active ? "true" : undefined}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setModuleMenuOpen(false)}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowDown") {
                          event.preventDefault();
                          moveModuleFocus(index, 1);
                        }
                        if (event.key === "ArrowUp") {
                          event.preventDefault();
                          moveModuleFocus(index, -1);
                        }
                        if (event.key === "Home") {
                          event.preventDefault();
                          moduleOptionRefs.current[0]?.focus();
                        }
                        if (event.key === "End") {
                          event.preventDefault();
                          moduleOptionRefs.current[moduleOptions.length - 1]?.focus();
                        }
                      }}
                    >
                      <Icon size={16} aria-hidden />
                      <span>{option.label}</span>
                      {active ? <Check size={15} aria-hidden /> : null}
                    </Link>
                  );
                })}
              </motion.div>
            ) : null}
          </AnimatePresence>
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
          <span>Three modules. One local Studio. One Timeline.</span>
        </div>
      </nav>
    </>
  );
}
