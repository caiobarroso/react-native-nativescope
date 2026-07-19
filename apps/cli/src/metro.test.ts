import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { withStorageInspector, SHIM_DIR, SESSION_MODULE } =
  require("../metro/withStorageInspector.cjs") as {
    withStorageInspector: (
      config: Record<string, unknown>,
      options?: { sessionFile?: string; projectRoot?: string },
    ) => {
      resolver: {
        resolveRequest: (
          context: Record<string, unknown>,
          moduleName: string,
          platform: string | null,
        ) => { type: string; filePath: string };
      };
    };
    SHIM_DIR: string;
    SESSION_MODULE: string;
  };

const ASYNC_STORAGE = "@react-native-async-storage/async-storage";

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

describe("withStorageInspector", () => {
  it("intercepta AsyncStorage em dev e entrega o shim", () => {
    const wrapped = withStorageInspector({});
    const { context } = fakeContext();
    const result = wrapped.resolver.resolveRequest(context, ASYNC_STORAGE, "ios");
    expect(result.filePath).toBe(join(SHIM_DIR, "async-storage.js"));
  });

  it("NÃO intercepta em bundle de produção (dev === false)", () => {
    const wrapped = withStorageInspector({});
    const { context } = fakeContext({ dev: false });
    const result = wrapped.resolver.resolveRequest(context, ASYNC_STORAGE, "ios");
    expect(result.filePath).toBe(`/real/${ASYNC_STORAGE}`);
  });

  it("anti-loop: pedido vindo do próprio shim resolve o módulo real", () => {
    const wrapped = withStorageInspector({});
    const { context } = fakeContext({
      originModulePath: join(SHIM_DIR, "async-storage.js"),
    });
    const result = wrapped.resolver.resolveRequest(context, ASYNC_STORAGE, "ios");
    expect(result.filePath).toBe(`/real/${ASYNC_STORAGE}`);
  });

  it("módulos não interceptados passam direto", () => {
    const wrapped = withStorageInspector({});
    const { context } = fakeContext();
    const result = wrapped.resolver.resolveRequest(context, "react", "ios");
    expect(result.filePath).toBe("/real/react");
  });

  it("estende watchFolders com a raiz do pacote e nodeModulesPaths com o do projeto", () => {
    const wrapped = withStorageInspector(
      { watchFolders: ["/existente"] },
      { projectRoot: "/meu/app" },
    ) as unknown as {
      watchFolders: string[];
      resolver: { nodeModulesPaths: string[] };
    };
    expect(wrapped.watchFolders[0]).toBe("/existente");
    expect(wrapped.watchFolders[1]).toContain("metro");
    expect(wrapped.resolver.nodeModulesPaths).toContain("/meu/app/node_modules");
  });

  it("intercepta react-native-mmkv com o shim de auto-discovery", () => {
    const wrapped = withStorageInspector({});
    const { context } = fakeContext();
    const result = wrapped.resolver.resolveRequest(context, "react-native-mmkv", "android");
    expect(result.filePath).toBe(join(SHIM_DIR, "mmkv.js"));
  });

  it("compõe resolveRequest existente do projeto em vez de substituir", () => {
    const custom: string[] = [];
    const wrapped = withStorageInspector({
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

  it("resolve o módulo de sessão para o stub quando a CLI não escreveu o arquivo", () => {
    const wrapped = withStorageInspector({}, { sessionFile: "/nope/nada.js" });
    const { context } = fakeContext({ originModulePath: join(SHIM_DIR, "async-storage.js") });
    const result = wrapped.resolver.resolveRequest(context, SESSION_MODULE, "ios");
    expect(result.filePath).toBe(join(SHIM_DIR, "no-session.js"));
  });

  it("resolve o módulo de sessão para o arquivo da CLI quando existe", () => {
    // usa um arquivo que certamente existe
    const sessionFile = join(SHIM_DIR, "no-session.js");
    const wrapped = withStorageInspector({}, { sessionFile });
    const { context } = fakeContext();
    const result = wrapped.resolver.resolveRequest(context, SESSION_MODULE, "ios");
    expect(result.filePath).toBe(sessionFile);
  });
});
