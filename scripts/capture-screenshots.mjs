#!/usr/bin/env node
/**
 * Marketing/docs screenshot capture.
 *
 * Drives a real Studio against the fake runtime and writes every screenshot the
 * site and the launch material use. Doing this by hand is how the shots drifted
 * out of sync with the UI last time (they were still in Portuguese long after
 * the interface was translated), so it lives here as one reproducible command.
 *
 * Everything is automatic: the script starts its own `--fake` CLI session on a
 * dedicated port, captures, and shuts it down. Nothing else needs to be running.
 *
 * Usage:
 *   pnpm capture:screenshots                    # all shots
 *   pnpm capture:screenshots json-visual-light  # just one (repeatable)
 *
 * Requires apps/cli/dist/cli.mjs to be current — run `pnpm -r build` first if
 * you changed the Studio, otherwise you will screenshot a stale UI.
 *
 * Env:
 *   CHROME_PATH   override the browser binary
 *   PORT          override the port used for the throwaway session (default 4788)
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "apps/site/public/screenshots");
const CLI = resolve(ROOT, "apps/cli/dist/cli.mjs");
const PORT = Number(process.env.PORT ?? 4788);
const TOKEN = "screenshots";
const STUDIO = `http://127.0.0.1:${PORT}/?token=${TOKEN}`;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

const only = process.argv.slice(2);
const want = (name) => only.length === 0 || only.includes(name);

// ---------------------------------------------------------------- pré-flight

if (!existsSync(CLI)) {
  console.error(`✗ ${CLI} not found. Run \`pnpm -r build\` first.`);
  process.exit(2);
}

const chromePath = CHROME_CANDIDATES.find((path) => path && existsSync(path));
if (!chromePath) {
  console.error("✗ No Chrome/Chromium found. Set CHROME_PATH to the binary.");
  process.exit(2);
}

let chromium;
try {
  ({ chromium } = await import("playwright-core"));
} catch {
  console.error("✗ playwright-core is missing. Run `pnpm install` at the repo root.");
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });

// ------------------------------------------------------------------ sessão

/** Sobe uma sessão falsa e espera o servidor responder. */
async function startSession(extraArgs) {
  const child = spawn(
    process.execPath,
    [CLI, "--project", "apps/playground", "--fake", ...extraArgs,
     "--no-open", "--no-metro", "--port", String(PORT), "--token", TOKEN],
    { cwd: ROOT, stdio: "ignore" },
  );
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(STUDIO);
      if (res.ok) return child;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error("the fake session never came up");
}

const stopSession = (child) =>
  new Promise((done) => {
    child.once("exit", done);
    child.kill();
    setTimeout(done, 3000);
  });

const SITE = "http://127.0.0.1:4783";

/** Sobe a landing (o emulador desenhado mora nela) e espera compilar. */
async function startSite() {
  const child = spawn("pnpm", ["--filter", "@rnsi/site", "dev"], { cwd: ROOT, stdio: "ignore" });
  const deadline = Date.now() + 180_000; // next dev frio compila devagar
  while (Date.now() < deadline) {
    try {
      const res = await fetch(SITE);
      if (res.ok) return child;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  child.kill();
  throw new Error("the site never came up");
}

// ------------------------------------------------------------------ browser

const browser = await chromium.launch({ executablePath: chromePath, headless: true });
const page = await browser.newPage({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 2, // os arquivos saem 2560x1440; o site declara 1280x720
  colorScheme: "light",
});

const shot = async (name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(OUT, `${name}.png`) });
  console.log(`✓ ${name}.png`);
};

/** Volta a uma UI limpa sem perder o estado do storage. */
async function freshStudio() {
  await page.goto(STUDIO, { waitUntil: "networkidle" });
  await page.getByText("connected", { exact: true }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2500); // deixa a activity feed encher
}

/**
 * A primeira interação com uma instância key-value logo após o connect às vezes
 * não pega (race de hidratação no Studio); clicar de novo resolve.
 */
