import type { CellValue } from "@rnsi/protocol";

/**
 * Como uma célula de banco vira texto na tela — e por que BLOB é caso especial.
 *
 * Lógica pura de propósito: o rótulo do BLOB e o guard de edição são a diferença
 * entre "não dá para editar bytes" e sobrescrever um BLOB com a string "(blob)".
 * Isso precisa de teste, então não pode morar dentro do componente.
 */

export type BlobCell = { blobBase64: string; byteLength?: number };

export function isBlobCell(value: CellValue): value is BlobCell {
  return value !== null && typeof value === "object";
}

/**
 * Tamanho real do BLOB. `byteLength` vem do runtime; o fallback deriva dos
 * chars de base64 (4 chars = 3 bytes) e só existe para runtime antigo — nesse
 * caminho o base64 pode ser um preview, então o valor sai POR BAIXO. Melhor
 * subestimar que inventar.
 */
export function blobByteLength(value: BlobCell): number {
  if (value.byteLength !== undefined) return value.byteLength;
  const padding = value.blobBase64.endsWith("==") ? 2 : value.blobBase64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((value.blobBase64.length * 3) / 4) - padding);
}

/**
 * Bytes legíveis. Mesma escala do formatBytes do módulo de network — seis linhas
 * repetidas em vez de `lib` importar de `components`.
 */
export function formatBlobSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/**
 * Rótulo de um BLOB no grid. Sem o tamanho, "(blob)" não distingue 1 byte de
 * 5 MB — e era a única informação que a coluna dava.
 */
export function blobLabel(value: BlobCell): string {
  return `(blob, ${formatBlobSize(blobByteLength(value))})`;
}

export function cellText(value: CellValue): string {
  if (value === null) return "NULL";
  if (isBlobCell(value)) return blobLabel(value);
  return String(value);
}

/**
 * Uma célula BLOB nunca entra em edição inline. O editor é de TEXTO: abrir com
 * `cellText` gravaria a string "(blob)" em cima dos bytes, e abrir com o base64
 * completo gravaria o base64 como TEXT. Os dois destroem o dado em silêncio, e
 * o runtime não pode defender (recebe uma string legítima). O protocolo já
 * declara BLOB como read-only — isto é o que faz valer.
 */
export function isCellEditable(value: CellValue): boolean {
  return !isBlobCell(value);
}

/** Base64 → bytes. `atob` existe no browser; entrada inválida devolve vazio. */
export function decodeBase64(base64: string): Uint8Array {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return new Uint8Array(0);
  }
}

export interface HexDumpRow {
  /** Offset do primeiro byte da linha, em hexadecimal. */
  offset: string;
  /** 16 pares hex (ou menos na última linha). */
  hex: string[];
  /** Os mesmos bytes em ASCII imprimível; o resto vira ponto. */
  ascii: string;
}

const HEX_ROW_BYTES = 16;

/** Dump hex/ASCII no formato clássico — 16 bytes por linha. */
export function hexDump(bytes: Uint8Array): HexDumpRow[] {
  const rows: HexDumpRow[] = [];
  for (let start = 0; start < bytes.length; start += HEX_ROW_BYTES) {
    const slice = bytes.subarray(start, start + HEX_ROW_BYTES);
    const hex: string[] = [];
    let ascii = "";
    for (const byte of slice) {
      hex.push(byte.toString(16).padStart(2, "0"));
      ascii += byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".";
    }
    rows.push({
      offset: start.toString(16).padStart(8, "0"),
      hex,
      ascii,
    });
  }
  return rows;
}
