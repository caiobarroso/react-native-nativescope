import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runInit } from "./init.ts";
import { resolveEnabledModules } from "./modules-cli.ts";

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
});

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), "rnsi-init-"));
}

describe("nativescope init", () => {
  it("gera nativescope.config.js com storage ligado (--yes / não-TTY)", async () => {
    const dir = tmpProject();
    try {
      await runInit(dir, { force: false, yes: true });
      const configPath = join(dir, "nativescope.config.js");
      expect(existsSync(configPath)).toBe(true);
      const content = readFileSync(configPath, "utf8");
      expect(content).toContain("storage: true,");
      expect(content).toContain("module.exports");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("não sobrescreve config existente sem --force; sobrescreve com --force", async () => {
    const dir = tmpProject();
    const configPath = join(dir, "nativescope.config.js");
    try {
      await runInit(dir, { force: false, yes: true });
      writeFileSync(configPath, readFileSync(configPath, "utf8") + "\n// touched\n");

      await runInit(dir, { force: false, yes: true });
      expect(readFileSync(configPath, "utf8")).toContain("// touched");

      await runInit(dir, { force: true, yes: true });
      expect(readFileSync(configPath, "utf8")).not.toContain("// touched");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("round-trip: o config gerado resolve para storage ligado (source config)", async () => {
    const dir = tmpProject();
    try {
      await runInit(dir, { force: false, yes: true });
      const result = resolveEnabledModules(dir);
      expect(result.source).toBe("config");
      expect(result.enabled.storage).toBe(true);
      expect(result.configPath).toContain("nativescope.config.js");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
