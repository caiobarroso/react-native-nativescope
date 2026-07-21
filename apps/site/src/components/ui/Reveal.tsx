"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Revelação suave: fade + leve subida. Deliberadamente contido — nada de bounce
 * ou distâncias grandes.
 *
 * Por padrão dispara ao entrar na viewport (scroll reveal). Com `immediate`,
 * anima no mount — usado no hero (above-the-fold): não depende de
 * IntersectionObserver, então nunca fica preso invisível e não atrasa o LCP.
 *
 * Respeita prefers-reduced-motion (renderiza já visível, sem transform). É o
 * único ponto "use client" da home; recebe Server Components como children
 * normalmente, então as seções continuam RSC.
 */
export function Reveal({
  children,
  delay = 0,
  immediate = false,
  className,
}: {
  children: ReactNode;
  delay?: number;
  immediate?: boolean;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const shown = { opacity: 1, y: 0 };

  return (
    <motion.div
      data-reveal
      className={className}
      initial={reduce ? false : { opacity: 0, y: 18 }}
      {...(immediate
        ? { animate: reduce ? undefined : shown }
        : {
            whileInView: reduce ? undefined : shown,
            viewport: { once: true, amount: 0.2 },
          })}
      transition={{ duration: 0.5, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}
