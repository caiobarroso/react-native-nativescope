"use client";

import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { copyToClipboard } from "@/lib/clipboard";

/**
 * Bloco de código com botão de copiar.
 *
 * Aceita conteúdo React vindo do MDX ou HTML já processado pelo Shiki. O texto
 * é lido do próprio DOM para que o botão de copiar funcione nos dois caminhos.
 */
export function CodeBlock({
  children,
  highlightedHtml,
}: {
  children?: React.ReactNode;
  highlightedHtml?: string;
}) {
  const blockRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  async function copy() {
    const text = blockRef.current?.querySelector("code")?.textContent ?? "";
    if (!text) return;
    if (await copyToClipboard(text)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  }

  return (
    <div ref={blockRef} data-code-block>
      {highlightedHtml ? (
        <div data-highlighted-code dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
      ) : (
        <pre>{children}</pre>
      )}
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
