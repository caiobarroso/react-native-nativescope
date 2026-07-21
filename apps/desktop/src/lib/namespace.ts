/**
 * Derivação de namespace a partir do nome da chave — o coração da visão geral.
 *
 * O storage do app é um mapa plano, mas o humano pensa em *famílias*:
 * `task-details-1475137`, `task-details-1475138`… são UMA coisa com N
 * instâncias, não N coisas. Esta função colapsa a família num rótulo estável
 * (`task-details-*`) para que a agregação por tamanho reflita a estrutura
 * mental, não 4.000 linhas soltas.
 *
 * Regra: tokeniza a chave nos delimitadores comuns e corta no PRIMEIRO
 * segmento "variável" (id numérico, hash/uuid, pedaço de data). Tudo antes do
 * corte + `*` é o rótulo; o texto literal antes do corte é o `prefix`, usado
 * pelo drill (filtrar a lista por aquele começo). Chaves sem parte variável
 * são singletons (o rótulo é a própria chave).
 *
 * Puro e determinístico de propósito — é o que torna testável com as chaves
 * reais do app como fixtures, e o que permite iterar a heurística sem tocar
 * em protocolo nem runtime.
 */

export interface Namespace {
  /** Rótulo de exibição — `task-details-*`, `cpf`, `«sem prefixo»`. */
  label: string;
  /**
   * Começo literal para o drill (filtrar a lista por este prefixo). Vazio
   * quando não há prefixo estável (chave começa com um id) — o drill fica
   * desabilitado nesse caso.
   */
  prefix: string;
}

/** Delimitadores que separam segmentos num nome de chave. */
const DELIMITERS = /([-_/@.:]+)/;

const PURE_INT = /^\d+$/;
/** Hash/uuid: ≥8 chars hex COM ao menos um dígito (evita casar palavras). */
const HEXISH = /^(?=.*\d)[0-9a-fA-F]{8,}$/;

/** Um segmento é "variável" quando parece um id/hash/pedaço de data. */
function isVariableSegment(segment: string): boolean {
  return PURE_INT.test(segment) || HEXISH.test(segment);
}

const EMPTY_LABEL = "«empty»";
const NO_PREFIX_LABEL = "«no prefix»";

export function deriveNamespace(key: string): Namespace {
  if (key === "") return { label: EMPTY_LABEL, prefix: "" };

  // Ex.: "task-details-1475137" → ["task","-","details","-","1475137"].
  // Índices pares são segmentos; ímpares são as corridas de delimitador.
  const parts = key.split(DELIMITERS);

  for (let i = 0; i < parts.length; i += 2) {
    const segment = parts[i] as string;
    if (segment !== "" && isVariableSegment(segment)) {
      // Chave começa por um id (sem palavra antes): não há prefixo estável.
      if (i === 0) return { label: NO_PREFIX_LABEL, prefix: "" };
      const prefix = parts.slice(0, i).join("");
      return { label: `${prefix}*`, prefix };
    }
  }

  // Nenhuma parte variável: a chave é única no seu tipo (singleton).
  return { label: key, prefix: key };
}
