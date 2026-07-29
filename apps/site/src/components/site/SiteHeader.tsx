"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown, Database, Github, Globe2, Menu, X } from "lucide-react";
import { BrandLogo } from "@/components/site/BrandLogo";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

const NAV_LINKS = [
  { href: "/docs", label: "Docs" },
  { href: "/journal", label: "Journal" },
  { href: "/our-goal", label: "Our Goal" },
];

type HeaderMenu = "modules" | "compare";

const MENU_INDEX: Record<HeaderMenu, number> = {
  modules: 0,
  compare: 1,
};

function measureMenuOffset(cluster: HTMLDivElement | null, trigger: HTMLButtonElement | null) {
  if (!cluster || !trigger || window.matchMedia("(max-width: 840px)").matches) return 0;

  const clusterRect = cluster.getBoundingClientRect();
  const triggerRect = trigger.getBoundingClientRect();
  return triggerRect.left + triggerRect.width / 2 - (clusterRect.left + clusterRect.width / 2);
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [activeMenu, setActiveMenu] = useState<HeaderMenu | null>(null);
  const [menuDirection, setMenuDirection] = useState(1);
  const [menuOffset, setMenuOffset] = useState(0);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuCluster = useRef<HTMLDivElement | null>(null);
  const modulesTrigger = useRef<HTMLButtonElement | null>(null);
  const compareTrigger = useRef<HTMLButtonElement | null>(null);
  const reduceMotion = useReducedMotion();
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
    setActiveMenu(null);
  }, [pathname]);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!activeMenu) return;

    const alignMenu = () => {
      const trigger = activeMenu === "modules" ? modulesTrigger.current : compareTrigger.current;
      setMenuOffset(measureMenuOffset(menuCluster.current, trigger));
    };

    alignMenu();
    window.addEventListener("resize", alignMenu);
    return () => window.removeEventListener("resize", alignMenu);
  }, [activeMenu]);

  const cancelClose = () => {
    if (!closeTimer.current) return;
    clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };

  const showMenu = (menu: HeaderMenu) => {
    cancelClose();
    if (activeMenu && activeMenu !== menu) {
      setMenuDirection(MENU_INDEX[menu] > MENU_INDEX[activeMenu] ? 1 : -1);
    }
    const trigger = menu === "modules" ? modulesTrigger.current : compareTrigger.current;
    setMenuOffset(measureMenuOffset(menuCluster.current, trigger));
    setActiveMenu(menu);
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setActiveMenu(null), 140);
  };

  const toggleMenu = (menu: HeaderMenu) => {
    cancelClose();
    if (activeMenu === menu) {
      setActiveMenu(null);
      return;
    }
    showMenu(menu);
  };

  // Ativa por segmento raiz: /docs/storage/quickstart acende "Docs", /journal/x acende "Journal".
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

        <nav
          id="site-navigation"
          data-site-nav
          data-open={open ? "true" : "false"}
          aria-label="Main"
        >
          <div
            ref={menuCluster}
            data-header-menu-cluster
            onMouseLeave={scheduleClose}
            onMouseEnter={cancelClose}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) scheduleClose();
            }}
          >
            <button
              ref={modulesTrigger}
              type="button"
              onMouseEnter={() => showMenu("modules")}
              onFocus={() => showMenu("modules")}
              onClick={() => toggleMenu("modules")}
              aria-expanded={activeMenu === "modules"}
              aria-controls="header-context-menu"
              data-active={pathname.startsWith("/modules") ? "true" : undefined}
              data-header-menu-trigger
            >
              Modules <ChevronDown size={13} aria-hidden />
            </button>
            <button
              ref={compareTrigger}
              type="button"
              onMouseEnter={() => showMenu("compare")}
              onFocus={() => showMenu("compare")}
              onClick={() => toggleMenu("compare")}
              aria-expanded={activeMenu === "compare"}
              aria-controls="header-context-menu"
              data-active={pathname.startsWith("/compare") ? "true" : undefined}
              data-header-menu-trigger
            >
              Compare <ChevronDown size={13} aria-hidden />
            </button>

            <AnimatePresence>
              {activeMenu ? (
                <div data-header-menu-anchor>
                  <motion.div
                    data-header-menu-positioner
                    initial={false}
                    animate={{ x: menuOffset }}
                    transition={{
                      duration: reduceMotion ? 0 : undefined,
                      type: reduceMotion ? "tween" : "spring",
                      stiffness: 480,
                      damping: 42,
                      mass: 0.7,
                    }}
                  >
                    <motion.div
                      id="header-context-menu"
                      data-header-menu-popover
                      initial={reduceMotion ? false : { opacity: 0, y: 5, scale: 0.985 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 3, scale: 0.99 }}
                      transition={{
                        opacity: {
                          duration: reduceMotion ? 0 : 0.18,
                          ease: [0.22, 1, 0.36, 1],
                        },
                        y: {
                          duration: reduceMotion ? 0 : 0.18,
                          ease: [0.22, 1, 0.36, 1],
                        },
                        scale: {
                          duration: reduceMotion ? 0 : 0.18,
                          ease: [0.22, 1, 0.36, 1],
                        },
                        layout: reduceMotion
                          ? { duration: 0 }
                          : {
                              type: "spring",
                              stiffness: 430,
                              damping: 38,
                              mass: 0.65,
                            },
                      }}
                      layout={!reduceMotion}
                    >
                      <AnimatePresence initial={false} mode="popLayout" custom={menuDirection}>
                        <motion.div
                          key={activeMenu}
                          data-header-menu-content
                          custom={menuDirection}
                          variants={{
                            enter: (direction: number) =>
                              reduceMotion
                                ? { opacity: 1 }
                                : {
                                    opacity: 0,
                                    x: direction * 20,
                                    filter: "blur(3px)",
                                  },
                            center: {
                              opacity: 1,
                              x: 0,
                              filter: "blur(0px)",
                            },
                            exit: (direction: number) =>
                              reduceMotion
                                ? { opacity: 0 }
                                : {
                                    opacity: 0,
                                    x: direction * -14,
                                    filter: "blur(3px)",
                                  },
                          }}
                          initial="enter"
                          animate="center"
                          exit="exit"
                          transition={{
                            duration: reduceMotion ? 0 : 0.21,
                            ease: [0.22, 1, 0.36, 1],
                          }}
                        >
                          {activeMenu === "modules" ? (
                            <>
                              <Link href="/modules/storage">
                                <Database size={16} aria-hidden />
                                <span>
                                  <strong>Storage</strong>
                                  <small>AsyncStorage, MMKV and SQLite</small>
                                </span>
                              </Link>
                              <Link href="/modules/network">
                                <Globe2 size={16} aria-hidden />
                                <span>
                                  <strong>Network</strong>
                                  <small>Capture, replay and compare</small>
                                </span>
                              </Link>
                            </>
                          ) : (
                            <>
                              <Link href="/compare/rozenite">
                                <Database size={16} aria-hidden />
                                <span>
                                  <strong>Storage vs Rozenite</strong>
                                  <small>Storage workflow and integration</small>
                                </span>
                              </Link>
                              <Link href="/compare/reactotron">
                                <Globe2 size={16} aria-hidden />
                                <span>
                                  <strong>Network vs Reactotron</strong>
                                  <small>Capture, inspection and replay</small>
                                </span>
                              </Link>
                            </>
                          )}
                        </motion.div>
                      </AnimatePresence>
                    </motion.div>
                  </motion.div>
                </div>
              ) : null}
            </AnimatePresence>
          </div>
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
            href="https://github.com/caiobarroso/react-native-nativescope"
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
