/**
 * Orçamentos de fio (plano de grandes volumes, §1).
 *
 * Nenhuma mensagem individual pode carregar um valor inteiro sem teto —
 * valores grandes trafegam via stream.* em chunks. Estes limites são o
 * contrato objetivo de "o Studio nunca trava com dado grande".
 */

/** Maior fatia de valor devolvida por key-value.get (chars UTF-16). */
export const KEY_VALUE_PREVIEW_LIMIT = 64 * 1024;

/** Tamanho de cada stream.chunk (chars UTF-16). */
export const STREAM_CHUNK_SIZE = 64 * 1024;

/** Maior fatia de célula devolvida por database.rows (chars UTF-16). */
export const CELL_PREVIEW_LIMIT = 4 * 1024;

/**
 * Quantos BYTES de um BLOB a listagem codifica em base64. 3 KB de bytes → 4096
 * chars, exatamente CELL_PREVIEW_LIMIT (3 bytes = 4 chars, sem padding).
 *
 * O corte acontece ANTES de codificar: o caminho anterior convertia o BLOB
 * inteiro e só depois fatiava o base64, então um BLOB de 5 MB era percorrido
 * por completo para a listagem descartar 99,9% do resultado.
 */
export const BLOB_PREVIEW_BYTES = 3 * 1024;

/**
 * Orçamento de uma mensagem WS individual, em BYTES UTF-8 (§1). Fonte única —
 * o teste de orçamento e o guard de transporte leem daqui, nunca de um número
 * mágico solto.
 *
 * Vale como CONTRATO para respostas de comando e eventos: nenhuma resposta
 * pode materializar um valor inteiro — valores grandes trafegam por stream.*.
 * Os chunks de stream são limitados por STREAM_CHUNK_SIZE (64K chars UTF-16),
 * o que para conteúdo real — texto, JSON, base64: ≤ ~2 bytes/char — cabe com
 * folga aqui. O guard de transporte é um DIAGNÓSTICO não-fatal (ver
 * exceedsWireBudget): jamais lança, para nunca derrubar o app do usuário.
 */
export const WIRE_MESSAGE_BUDGET = 256 * 1024;

/**
 * Tamanho em bytes UTF-8 de uma string já serializada, sem alocar buffer.
 * Pós-JSON.stringify a string é ASCII (estrutura/escapes) + chars literais de
 * dado; o pior caso é 3 bytes por unidade UTF-16 (BMP multibyte).
 */
export function wireByteSize(serialized: string): number {
  let bytes = 0;
  for (let i = 0; i < serialized.length; i += 1) {
    const c = serialized.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < serialized.length) {
      // Par surrogate (char astral) = 4 bytes UTF-8 para 2 unidades UTF-16.
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * O frame estoura o orçamento de fio? Curto-circuito barato para o hot path:
 * só conta byte a byte na faixa de dúvida — frames pequenos retornam na hora.
 */
export function exceedsWireBudget(serialized: string): boolean {
  // bytes ≥ unidades UTF-16 sempre → se o comprimento já passou, estourou.
  if (serialized.length > WIRE_MESSAGE_BUDGET) return true;
  // bytes ≤ 3 × unidades UTF-16 sempre → nem no pior caso estoura.
  if (serialized.length * 3 <= WIRE_MESSAGE_BUDGET) return false;
  return wireByteSize(serialized) > WIRE_MESSAGE_BUDGET;
}
