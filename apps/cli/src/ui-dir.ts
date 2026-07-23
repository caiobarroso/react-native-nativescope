import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function findUiDir(
  moduleUrl: string = import.meta.url,
  override: string | undefined = process.env["RNSI_UI_DIR"],
): string | null {
  if (override && existsSync(override)) return resolve(override);

  const here = dirname(fileURLToPath(moduleUrl));
  const candidates = [
    join(here, "..", "..", "desktop", "dist"), // monorepo, running from src/
    join(here, "..", "..", "..", "desktop", "dist"), // monorepo, running from dist/
    join(here, "ui"), // published package: dist/cli.mjs beside dist/ui/
    join(here, "..", "ui"), // compatibility with older layouts
  ];

  for (const candidate of candidates) {
    if (existsSync(join(candidate, "index.html"))) return resolve(candidate);
  }
  return null;
}