async function openInstance(label, nth = 0) {
  const item = page.getByRole("button", { name: label, exact: true }).nth(nth);
  await item.click();
  await page.waitForTimeout(900);
  const opened = await page
    .getByPlaceholder("Filter keys and values")
    .isVisible()
    .catch(() => false);
  if (!opened) {
    await item.click();
    await page.waitForTimeout(900);
  }
}

async function openTable(name) {
  await page.getByRole("button", { name: "proline.db", exact: true }).click();
  await page.waitForTimeout(1200);
  await page.getByText(name, { exact: true }).first().click();
  await page.waitForTimeout(2500);
}

// ------------------------------------------------------- 1. sessão padrão

const needsPlain = [
  "storage-live-light",
  "json-visual-light",
  "sql-console-light",
  "sql-console-dark",
  "snapshot-diff-light",
].some(want);

if (needsPlain) {
  const session = await startSession([]);
  try {
    if (want("storage-live-light")) {
      await freshStudio();
      await openInstance("default", 0);
      await shot("storage-live-light");
    }

    if (want("json-visual-light")) {
      await freshStudio();
      await openInstance("default", 0);
      await page.getByText("user.profile", { exact: true }).first().click();
      await page.waitForTimeout(1500);
      await shot("json-visual-light");
    }

    if (want("sql-console-light") || want("sql-console-dark")) {
      await freshStudio();
      await openTable("visits");
      await page.getByRole("button", { name: /^SQL/ }).first().click();
      await page.waitForTimeout(1200);
      await page.locator(".cm-content, textarea").first().click();
      await page.keyboard.type(
        "select pdv, count(*) as visits, sum(status = 'done') as done\n" +
          "from visits group by pdv order by visits desc;",
        { delay: 12 },
      );
      await page.keyboard.press("Escape"); // o autocomplete cobre o resultado
      await page.waitForTimeout(400);
      await page.keyboard.press("Meta+Enter");
      await page.waitForTimeout(2500);
      await page.keyboard.press("Escape");
      await page.mouse.move(1200, 300); // tira o hover das linhas
      await page.waitForTimeout(600);
      if (want("sql-console-light")) await shot("sql-console-light");
      if (want("sql-console-dark")) {
        await page.emulateMedia({ colorScheme: "dark" });
        await page.waitForTimeout(1200);
        await shot("sql-console-dark");
        await page.emulateMedia({ colorScheme: "light" });
      }
    }

    // Por último: este é o único que ESCREVE no storage falso, e o estado não
    // volta atrás dentro da mesma sessão.
    if (want("snapshot-diff-light")) {
      await freshStudio();
      const snapshots = page.getByRole("button", { name: "Snapshots" });
      await snapshots.click();
      await page.waitForTimeout(800);
      await page.getByRole("button", { name: "Capture baseline" }).click();
      await page.waitForTimeout(2500);
      await page.getByRole("button", { name: "Close" }).click();
      await page.waitForTimeout(600);

      // uma chave criada (linha verde)
      await openInstance("default", 1); // MMKV · default
      await page.getByRole("button", { name: "New key" }).click();
      await page.waitForTimeout(500);
      await page.getByPlaceholder("e.g. feature.newHome").fill("user.plan");
      await page.locator('input[type="text"]:not([placeholder])').first().fill("pro");
      await page.getByRole("button", { name: "Create", exact: true }).click();
      await page.waitForTimeout(1200);

      // uma chave removida (linha vermelha)
      await page.getByText("app.lastVersion", { exact: true }).first().click();
      await page.waitForTimeout(700);
      await page.getByRole("button", { name: "Remove", exact: true }).click();
      await page.waitForTimeout(1200);

      await page.waitForTimeout(5000); // o app falso gera os updates (coral)
      await snapshots.click();
      await page.waitForTimeout(700);
      await page.getByRole("button", { name: "Compare with now" }).click();
      await page.waitForTimeout(3000);
      await shot("snapshot-diff-light");
    }
  } finally {
    await stopSession(session);
  }
}

// -------------------------------------------------- 2. sessão em escala

if (want("sqlite-scale-light")) {
  const session = await startSession(["--fake-scale"]);
  try {
    await freshStudio();
    await openTable("events");
    await page.waitForTimeout(1500);
    await shot("sqlite-scale-light");
  } finally {
    await stopSession(session);
  }
}

