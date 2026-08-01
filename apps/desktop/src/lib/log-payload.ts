import type { LogArg } from "@rnsi/protocol";

/**
 * Decide COMO um argumento de log deve ser mostrado no detalhe.
 *
 * O JsonWorkspace é caro: abas (Visual/Tree/Raw/TS), breadcrumb, busca de
 * campos, filtros, cabeçalho de grid, altura mínima. Tudo isso serve para
 * NAVEGAR — e navegar só faz sentido quando há para onde ir. Num
 * `console.log("...", { ts })` o payload inteiro já cabe na linha da mensagem,
 * e o workspace acaba repetindo a mesma informação com dez vezes mais moldura.
 *
 * A pergunta que o heurístico responde é uma só: **isto precisa ser navegado?**
 */

/** Além disto a busca de campos começa a pagar o próprio custo. */
const MAX_COMPACT_FIELDS = 6;
/** Valor que não cabe numa linha de tabela sem virar parágrafo. */
const MAX_COMPACT_VALUE = 80;

export interface CompactField {
  /** Chave do objeto, índice do array, ou "" quando o payload é escalar. */
  key: string;
  value: string;
}

export type LogPayload =
  /** Cabe numa tabela chave/valor — sem abas, sem busca, sem breadcrumb. */
  | { shape: "compact"; fields: CompactField[] }
  /** Tem profundidade, volume ou tamanho: o workspace se justifica. */
  | { shape: "rich" };

const RICH: LogPayload = { shape: "rich" };

/** Como o valor aparece numa célula. Strings sem aspas — é tabela, não JSON. */
function cell(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  return String(value);
}

/** Objeto/array aninhado é o sinal mais forte de que há o que navegar. */
function isNested(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

export function describeLogPayload(arg: LogArg): LogPayload {
  if (arg.json === null) return RICH;
  // Capado no device: o usuário pode querer o Raw para ver onde cortou.
  if (arg.truncated) return RICH;

  let parsed: unknown;
  try {
    parsed = JSON.parse(arg.json);
  } catch {
    return RICH;
  }

  // Escalar solto (um Date que virou string, por exemplo): uma linha só.
  if (!isNested(parsed)) return { shape: "compact", fields: [{ key: "", value: cell(parsed) }] };

  const entries: Array<[string, unknown]> = Array.isArray(parsed)
    ? parsed.map((item, index) => [String(index), item])
    : Object.entries(parsed as Record<string, unknown>);

  if (entries.length === 0) return { shape: "compact", fields: [] };
  if (entries.length > MAX_COMPACT_FIELDS) return RICH;

  const fields: CompactField[] = [];
  for (const [key, value] of entries) {
    if (isNested(value)) return RICH;
    const text = cell(value);
    if (text.length > MAX_COMPACT_VALUE) return RICH;
    fields.push({ key, value: text });
  }
  return { shape: "compact", fields };
}
