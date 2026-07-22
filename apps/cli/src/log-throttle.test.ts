import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createThrottledLogger } from "./log-throttle.ts";

describe("log agregado por janela", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a primeira linha sai na hora e as repetições viram um resumo", () => {
    const lines: string[] = [];
    const logger = createThrottledLogger((line) => lines.push(line), 1000);

    logger.log("k", "handshake rejected");
    expect(lines).toEqual(["handshake rejected"]);

    for (let i = 0; i < 200; i += 1) logger.log("k", "handshake rejected");
    expect(lines).toHaveLength(1); // 200 repetições, nenhuma linha nova

    vi.advanceTimersByTime(1000);
    expect(lines).toEqual([
      "handshake rejected",
      "handshake rejected (+200 more in the last 1s)",
    ]);
  });

  it("garante no máximo uma linha por janela mesmo com tráfego infinito", () => {
    const lines: string[] = [];
    const logger = createThrottledLogger((line) => lines.push(line), 1000);

    // 10 janelas de tráfego contínuo: 1 linha inicial + 1 resumo por janela.
    for (let window = 0; window < 10; window += 1) {
      for (let i = 0; i < 50; i += 1) logger.log("k", "noise");
      vi.advanceTimersByTime(1000);
    }
    expect(lines).toHaveLength(11);
  });

  it("cala de vez quando o assunto morre, e volta a logar na hora depois", () => {
    const lines: string[] = [];
    const logger = createThrottledLogger((line) => lines.push(line), 1000);

    logger.log("k", "primeira");
    vi.advanceTimersByTime(5000); // janela fecha sem repetições
    expect(lines).toHaveLength(1);

    // Assunto novo depois do silêncio: merece saída imediata outra vez.
    logger.log("k", "segunda");
    expect(lines).toEqual(["primeira", "segunda"]);
  });

  it("keys distintas não se misturam", () => {
    const lines: string[] = [];
    const logger = createThrottledLogger((line) => lines.push(line), 1000);

    logger.log("a", "origem A");
    logger.log("b", "origem B");
    logger.log("a", "origem A");
    expect(lines).toEqual(["origem A", "origem B"]);

    vi.advanceTimersByTime(1000);
    expect(lines).toEqual(["origem A", "origem B", "origem A (+1 more in the last 1s)"]);
  });

  it("stop() não deixa timer pendente", () => {
    const lines: string[] = [];
    const logger = createThrottledLogger((line) => lines.push(line), 1000);

    logger.log("k", "linha");
    logger.log("k", "linha");
    logger.stop();

    vi.advanceTimersByTime(10_000);
    expect(lines).toHaveLength(1); // o resumo pendente foi cancelado junto
    expect(vi.getTimerCount()).toBe(0);
  });
});
