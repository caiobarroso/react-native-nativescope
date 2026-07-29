import { describe, expect, it } from "vitest";
import { HELP_TEXT } from "./help.ts";

describe("CLI help", () => {
  it("documents the public entrypoints and connection options", () => {
    expect(HELP_TEXT).toContain("nativescope init");
    expect(HELP_TEXT).toContain("--lan");
    expect(HELP_TEXT).toContain("--no-metro");
    expect(HELP_TEXT).toContain("https://nativescope.dev/docs");
  });
});
