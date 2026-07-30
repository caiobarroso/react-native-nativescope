import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * O wrapper do babelTransformerPath injeta `require("__rnsi_boot__")` no
 * InitializeCore — é assim que o runtime sobe sem o app importar nada.
 *
 * O que estes testes travam: a injeção NÃO acontece em build de release. Antes
 * era incondicional, e o `__rnsi_boot__` de produção resolvia para um arquivo do
 * pacote (fora da árvore do projeto), que o Metro precisa hashear — o export de
 * release do CI morria com "Failed to get the SHA-1".
 */

const require = createRequire(import.meta.url);

interface TransformParams {
  filename: string;
  src: string;
  options?: { dev?: boolean };
}
interface Transformer {
  transform: (params: TransformParams) => { src: string; filename: string };
  getCacheKey: (...args: unknown[]) => string;
}

const INITIALIZE_CORE = "/app/node_modules/react-native/Libraries/Core/InitializeCore.js";
const BOOT_REQUIRE = 'require("__rnsi_boot__")';

let transformer: Transformer;

beforeAll(() => {
  // Upstream falso: devolve o que recebeu, para o teste ver o src final.
  const dir = mkdtempSync(join(tmpdir(), "rnsi-babel-"));
  const upstream = join(dir, "upstream.cjs");
  writeFileSync(
    upstream,
    `module.exports = {
      transform: (params) => params,
      getCacheKey: () => "upstream-key",
    };`,
  );
  // Precisa estar no env ANTES do primeiro require: o wrapper cacheia o upstream.
  process.env.RNSI_UPSTREAM_BABEL_TRANSFORMER = upstream;
  transformer = require("../metro/babel-transformer.cjs") as Transformer;
});

describe("babel-transformer (injeção do boot)", () => {
  it("injeta o boot no InitializeCore em dev", () => {
    const result = transformer.transform({
      filename: INITIALIZE_CORE,
      src: "// core",
      options: { dev: true },
    });
    expect(result.src).toContain(BOOT_REQUIRE);
  });

  it("NÃO injeta em build de release (dev === false)", () => {
    const result = transformer.transform({
      filename: INITIALIZE_CORE,
      src: "// core",
      options: { dev: false },
    });
    expect(result.src).not.toContain(BOOT_REQUIRE);
    expect(result.src).toBe("// core");
  });

  it("sem options.dev, trata como dev — o padrão seguro é instrumentar", () => {
    const result = transformer.transform({ filename: INITIALIZE_CORE, src: "// core" });
    expect(result.src).toContain(BOOT_REQUIRE);
  });

  it("não toca em nenhum outro arquivo", () => {
    for (const dev of [true, false]) {
      const result = transformer.transform({
        filename: "/app/App.tsx",
        src: "export default 1;",
        options: { dev },
      });
      expect(result.src).toBe("export default 1;");
    }
  });

  it("o boot é APPEND: o core do RN roda antes", () => {
    const result = transformer.transform({
      filename: INITIALIZE_CORE,
      src: "setUpErrorHandling();",
      options: { dev: true },
    });
    expect(result.src.indexOf("setUpErrorHandling")).toBeLessThan(
      result.src.indexOf(BOOT_REQUIRE),
    );
  });

  it("getCacheKey carrega o bump próprio além da chave do upstream", () => {
    const key = transformer.getCacheKey();
    expect(key).toContain("upstream-key");
    expect(key).toContain("rnsi-boot-inject-v2");
  });
});
