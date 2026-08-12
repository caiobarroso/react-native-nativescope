import { describe, expect, it } from "vitest";
import { HELP_TEXT } from "./help.ts";

describe("CLI help", () => {
  it("documents the public entrypoints and connection options", () => {
    expect(HELP_TEXT).toContain("nativescope init");
    expect(HELP_TEXT).toContain("--lan");
    expect(HELP_TEXT).toContain("--no-metro");
    expect(HELP_TEXT).toContain("https://nativescope.dev/docs");
  });

  // Quem lê só o --help precisa sair sabendo que a CLI sobe o Metro. Não saber
  // disso é o que leva a rodar `expo start` num segundo terminal.
  it("states that the CLI starts Metro, and what not to do", () => {
    expect(HELP_TEXT).toContain("npx expo start");
    expect(HELP_TEXT).toMatch(/Do not start Metro in\s+another terminal/);
  });
});
