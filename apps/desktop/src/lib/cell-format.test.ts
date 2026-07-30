import { describe, expect, it } from "vitest";
import {
  blobByteLength,
  blobLabel,
  cellText,
  decodeBase64,
  formatBlobSize,
  hexDump,
  isBlobCell,
  isCellEditable,
} from "./cell-format.ts";

describe("isBlobCell", () => {
  it("reconhece só o objeto de BLOB", () => {
    expect(isBlobCell({ blobBase64: "AAA=" })).toBe(true);
    expect(isBlobCell("texto")).toBe(false);
    expect(isBlobCell(42)).toBe(false);
    expect(isBlobCell(null)).toBe(false);
  });
});

describe("blobByteLength", () => {
  it("usa byteLength do runtime, não o tamanho do base64", () => {
    // Preview: base64 de 4096 chars (3072 bytes) para um BLOB de 5 MB.
    expect(blobByteLength({ blobBase64: "A".repeat(4096), byteLength: 5_242_880 })).toBe(5_242_880);
  });

  it("deriva dos chars quando o runtime é antigo, descontando padding", () => {
    expect(blobByteLength({ blobBase64: "QUJD" })).toBe(3); // "ABC"
    expect(blobByteLength({ blobBase64: "QUI=" })).toBe(2); // "AB"
    expect(blobByteLength({ blobBase64: "QQ==" })).toBe(1); // "A"
    expect(blobByteLength({ blobBase64: "" })).toBe(0);
  });
});

describe("formatBlobSize", () => {
  it("escala B → KB → MB", () => {
    expect(formatBlobSize(0)).toBe("0 B");
    expect(formatBlobSize(96)).toBe("96 B");
    expect(formatBlobSize(1024)).toBe("1.0 KB");
    expect(formatBlobSize(8000)).toBe("7.8 KB");
    expect(formatBlobSize(200 * 1024)).toBe("200 KB");
    expect(formatBlobSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("não inventa valor para entrada inválida", () => {
    expect(formatBlobSize(Number.NaN)).toBe("0 B");
    expect(formatBlobSize(-1)).toBe("0 B");
  });
});

describe("cellText", () => {
  it("mostra o tamanho do BLOB, não só (blob)", () => {
    expect(cellText({ blobBase64: "AAA=", byteLength: 8000 })).toBe("(blob, 7.8 KB)");
    expect(blobLabel({ blobBase64: "AAA=", byteLength: 96 })).toBe("(blob, 96 B)");
  });

  it("NULL e escalares seguem como antes", () => {
    expect(cellText(null)).toBe("NULL");
    expect(cellText("sunset")).toBe("sunset");
    expect(cellText(326)).toBe("326");
  });
});

describe("isCellEditable", () => {
  it("recusa BLOB — editar inline gravaria texto sobre os bytes", () => {
    expect(isCellEditable({ blobBase64: "AAA=", byteLength: 96 })).toBe(false);
  });

  it("permite texto, número e NULL", () => {
    expect(isCellEditable("sunset")).toBe(true);
    expect(isCellEditable(326)).toBe(true);
    expect(isCellEditable(null)).toBe(true);
  });
});

describe("decodeBase64", () => {
  it("decodifica para os bytes originais", () => {
    expect([...decodeBase64("QUJD")]).toEqual([65, 66, 67]);
  });

  it("entrada inválida devolve vazio em vez de lançar", () => {
    expect(decodeBase64("!!!não é base64!!!").length).toBe(0);
  });
});

describe("hexDump", () => {
  it("quebra em linhas de 16 bytes com offset hex", () => {
    const rows = hexDump(new Uint8Array(20).map((_, i) => i));
    expect(rows).toHaveLength(2);
    expect(rows[0]?.offset).toBe("00000000");
    expect(rows[0]?.hex).toHaveLength(16);
    expect(rows[0]?.hex[0]).toBe("00");
    expect(rows[0]?.hex[15]).toBe("0f");
    expect(rows[1]?.offset).toBe("00000010");
    expect(rows[1]?.hex).toHaveLength(4);
  });

  it("ASCII imprimível aparece; o resto vira ponto", () => {
    const rows = hexDump(new Uint8Array([0x41, 0x42, 0x00, 0x7f, 0x20]));
    expect(rows[0]?.ascii).toBe("AB.. ");
  });

  it("vazio não produz linha", () => {
    expect(hexDump(new Uint8Array(0))).toEqual([]);
  });
});
