import { access, cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const source = resolve(scriptsDir, "../../desktop/dist");
const target = resolve(scriptsDir, "../dist/ui");

await access(resolve(source, "index.html"));
await rm(target, { force: true, recursive: true });
await mkdir(dirname(target), { recursive: true });
await cp(source, target, { recursive: true });
