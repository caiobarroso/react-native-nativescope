import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  findFreeMetroPort,
  METRO_DEFAULT_PORT,
  isPortInUse,
  resolveMetroPort,
} from "./metro-port.ts";

const servers: Server[] = [];
let envDir: string;

function listen(host = "127.0.0.1"): Promise<number> {
  return new Promise((resolve, reject) => {
    const created = createServer();
    created.once("error", reject);
    created.listen(0, host, () => {
      servers.push(created);
      const address = created.address();
      if (address && typeof address === "object") resolve(address.port);
      else reject(new Error("no port"));
    });
  });
}

beforeAll(() => {
  envDir = mkdtempSync(join(tmpdir(), "nativescope-metro-"));
});

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          if (!server.listening) return resolve();
          server.close(() => resolve());
        }),
    ),
  );
  for (const file of [
    ".env",
    ".env.development",
    ".env.development.local",
    ".env.test",
    ".env.test.local",
    ".env.local",
  ]) {
    rmSync(join(envDir, file), { force: true });
  }
});

afterAll(() => {
  rmSync(envDir, { recursive: true, force: true });
});

describe("resolveMetroPort", () => {
  it("usa 8081 quando nada está configurado", () => {
    expect(resolveMetroPort(envDir, {})).toBe(METRO_DEFAULT_PORT);
  });

  it("respeita RCT_METRO_PORT", () => {
    expect(resolveMetroPort(envDir, { RCT_METRO_PORT: "9000" })).toBe(9000);
  });

  it("lê RCT_METRO_PORT dos arquivos dotenv do projeto", () => {
    writeFileSync(join(envDir, ".env"), 'RCT_METRO_PORT="9123" # Metro\n');
    expect(resolveMetroPort(envDir, {})).toBe(9123);
  });

  it("respeita a precedência do arquivo de ambiente de desenvolvimento", () => {
    writeFileSync(join(envDir, ".env.development"), "RCT_METRO_PORT=9124\n");
    writeFileSync(
      join(envDir, ".env.development.local"),
      "RCT_METRO_PORT=9125\n",
    );
    expect(resolveMetroPort(envDir, { NODE_ENV: "development" })).toBe(9125);
  });

  it("não usa .env.local no modo de teste, como o Expo", () => {
    writeFileSync(join(envDir, ".env.local"), "RCT_METRO_PORT=9127\n");
    writeFileSync(join(envDir, ".env.test"), "RCT_METRO_PORT=9128\n");
    expect(resolveMetroPort(envDir, { NODE_ENV: "test" })).toBe(9128);
  });

  // EXPO_PACKAGER_PORT é do expo-cli clássico e o @expo/cli atual ignora.
  // Respeitá-la nos faria sondar 9100 enquanto o Expo sobe na 8081 — ou seja,
  // a checagem deixaria de refletir a porta que o Expo vai usar.
  it("ignora EXPO_PACKAGER_PORT, que o Expo atual não lê", () => {
    expect(resolveMetroPort(envDir, { EXPO_PACKAGER_PORT: "9100" })).toBe(
      METRO_DEFAULT_PORT,
    );
  });

  it("não lê dotenv quando Expo desabilita dotenv", () => {
    writeFileSync(join(envDir, ".env"), "RCT_METRO_PORT=9126\n");
    expect(resolveMetroPort(envDir, { EXPO_NO_DOTENV: "1" })).toBe(
      METRO_DEFAULT_PORT,
    );
  });

  // Valor lixo virando NaN faria a checagem de porta consultar um alvo inválido
  // e concluir "livre" — a CLI perderia a chance de alinhar o Metro explícito.
  it("cai no padrão para valores inválidos", () => {
    for (const raw of ["", "   ", "abc", "0", "-1", "70000", "8081.5"]) {
      expect(resolveMetroPort(envDir, { RCT_METRO_PORT: raw })).toBe(
        METRO_DEFAULT_PORT,
      );
    }
  });
});

describe("isPortInUse", () => {
  it("detecta uma porta ocupada", async () => {
    const port = await listen();
    expect(await isPortInUse(port)).toBe(true);
  });

  it("reporta livre quando ninguém escuta", async () => {
    const port = await listen();
    const server = servers.pop();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    expect(await isPortInUse(port)).toBe(false);
  });

  it("detecta um listener IPv6 no loopback", async () => {
    const port = await listen("::1");
    expect(await isPortInUse(port)).toBe(true);
  });

  // Na dúvida a CLI sobe o Metro: um timeout não pode virar "ocupada" e barrar
  // um projeto que estava saudável.
  it("trata timeout como livre", async () => {
    expect(await isPortInUse(9, { host: "10.255.255.1", timeoutMs: 50 })).toBe(
      false,
    );
  });
});

describe("findFreeMetroPort", () => {
  it("avança quando a porta preferida está ocupada", async () => {
    const probe = async (port: number) => port < 8083;
    expect(await findFreeMetroPort(8081, { probe })).toBe(8083);
  });

  it("retorna null quando o intervalo está esgotado", async () => {
    const probe = async () => true;
    expect(await findFreeMetroPort(8081, { maxAttempts: 2, probe })).toBeNull();
  });
});
