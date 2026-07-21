import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * Botão / link de ação. As props são o CONTRATO — a implementação de design
 * pode mudar tudo por dentro, mas `variant` e `size` devem continuar
 * existindo com estes valores, porque as seções os usam.
 *
 * Renderiza <a> quando recebe href e <button> caso contrário: um link que
 * navega precisa ser um link de verdade, por teclado e leitor de tela.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Seta à direita (padrão true). O nudge no hover vem do CSS ([data-button-arrow]). */
  arrow?: boolean;
  children: React.ReactNode;
}

type ButtonProps = CommonProps &
  ({ href: string; onClick?: never } | { href?: never; onClick?: () => void });

export function Button({
  variant = "primary",
  size = "md",
  arrow = true,
  href,
  onClick,
  children,
}: ButtonProps) {
  const attrs = { "data-button": variant, "data-size": size };
  const inner = (
    <>
      {children}
      {arrow && <ArrowRight size={16} aria-hidden data-button-arrow />}
    </>
  );

  if (href) {
    const external = href.startsWith("http");
    if (external) {
      return (
        <a href={href} target="_blank" rel="noreferrer noopener" {...attrs}>
          {inner}
        </a>
      );
    }
    return (
      <Link href={href} {...attrs}>
        {inner}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} {...attrs}>
      {inner}
    </button>
  );
}
