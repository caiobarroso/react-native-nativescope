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
