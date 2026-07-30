import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

const require = createRequire(import.meta.url);
const { withNativeScope, SHIM_DIR, SESSION_MODULE, CONFIG_MODULE, BOOT_MODULE, APP_DIR } =
  require("../metro/withNativeScope.cjs") as {
    APP_DIR: string;
    withNativeScope: (
      config: Record<string, unknown>,
      options?: { sessionFile?: string; projectRoot?: string },
    ) => {
      transformer?: { babelTransformerPath?: string };
      resolver: {
        resolveRequest: (
          context: Record<string, unknown>,
          moduleName: string,
          platform: string | null,
        ) => { type: string; filePath?: string };
      };
    };
    SHIM_DIR: string;
    SESSION_MODULE: string;
    CONFIG_MODULE: string;
    BOOT_MODULE: string;
  };

const ASYNC_STORAGE = "@react-native-async-storage/async-storage";
const REACT_QUERY = "@tanstack/react-query";

function fakeContext(overrides: Record<string, unknown> = {}) {
  const calls: Array<{ moduleName: string }> = [];
  const context = {
    dev: true,
    originModulePath: "/project/App.tsx",
    resolveRequest: (_ctx: unknown, moduleName: string) => {
      calls.push({ moduleName });
      return { type: "sourceFile", filePath: `/real/${moduleName}` };
    },
    ...overrides,
  };
  return { context, calls };
}

