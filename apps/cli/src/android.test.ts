import { describe, expect, it } from "vitest";
import { parseDevices } from "./android.ts";

describe("parseDevices", () => {
  it("extrai seriais prontos, ignorando cabeçalho e vazios", () => {
    const out = `List of devices attached\nemulator-5554\tdevice\nRF8M33XXXXX\tdevice\n\n`;
    expect(parseDevices(out)).toEqual({
      ready: ["emulator-5554", "RF8M33XXXXX"],
      unauthorized: [],
    });
  });

  it("separa devices não autorizados (depuração USB pendente)", () => {
    const out = `List of devices attached\nRF8M33XXXXX\tunauthorized\n`;
    expect(parseDevices(out)).toEqual({ ready: [], unauthorized: ["RF8M33XXXXX"] });
  });

  it("ignora offline e lida com saída vazia", () => {
    expect(parseDevices("List of devices attached\nX\toffline\n")).toEqual({
      ready: [],
      unauthorized: [],
    });
    expect(parseDevices("")).toEqual({ ready: [], unauthorized: [] });
  });
});
