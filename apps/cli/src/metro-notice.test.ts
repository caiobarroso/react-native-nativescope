import { describe, expect, it } from "vitest";
import {
  NOTE_PREFIX,
  manualConfigLines,
  metroExitLines,
  metroPortChangedLines,
  metroPortUnavailableLines,
  metroStartFailureLines,
  noMetroLines,
  noSessionLines,
  prefixedLines,
  separator,
  startingMetroLines,
  toolLabel,
  unknownProjectLines,
} from "./metro-notice.ts";
import { metroCommand } from "./metro-config.ts";

const expo = metroCommand("expo", 8081).display;
const bare = metroCommand("react-native", 8081).display;

function text(lines: string[]): string {
  return lines.join("\n");
}

describe("comando impresso", () => {
  it("é exatamente o que a CLI executa", () => {
    expect(metroCommand("expo").display).toBe("npx expo start");
    expect(metroCommand("react-native").display).toBe("npx react-native start");
    expect(expo).toBe("npx expo start --port 8081");
    expect(bare).toBe("npx react-native start --port 8081");
  });

  it("nomeia o dono do terminal pelo nome que o usuário conhece", () => {
    expect(toolLabel("expo")).toBe("Expo");
    expect(toolLabel("react-native")).toBe("React Native CLI");
  });
});

describe("startingMetroLines", () => {
  const lines = startingMetroLines(expo, toolLabel("expo"));

  it("diz que somos nós subindo o Metro, e com qual comando", () => {
    expect(text(lines)).toContain("NativeScope is starting Metro for you");
    expect(text(lines)).toContain(expo);
  });

  it("explica que o processo filho já está alinhado", () => {
    expect(text(lines)).toContain("same instrumented bundler");
    expect(text(lines)).toContain("Do not start another Metro");
    expect(text(lines)).toContain("--no-metro");
  });

  it("entrega a autoria da saída de baixo ao bundler", () => {
    expect(text(lines)).toContain("comes from Expo");
    expect(text(lines)).toContain("interactive keys");
    expect(text(lines)).toContain(NOTE_PREFIX);
  });
});

describe("mensagens de seleção de porta", () => {
  it("explica quando escolhemos a próxima porta livre", () => {
    const lines = metroPortChangedLines(
      8081,
      8082,
      "npx expo start --port 8082",
    );
    expect(text(lines)).toContain("Port 8081 is already in use");
    expect(text(lines)).toContain("port 8082");
    expect(text(lines)).toContain("npx expo start --port 8082");
  });

  it("dá uma saída quando não há porta disponível", () => {
    const lines = metroPortUnavailableLines(8081, expo);
    expect(text(lines)).toContain("could not find a free Metro port");
    expect(text(lines)).toContain(expo);
  });
});

describe("as demais recusas e falhas dizem o que fazer", () => {
  it("--no-metro", () => {
    expect(text(noMetroLines(expo))).toContain("--no-metro");
    expect(text(noMetroLines(expo))).toContain(expo);
    expect(text(noMetroLines(expo))).toContain("Keep this process running");
  });

  it("sessão não gravada", () => {
    expect(text(noSessionLines())).toContain("session.js");
    expect(text(noSessionLines())).toContain("writable");
  });

  it("config que precisa de passo manual preserva o motivo original", () => {
    const reason =
      "metro.config.ts detected. Wrap it manually:\n  const x = 1;";
    const lines = manualConfigLines(reason, expo);
    expect(text(lines)).toContain("metro.config.ts detected");
    expect(text(lines)).toContain("const x = 1;");
    expect(text(lines)).toContain(expo);
  });

  it("projeto sem expo nem react-native", () => {
    expect(text(unknownProjectLines())).toContain("--project");
  });

  it("Metro que saiu com erro aponta para o comando e o status", () => {
    expect(text(metroExitLines(expo, 1, null))).toContain("code 1");
    expect(text(metroExitLines(expo, 1, null))).toContain(expo);
  });

  it("falha de spawn preserva o erro original", () => {
    expect(text(metroStartFailureLines(expo, "ENOENT"))).toContain("ENOENT");
    expect(text(metroStartFailureLines(expo, "ENOENT"))).toContain(expo);
  });
});

describe("prefixos", () => {
  it("prefixa cada linha de uma mensagem multilinha", () => {
    expect(prefixedLines("first\nsecond")).toEqual([
      `${NOTE_PREFIX} first`,
      `${NOTE_PREFIX} second`,
    ]);
  });
});

describe("separator", () => {
  it("cabe na largura pedida e carrega o comando", () => {
    const line = separator(expo, 80);
    expect(line).toHaveLength(80);
    expect(line).toContain(expo);
    expect(line).toMatch(/^[\x00-\x7F]+$/);
  });

  it("não estoura em terminais estreitos", () => {
    expect(separator(expo, 10).length).toBeLessThanOrEqual(expo.length + 8);
  });
});