describe("withNativeScope", () => {
  it("intercepta AsyncStorage em dev e entrega o shim", () => {
    const wrapped = withNativeScope({});
    const { context } = fakeContext();
    const result = wrapped.resolver.resolveRequest(context, ASYNC_STORAGE, "ios");
    expect(result.filePath).toBe(join(SHIM_DIR, "async-storage.js"));
  });

  it("NÃO intercepta em bundle de produção (dev === false)", () => {
    const wrapped = withNativeScope({});
    const { context } = fakeContext({ dev: false });
    const result = wrapped.resolver.resolveRequest(context, ASYNC_STORAGE, "ios");
    expect(result.filePath).toBe(`/real/${ASYNC_STORAGE}`);
  });

  it("anti-loop: pedido vindo do próprio shim resolve o módulo real", () => {
    const wrapped = withNativeScope({});
    const { context } = fakeContext({
      originModulePath: join(SHIM_DIR, "async-storage.js"),
    });
    const result = wrapped.resolver.resolveRequest(context, ASYNC_STORAGE, "ios");
    expect(result.filePath).toBe(`/real/${ASYNC_STORAGE}`);
  });

  it("módulos não interceptados passam direto", () => {
    const wrapped = withNativeScope({});
    const { context } = fakeContext();
    const result = wrapped.resolver.resolveRequest(context, "react", "ios");
    expect(result.filePath).toBe("/real/react");
  });

  it("resolve React do /app a partir do projeto consumidor", () => {
    const reactEntry = require.resolve("react");
    const projectRoot = dirname(dirname(reactEntry));
    const wrapped = withNativeScope({}, { projectRoot });
    const { context } = fakeContext({ originModulePath: join(APP_DIR, "index.cjs") });
    const result = wrapped.resolver.resolveRequest(context, "react", "android");
    expect(result.filePath).toBe(reactEntry);
  });

  it("estende watchFolders com a raiz do pacote e nodeModulesPaths com o do projeto", () => {
    const wrapped = withNativeScope(
      { watchFolders: ["/existente"] },
      { projectRoot: "/meu/app" },
    ) as unknown as {
      watchFolders: string[];
      resolver: { nodeModulesPaths: string[] };
    };
    expect(wrapped.watchFolders[0]).toBe("/existente");
    // a raiz do pacote é apps/cli (pai do diretório metro/)
    expect(wrapped.watchFolders[1]).toContain("cli");
    expect(wrapped.resolver.nodeModulesPaths).toContain("/meu/app/node_modules");
  });

  it("intercepta react-native-mmkv com o shim de auto-discovery", () => {
    const wrapped = withNativeScope({});
    const { context } = fakeContext();
    const result = wrapped.resolver.resolveRequest(context, "react-native-mmkv", "android");
    expect(result.filePath).toBe(join(SHIM_DIR, "mmkv.js"));
  });

  it("intercepta @op-engineering/op-sqlite — pacote com escopo casa por igualdade exata", () => {
    const wrapped = withNativeScope({});
    const { context } = fakeContext();
    const result = wrapped.resolver.resolveRequest(
      context,
      "@op-engineering/op-sqlite",
      "android",
    );
    expect(result.filePath).toBe(join(SHIM_DIR, "op-sqlite.js"));
  });

  it("subpath do op-sqlite NÃO é interceptado (o lookup é da string inteira)", () => {
    const wrapped = withNativeScope({});
    const { context, calls } = fakeContext();
    wrapped.resolver.resolveRequest(context, "@op-engineering/op-sqlite/lib/typeorm", "android");
    // Cai no resolver upstream — limite conhecido, documentado.
    expect(calls.map((c) => c.moduleName)).toEqual(["@op-engineering/op-sqlite/lib/typeorm"]);
  });

  it("intercepta React Query em dev para auto-discovery de QueryClient", () => {
    const wrapped = withNativeScope({});
    const { context } = fakeContext();
    const result = wrapped.resolver.resolveRequest(context, REACT_QUERY, "android");
    expect(result.filePath).toBe(join(SHIM_DIR, "react-query.js"));
  });

  it("compõe resolveRequest existente do projeto em vez de substituir", () => {
    const custom: string[] = [];
    const wrapped = withNativeScope({
      resolver: {
        resolveRequest: (_ctx: unknown, moduleName: string) => {
          custom.push(moduleName);
          return { type: "sourceFile", filePath: `/custom/${moduleName}` };
        },
      },
    });
    const { context } = fakeContext();
    const result = wrapped.resolver.resolveRequest(context, "lodash", "android");
    expect(custom).toEqual(["lodash"]);
    expect(result.filePath).toBe("/custom/lodash");
    // mas o alvo de shim continua interceptado antes do custom
    const shimmed = wrapped.resolver.resolveRequest(context, ASYNC_STORAGE, "android");
    expect(shimmed.filePath).toBe(join(SHIM_DIR, "async-storage.js"));
  });

  it("require de storage ausente vindo do /app resolve para o stub, não quebra o bundle", () => {
    const wrapped = withNativeScope({});
    const context = {
      dev: true,
      originModulePath: join(APP_DIR, "index.cjs"),
      resolveRequest: () => {
        throw new Error("Unable to resolve module");
      },
    };
    const result = wrapped.resolver.resolveRequest(context, ASYNC_STORAGE, "android");
    expect(result.filePath).toBe(join(SHIM_DIR, "missing-module.js"));
  });

  it("require de storage PRESENTE vindo do /app segue o fluxo normal (shim em dev)", () => {
    const wrapped = withNativeScope({});
    const { context } = fakeContext({ originModulePath: join(APP_DIR, "index.cjs") });
    const result = wrapped.resolver.resolveRequest(context, ASYNC_STORAGE, "android");
    expect(result.filePath).toBe(join(SHIM_DIR, "async-storage.js"));
  });

  it("resolve o módulo de sessão para o stub quando a CLI não escreveu o arquivo", () => {
    const wrapped = withNativeScope({}, { sessionFile: "/nope/nada.js" });
    const { context } = fakeContext({ originModulePath: join(SHIM_DIR, "async-storage.js") });
    const result = wrapped.resolver.resolveRequest(context, SESSION_MODULE, "ios");
    expect(result.filePath).toBe(join(SHIM_DIR, "no-session.js"));
  });

  it("resolve o módulo de sessão para o arquivo da CLI quando existe", () => {
    // usa um arquivo que certamente existe
    const sessionFile = join(SHIM_DIR, "no-session.js");
    const wrapped = withNativeScope({}, { sessionFile });
    const { context } = fakeContext();
    const result = wrapped.resolver.resolveRequest(context, SESSION_MODULE, "ios");
    expect(result.filePath).toBe(sessionFile);
  });

  it("resolve o módulo de configuração para o stub quando o app não tem config", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "rnsi-no-config-"));
    try {
      const wrapped = withNativeScope({}, { projectRoot });
      const { context } = fakeContext({ originModulePath: join(SHIM_DIR, "_bootstrap.js") });
      const result = wrapped.resolver.resolveRequest(context, CONFIG_MODULE, "ios");
      expect(result.filePath).toBe(join(SHIM_DIR, "no-config.js"));
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("resolve nativescope.config.ts do root do app", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "rnsi-config-"));
    const configFile = join(projectRoot, "nativescope.config.ts");
    try {
      writeFileSync(configFile, "export default {};\n");
      const wrapped = withNativeScope({}, { projectRoot });
      const { context } = fakeContext({ originModulePath: join(SHIM_DIR, "_bootstrap.js") });
      const result = wrapped.resolver.resolveRequest(context, CONFIG_MODULE, "ios");
      expect(result.filePath).toBe(configFile);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  // Seam de injeção do runtime (independente de storage).
  it("resolve __rnsi_boot__ para o boot real em dev", () => {
    const wrapped = withNativeScope({});
    const { context } = fakeContext();
    const result = wrapped.resolver.resolveRequest(context, BOOT_MODULE, "ios");
    expect(result.filePath).toBe(join(SHIM_DIR, "_boot.js"));
  });

  it("resolve __rnsi_boot__ para MÓDULO VAZIO em produção — nunca um arquivo do pacote", () => {
    const wrapped = withNativeScope({});
    const { context } = fakeContext({ dev: false });
    const result = wrapped.resolver.resolveRequest(context, BOOT_MODULE, "ios");
    // Apontar para um arquivo aqui obrigaria o Metro a hasheá-lo, num caminho
    // fora da árvore do projeto (o pacote entra por symlink). Era o que quebrava
    // `expo export` no CI com "Failed to get the SHA-1".
    expect(result).toEqual({ type: "empty" });
    expect(result.filePath).toBeUndefined();
  });

  it("instala o wrapper do babelTransformerPath (injeta o boot no InitializeCore)", () => {
    const wrapped = withNativeScope({
      transformer: { babelTransformerPath: "/upstream/babel-transformer.js" },
    });
    expect(wrapped.transformer?.babelTransformerPath).toBe(
      join(SHIM_DIR, "..", "babel-transformer.cjs"),
    );
    // O caminho original é preservado via env para o wrapper delegar.
    expect(process.env.RNSI_UPSTREAM_BABEL_TRANSFORMER).toBe("/upstream/babel-transformer.js");
  });
});
