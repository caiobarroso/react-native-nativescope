import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TOKEN_CACHE_DIR, resolveSessionToken, tokenFilePath } from "./session-token.ts";

const created: string[] = [];

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "rnsi-token-"));
  created.push(dir);
  return dir;
}

afterEach(() => {
  while (created.length > 0) rmSync(created.pop()!, { recursive: true, force: true });
});

describe("token de sessão", () => {
  it("cria na primeira execução e reaproveita na seguinte", () => {
    const dir = project();

    const first = resolveSessionToken(dir);
    expect(first.source).toBe("created");
    expect(first.token).toMatch(/^[0-9a-f]{32}$/);

    const second = resolveSessionToken(dir);
    // É esta igualdade que faz a aba antiga do Studio continuar valendo depois
    // de reiniciar a CLI — a razão de existir deste módulo.
    expect(second.token).toBe(first.token);
    expect(second.source).toBe("reused");
  });

  it("guarda o token só para o dono do arquivo (0600)", () => {
    const dir = project();
    resolveSessionToken(dir);
    const mode = statSync(tokenFilePath(dir)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("--new-token rotaciona e persiste o novo", () => {
    const dir = project();
    const first = resolveSessionToken(dir);

    const rotated = resolveSessionToken(dir, { fresh: true });
    expect(rotated.source).toBe("created");
    expect(rotated.token).not.toBe(first.token);

    expect(resolveSessionToken(dir).token).toBe(rotated.token);
  });

  it("--token explícito manda e não é persistido", () => {
    const dir = project();
    const stored = resolveSessionToken(dir).token;

    const override = resolveSessionToken(dir, { override: "abc123" });
    expect(override).toEqual({ token: "abc123", source: "override" });
    // O cache continua intocado: --token é decisão pontual, não muda o projeto.
    expect(readFileSync(tokenFilePath(dir), "utf8").trim()).toBe(stored);
  });

  it("cache corrompido não quebra: gera um token válido por cima", () => {
    const dir = project();
    mkdirSync(join(dir, TOKEN_CACHE_DIR), { recursive: true });
    writeFileSync(tokenFilePath(dir), "not-a-token\n");

    const resolved = resolveSessionToken(dir);
    expect(resolved.source).toBe("created");
    expect(resolved.token).toMatch(/^[0-9a-f]{32}$/);
    expect(readFileSync(tokenFilePath(dir), "utf8").trim()).toBe(resolved.token);
  });

  it("sem poder escrever, degrada para token efêmero (comportamento antigo)", () => {
    // "projectDir" que na verdade é um arquivo: qualquer mkdir dentro dele
    // falha com ENOTDIR em todo SO e mesmo rodando como root (CI em container).
    const dir = project();
    const notADir = join(dir, "file");
    writeFileSync(notADir, "");

    const resolved = resolveSessionToken(notADir);
    expect(resolved.source).toBe("ephemeral");
    expect(resolved.token).toMatch(/^[0-9a-f]{32}$/);
  });
});
