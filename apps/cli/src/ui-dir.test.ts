import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { findUiDir } from "./ui-dir.ts";

describe("published Studio UI", () => {
  it("finds dist/ui beside the bundled dist/cli.mjs entrypoint", async () => {
    const root = await mkdtemp(join(tmpdir(), "nativescope-ui-"));
    const uiDir = join(root, "dist", "ui");
    await mkdir(uiDir, { recursive: true });
    await writeFile(join(uiDir, "index.html"), "<main>NativeScope</main>");

    const moduleUrl = pathToFileURL(join(root, "dist", "cli.mjs")).href;
    expect(findUiDir(moduleUrl, undefined)).toBe(uiDir);
  });
});
