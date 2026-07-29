import { describe, expect, it } from "vitest";
import { diffJson, parseBody, shortValue } from "./network-diff.ts";

describe("diffJson", () => {
  it("detecta valor alterado num campo aninhado", () => {
    const diffs = diffJson({ page: 2, ok: true }, { page: 3, ok: true });
    expect(diffs).toEqual([{ path: "page", kind: "changed", before: 2, after: 3 }]);
  });

  it("detecta campo adicionado e removido", () => {
    const diffs = diffJson({ a: 1 }, { b: 2 });
    expect(diffs).toContainEqual({ path: "a", kind: "removed", before: 1 });
    expect(diffs).toContainEqual({ path: "b", kind: "added", after: 2 });
  });

  it("caminha em arrays e reporta índices", () => {
    const diffs = diffJson({ items: [1, 2, 3] }, { items: [1, 9, 3] });
    expect(diffs).toEqual([{ path: "items[1]", kind: "changed", before: 2, after: 9 }]);
  });

  it("reporta itens de array removidos", () => {
    const diffs = diffJson({ items: [1, 2] }, { items: [1] });
    expect(diffs).toEqual([{ path: "items[1]", kind: "removed", before: 2 }]);
  });

  it("valores idênticos → sem diffs", () => {
    expect(diffJson({ a: { b: [1, 2] } }, { a: { b: [1, 2] } })).toEqual([]);
  });

  it("path aninhado composto", () => {
    const diffs = diffJson(
      { user: { name: "a", roles: ["admin"] } },
      { user: { name: "b", roles: ["admin"] } },
    );
    expect(diffs).toEqual([{ path: "user.name", kind: "changed", before: "a", after: "b" }]);
  });
});

describe("parseBody", () => {
  it("parseia JSON válido", () => {
    expect(parseBody('{"a":1}')).toEqual({ a: 1 });
  });
  it("devolve o texto cru quando não é JSON", () => {
    expect(parseBody("<html>")).toBe("<html>");
  });
  it("null/undefined → null", () => {
    expect(parseBody(null)).toBeNull();
    expect(parseBody(undefined)).toBeNull();
  });
});

describe("shortValue", () => {
  it("formata primitivos e objetos, truncando longos", () => {
    expect(shortValue("x")).toBe('"x"');
    expect(shortValue(42)).toBe("42");
    expect(shortValue(undefined)).toBe("—");
    const long = shortValue({ data: "a".repeat(200) });
    expect(long.endsWith("…")).toBe(true);
    expect(long.length).toBeLessThan(90);
  });
});
