/**
 * Copia texto para a área de transferência com fallback.
 *
 * `navigator.clipboard` só existe em contexto seguro (https ou localhost). Num
 * preview servido por http/IP de LAN, ou dentro de um iframe sem permissão, ele
 * vem `undefined` — então o caminho moderno é tentado primeiro e, se indisponível
 * ou bloqueado, cai no `document.execCommand("copy")` legado, que funciona em
 * contexto inseguro. Retorna `true` só quando a cópia de fato aconteceu.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* segue para o fallback */
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
