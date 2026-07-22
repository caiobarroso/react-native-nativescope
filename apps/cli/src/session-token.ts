import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Token de sessão persistido por projeto.
 *
 * Um token novo a cada execução transformava todo cliente já aberto em cliente
 * permanentemente inválido: a aba do Studio da execução anterior e o bundle já
 * carregado no device passam a apresentar um token que nunca mais vai valer.
 * Como ambos reconectam sozinhos, isso vira ruído infinito — e nenhuma dev tool
 * séria invalida a UI aberta do usuário só porque o servidor reiniciou.
 *
 * Persistir o token torna reiniciar a CLI um não-evento: a aba aberta reconecta
 * e volta a funcionar, o bundle no device continua válido. Rejeição volta a
 * significar o que deveria — algo genuinamente errado.
 *
 * Fica em node_modules/.cache (já fora do git) com permissão 0600. `--token`
 * explícito manda e não é persistido; `--new-token` rotaciona.
 */

export const TOKEN_CACHE_DIR = join("node_modules", ".cache", "rnsi");
export const TOKEN_FILE_NAME = "token";

/** 16 bytes em hex — o mesmo formato que a CLI sempre gerou. */
const TOKEN_PATTERN = /^[0-9a-f]{32}$/;

export type TokenSource =
  /** veio de --token: a decisão é do usuário, não persistimos. */
  | "override"
  /** reaproveitado do cache do projeto — o caso normal. */
  | "reused"
  /** gerado agora (primeira execução, --new-token, ou cache inválido). */
  | "created"
  /** gerado agora e NÃO persistido: sem node_modules ou fs read-only. */
  | "ephemeral";

export interface ResolvedToken {
  token: string;
  source: TokenSource;
}

export function tokenFilePath(projectDir: string): string {
  return join(projectDir, TOKEN_CACHE_DIR, TOKEN_FILE_NAME);
}

export function resolveSessionToken(
  projectDir: string,
  options: { override?: string | undefined; fresh?: boolean } = {},
): ResolvedToken {
  if (options.override) return { token: options.override, source: "override" };

  const filePath = tokenFilePath(projectDir);

  if (!options.fresh) {
    try {
      const stored = readFileSync(filePath, "utf8").trim();
      // Cache corrompido não é fatal: gera um token novo por cima.
      if (TOKEN_PATTERN.test(stored)) return { token: stored, source: "reused" };
    } catch {
      /* ausente ou ilegível: cai para a criação abaixo */
    }
  }

  const token = randomBytes(16).toString("hex");
  try {
    mkdirSync(join(projectDir, TOKEN_CACHE_DIR), { recursive: true });
    writeFileSync(filePath, `${token}\n`, { mode: 0o600 });
  } catch {
    // Sem node_modules ainda, ou disco read-only: o token vale só para esta
    // execução. É exatamente o comportamento que a CLI tinha antes — degrada,
    // nunca quebra.
    return { token, source: "ephemeral" };
  }
  return { token, source: "created" };
}

/**
 * Sessão para o shim do Metro: porta + token viram um módulo JS bundlável,
 * resolvido pelo withNativeScope como "__rnsi_session__". `lan` avisa o shim
 * para descobrir o host pelo scriptURL do Metro (iPhone físico) em vez do
 * loopback.
 *
 * O arquivo é apagado no shutdown (ver removeSessionFile): deixá-lo para trás
 * fazia todo `expo start` posterior — sem a CLI rodando — embutir porta e token
 * de uma sessão morta, e o app abrir um ciclo de reconexão eterno contra uma
 * porta fechada. Ruído invisível, no device do usuário.
 */
export function writeSessionFile(
  projectDir: string,
  session: { port: number; token: string; lan: boolean },
): { path: string; content: string } | null {
  const path = join(projectDir, TOKEN_CACHE_DIR, "session.js");
  const content = `"use strict";\nmodule.exports = ${JSON.stringify(session)};\n`;
  try {
    mkdirSync(join(projectDir, TOKEN_CACHE_DIR), { recursive: true });
    writeFileSync(path, content);
    return { path, content };
  } catch {
    return null; // sem node_modules ainda: o shim vira no-op, nada quebra
  }
}

/**
 * Remove a sessão — mas só se o arquivo em disco ainda for exatamente o que
 * escrevemos. Duas CLIs no mesmo projeto (portas diferentes) não podem apagar
 * a sessão uma da outra ao sair.
 */
export function removeSessionFile(written: { path: string; content: string } | null): void {
  if (!written) return;
  try {
    if (readFileSync(written.path, "utf8") !== written.content) return;
    rmSync(written.path);
  } catch {
    /* já sumiu ou está inacessível: nada a fazer */
  }
}
