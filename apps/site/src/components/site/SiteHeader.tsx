"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Github, Menu, X } from "lucide-react";
import { BrandLogo } from "@/components/site/BrandLogo";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

const NAV_LINKS = [
  { href: "/docs", label: "Docs" },
  { href: "/journal", label: "Journal" },
  { href: "/our-goal", label: "Our Goal" },
  { href: "/compare/rozenite", label: "Compare" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);

  // Ativa por segmento raiz: /docs/quickstart acende "Docs", /journal/x acende "Journal".
  const isActive = (href: string) => {
    const seg = `/${href.split("/")[1]}`;
    return pathname === seg || pathname.startsWith(`${seg}/`);
  };

  return (
    <header data-site-header>
      <div data-header-inner>
        <Link href="/" data-logo aria-label="NativeScope home">
          <BrandLogo priority />
        </Link>

        <nav id="site-navigation" data-site-nav data-open={open ? "true" : "false"} aria-label="Main">
          {NAV_LINKS.map((link) => {
            const active = isActive(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                data-active={active ? "true" : undefined}
                aria-current={active ? "page" : undefined}
              >
                {link.label}
              </Link>
            );
          })}
          <a
            href="https://github.com/caiobarroso/react-native-storage-inspector"
            target="_blank"
            rel="noreferrer noopener"
          >
            <Github size={15} aria-hidden /> GitHub
          </a>
        </nav>

        <div data-header-actions>
          <ThemeToggle />
          <button
            type="button"
            data-menu-toggle
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="site-navigation"
            aria-label={open ? "Close navigation" : "Open navigation"}
          >
            {open ? <X size={18} aria-hidden /> : <Menu size={18} aria-hidden />}
          </button>
        </div>
      </div>
    </header>
  );
}
