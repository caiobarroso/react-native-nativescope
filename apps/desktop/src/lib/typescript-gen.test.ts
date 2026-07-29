import { describe, expect, it } from "vitest";
import { generateTypeScript, typeNameFromKey } from "./typescript-gen.ts";

const asInterface = { declaration: "interface", arrayStyle: "array" } as const;

describe("generateTypeScript", () => {
  it("gera interface de um objeto", () => {
    const ts = generateTypeScript({ id: 7, name: "Caio", premium: false }, "profile", asInterface);
    expect(ts).toBe(
      "export interface Profile {\n  id: number;\n  name: string;\n  premium: boolean;\n}\n",
    );
  });

  it("aninha objetos", () => {
    const ts = generateTypeScript({ user: { id: 1, roles: ["a"] } }, "resp", asInterface);
    expect(ts).toContain("user: {");
    expect(ts).toContain("roles: Array<string>;");
  });

  it("array no topo com interface extends Array", () => {
    const ts = generateTypeScript([{ id: 1 }], "items", asInterface);
    expect(ts).toContain("export interface Items extends Array<");
  });

  it("mescla objetos de um array e marca chaves opcionais", () => {
    const ts = generateTypeScript([{ a: 1 }, { a: 2, b: "x" }], "list", asInterface);
    expect(ts).toContain("a: number;");
    expect(ts).toContain("b?: string;");
  });

  it("modo type usa 'export type'", () => {
    const ts = generateTypeScript("hello", "x", { declaration: "type", arrayStyle: "array" });
    expect(ts).toBe("export type X = string;\n");
  });

  it("bracket array style", () => {
    const ts = generateTypeScript({ xs: [1] }, "x", { declaration: "interface", arrayStyle: "bracket" });
    expect(ts).toContain("xs: number[];");
  });
});

describe("typeNameFromKey", () => {
  it("normaliza chave em PascalCase; prefixa dígitos", () => {
    expect(typeNameFromKey("user.profile")).toBe("UserProfile");
    expect(typeNameFromKey("123")).toBe("Storage123");
    expect(typeNameFromKey(undefined)).toBe("StorageValue");
  });
});
