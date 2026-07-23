import { highlightCode } from "@/lib/highlight";
import { CodeBlock } from "./CodeBlock";

interface HighlightedCodeProps {
  code: string;
  language: string;
}

export async function HighlightedCode({ code, language }: HighlightedCodeProps) {
  const html = await highlightCode(code, language);
  return <CodeBlock highlightedHtml={html} />;
}