// ------------------------------------ 3. o emulador desenhado da landing

/**
 * O celular do slide 3 é o AppEmulator da landing, não um mockup inventado:
 * ele usa os mesmos tokens e já traz bezel, notch e status bar. Sai com fundo
 * transparente para compor em qualquer arte — quem usar NÃO deve desenhar outra
 * moldura em volta.
 */
if (want("phone-app")) {
  const site = await startSite();
  // O celular tem 330px de CSS; num slide ele ocupa ~380px, então 3x dá folga.
  const phonePage = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 3,
    colorScheme: "light",
  });
  try {
    await phonePage.goto(SITE, { waitUntil: "networkidle" });
    const phone = phonePage.locator("[data-emu-phone]").first();
    await phone.waitFor({ timeout: 30_000 });
    await phone.scrollIntoViewIfNeeded();
    await phonePage.waitForTimeout(1500); // as animações de entrada assentam

    // Fundo transparente para o PNG compor sobre qualquer arte. O recorte é o
    // próprio elemento — recortar por caixa pegava a legenda vizinha.
    await phonePage.addStyleTag({
      content: "html,body{background:transparent !important}",
    });
    await phonePage.waitForTimeout(400);

    await phone.screenshot({ path: resolve(OUT, "phone-app.png"), omitBackground: true });
    console.log("✓ phone-app.png");
  } finally {
    await phonePage.close();
    await stopSession(site);
  }
}

// ------------------------------------------- 4. cartão do boot do CLI

if (want("cli-boot-light")) {
  await page.emulateMedia({ colorScheme: "light" });
  await page.setContent(bootCard());
  await page.waitForTimeout(600);
  await shot("cli-boot-light");
}

await browser.close();
console.log(`\ndone — ${OUT}`);

// -------------------------------------------------------------------------

/**
 * O boot real do CLI, redesenhado com os tokens da marca. Um print do terminal
 * de verdade traz a fonte e as cores do iTerm de quem rodou, que não são as
 * nossas — e ainda vaza avisos locais (adb, portas) que não interessam.
 */
function bootCard() {
  return `<!doctype html><meta charset="utf-8"><style>
  :root{--surface:#faf9f5;--raised:#fff;--sunken:#f0eee6;--border:#e5e2d9;
        --text:#1f1e1d;--muted:#6b6862;--subtle:#9a968c;--accent:#d97757;--created:#5c8a5c;
        --mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,monospace}
  *{box-sizing:border-box;margin:0}
  body{width:1280px;height:720px;display:grid;place-items:center;background:var(--surface);
       font-family:var(--mono);-webkit-font-smoothing:antialiased}
  .w{width:880px;background:var(--raised);border:1px solid var(--border);border-radius:12px;
     overflow:hidden;box-shadow:0 24px 60px -20px rgba(31,30,29,.18),0 2px 6px rgba(31,30,29,.04)}
  .bar{display:flex;align-items:center;gap:7px;padding:13px 16px;background:var(--sunken);
       border-bottom:1px solid var(--border)}
  .bar i{width:11px;height:11px;border-radius:50%;background:#d6d2c6}
  .bar strong{margin-left:10px;font-size:12px;font-weight:500;color:var(--subtle)}
  pre{padding:26px 30px 30px;font-size:15px;line-height:1.95;color:var(--text)}
  .p{color:var(--accent)}.c{color:var(--created)}.m{color:var(--muted)}.b{font-weight:600}
  </style>
  <div class="w"><div class="bar"><i></i><i></i><i></i><strong>my-app — nativescope</strong></div>
<pre><span class="p">$</span> npx nativescope

<span class="b">NativeScope</span>

<span class="m">Project:</span> my-app
<span class="m">Detected in package.json:</span>
  <span class="c">✓</span> AsyncStorage
  <span class="c">✓</span> MMKV
  <span class="c">✓</span> SQLite

<span class="m">Local service:</span> ws://127.0.0.1:4782
<span class="m">Studio:</span>        http://127.0.0.1:4782

<span class="c">app connected:</span> my-app <span class="m">(ios)</span></pre></div>`;
}
