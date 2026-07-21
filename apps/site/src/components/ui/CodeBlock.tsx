"use client";

import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { copyToClipboard } from "@/lib/clipboard";

/**
 * Bloco de código com botão de copiar.
 *
 * Recebe o <code> já montado pelo MDX, então lê o texto do próprio DOM em vez
 * de tentar remontar a partir de props — é o caminho que funciona com
 * qualquer conteúdo aninhado.
 *
 * Syntax highlighting é decisão de design e ainda NÃO existe: hoje sai como
 * texto simples. Ver DESIGN_BRIEF.md.
 */
export function CodeBlock({ children }: { children: React.ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  async function copy() {
    const text = preRef.current?.textContent ?? "";
    if (!text) return;
    if (await copyToClipboard(text)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  }

  return (
    <div data-code-block>
      <pre ref={preRef}>{children}</pre>
      <button
        type="button"
        onClick={copy}
        data-copy-button
        data-copied={copied || undefined}
        aria-label={copied ? "Copied" : "Copy code"}
      >
        {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      </button>
    </div>
  );
}
