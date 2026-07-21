/**
 * EXTRAÇÃO DE CÓDIGO REAL — CONGELADO.
 *
 * Lê trechos de arquivos de verdade do monorepo em build time. É isto que
 * torna "as docs não podem divergir do código" mecânico em vez de disciplina:
 * se alguém renomear um tipo, o build do site quebra em vez de publicar uma
 * assinatura que não existe mais.
 *
 * É também a justificativa concreta de o site morar no monorepo.
 *
 * Três modos:
 *   snippet("path/to/file.ts")                        → arquivo inteiro
 *   snippet("path/to/file.ts", { region: "setup" })   → entre marcadores
 *   snippet("path/to/file.ts", { symbol: "Options" }) → uma declaração TS
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Sobe até achar o pnpm-workspace.yaml — robusto ao cwd do next build. */
function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("snippets: não encontrei a raiz do monorepo a partir de " + process.cwd());
}

const REPO_ROOT = findRepoRoot();

export interface SnippetOptions {
  /** Trecho entre `// #region <nome>` e `// #endregion`. */
  region?: string;
  /** Uma declaração TypeScript exportada, pelo nome. */
  symbol?: string;
}

/** Remove a indentação comum de todas as linhas não vazias. */
function dedent(lines: string[]): string[] {
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => line.length - line.trimStart().length);
  const min = indents.length > 0 ? Math.min(...indents) : 0;
  return min > 0 ? lines.map((line) => line.slice(min)) : lines;
}

function extractRegion(source: string, region: string, file: string): string {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line.includes(`#region ${region}`));
  if (start === -1) {
    throw new Error(`snippets: região "${region}" não existe em ${file}`);
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.includes("#endregion"));
  if (end === -1) {
    throw new Error(`snippets: região "${region}" em ${file} não foi fechada`);
  }
  return dedent(rest.slice(0, end)).join("\n").trim();
}

/**
 * Captura o bloco JSDoc imediatamente acima da declaração — é documentação
 * escrita pelo autor do código, então vale a pena aparecer nas docs.
 */
function precedingDoc(lines: string[], declIndex: number): number {
  let start = declIndex;
  let i = declIndex - 1;
  if (i >= 0 && lines[i]!.trim().endsWith("*/")) {
    while (i >= 0) {
      if (lines[i]!.trim().startsWith("/*")) {
        start = i;
        break;
      }
      i -= 1;
    }
  }
  return start;
}

function extractSymbol(source: string, symbol: string, file: string): string {
  const lines = source.split("\n");
  const pattern = new RegExp(
    `^\\s*export\\s+(declare\\s+)?(interface|type|function|const|class)\\s+${symbol}\\b`,
  );
  const declIndex = lines.findIndex((line) => pattern.test(line));
  if (declIndex === -1) {
    throw new Error(`snippets: símbolo "${symbol}" não existe em ${file}`);
  }

  const start = precedingDoc(lines, declIndex);

  // Varre contando chaves/parênteses; termina quando a profundidade volta a
  // zero num `}` ou quando encontra um `;` de topo (caso dos type aliases).
  let depth = 0;
  let seenOpener = false;
  let end = declIndex;
  for (let i = declIndex; i < lines.length; i += 1) {
    const line = lines[i]!;
    for (const char of line) {
      if (char === "{" || char === "(") {
        depth += 1;
        seenOpener = true;
      } else if (char === "}" || char === ")") {
        depth -= 1;
      }
    }
    end = i;
    if (seenOpener && depth <= 0) break;
    if (!seenOpener && line.trimEnd().endsWith(";")) break;
  }

  return dedent(lines.slice(start, end + 1)).join("\n").trim();
}

/** Caminho relativo à raiz do monorepo, ex.: "apps/cli/app/index.d.ts". */
export function snippet(file: string, options: SnippetOptions = {}): string {
  const absolute = resolve(REPO_ROOT, file);
  if (!absolute.startsWith(REPO_ROOT)) {
    throw new Error(`snippets: caminho fora do repositório: ${file}`);
  }
  if (!existsSync(absolute)) {
    throw new Error(`snippets: arquivo não existe: ${file}`);
  }

  const source = readFileSync(absolute, "utf8");
  if (options.region) return extractRegion(source, options.region, file);
  if (options.symbol) return extractSymbol(source, options.symbol, file);
  return source.trim();
}

/** Linguagem para o highlight, inferida da extensão. */
export function languageOf(file: string): string {
  if (file.endsWith(".d.ts") || file.endsWith(".ts")) return "ts";
  if (file.endsWith(".tsx")) return "tsx";
  if (file.endsWith(".js") || file.endsWith(".cjs") || file.endsWith(".mjs")) return "js";
  if (file.endsWith(".json")) return "json";
  if (file.endsWith(".css")) return "css";
  return "text";
}
