import { codeToHtml, type BundledLanguage } from "shiki";

const themes = {
  light: "github-light",
  dark: "github-dark",
} as const;

/** Highlight executado no servidor durante o build; nenhum runtime do Shiki vai ao browser. */
export function highlightCode(code: string, language: string): Promise<string> {
  return codeToHtml(code.trim(), {
    lang: language as BundledLanguage,
    themes,
    defaultColor: false,
  });
}
