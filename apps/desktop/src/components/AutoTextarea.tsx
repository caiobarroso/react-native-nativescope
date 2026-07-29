import { useLayoutEffect, useRef } from "react";

/**
 * Textarea que cresce com o conteúdo até `maxHeight` e então rola — para exibir
 * strings simples por INTEIRO (JWTs, tokens, texto plano) sem cortar na
 * horizontal como um `<input>` de uma linha faz. O textarea já quebra tokens
 * longos sem espaço na largura da caixa, então um JWT vira várias linhas.
 *
 * Reusado no editor de string do Storage (editável) e no viewer de corpo
 * não-JSON do Network (readOnly).
 */
export function AutoTextarea({
  value,
  onChange,
  readOnly = false,
  maxHeight = 384,
  className = "",
  ariaLabel,
}: {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  maxHeight?: number;
  className?: string;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Mede o conteúdo e ajusta a altura. `height="auto"` primeiro para o
  // scrollHeight refletir o tamanho natural (senão a caixa só cresceria).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [value, maxHeight]);

  return (
    <textarea
      ref={ref}
      value={value}
      readOnly={readOnly}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      spellCheck={false}
      aria-label={ariaLabel}
      rows={1}
      style={{ maxHeight }}
      className={`w-full resize-none overflow-y-auto rounded-md border border-border bg-surface-raised px-3 py-1.5 font-mono text-[12px] leading-relaxed text-text outline-none focus:border-accent ${className}`}
    />
  );
}
