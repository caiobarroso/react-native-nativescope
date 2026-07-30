import Image from "next/image";
import Link from "next/link";
import { Code2, ExternalLink, Info, Layers, MousePointer2, Search, Undo2 } from "lucide-react";
import { BrandLogo } from "@/components/site/BrandLogo";
import { highlightCode } from "@/lib/highlight";
import { pageMetadata, techArticleSchema, breadcrumbSchema } from "@/lib/seo";
import { JsonLd } from "@/components/seo/JsonLd";

const PAGE = {
  title: "NativeScope vs Rozenite storage plugins",
  description:
    "A factual comparison of setup, scope, and day-to-day storage debugging experience.",
  path: "/compare/rozenite",
  published: "2026-07-21",
  modified: "2026-07-23",
};

export const metadata = pageMetadata({
  title: PAGE.title,
  description: PAGE.description,
  path: PAGE.path,
  type: "article",
  publishedTime: PAGE.published,
  modifiedTime: PAGE.modified,
});

const rows = [
  {
    label: "Product model",
    native: "A local React Native debugging environment. Storage is the first module.",
    rozenite: "A DevTools plugin platform with official plugins across several debugging areas.",
  },
  {
    label: "Attachment style",
    native:
      "Starts Metro with a resolver attached, then discovers storage that the app already uses.",
    rozenite: "Mounts plugin hooks and adapters that the app registers explicitly.",
  },
  {
    label: "Storage coverage",
    native: "AsyncStorage, MMKV, expo-sqlite and op-sqlite in one package today.",
    rozenite: "Storage plugin covers key-value stores; SQLite uses its own plugin.",
  },
  {
    label: "Configuration philosophy",
    native:
      "One root config declares the modules to enable; storage instances still discover themselves, with no adapter or registry to maintain.",
    rozenite: "Explicit registration makes the supported surface visible in your app code.",
  },
  {
    label: "Experience focus",
    native:
      "Large payload browsing, visual JSON editing, SQLite table work, snapshots, diff and restore.",
    rozenite: "Composable DevTools panels that fit a wider plugin ecosystem.",
  },
  {
    label: "Best fit",
    native: "Teams that want storage debugging to feel automatic, local, and low-friction.",
    rozenite: "Teams that prefer assembling a broader DevTools room from explicit plugins.",
  },
];

const nativeScopeSetup = {
  install: `pnpm add -D react-native-nativescope
pnpm nativescope`,
  config: `// nativescope.config.ts
import { defineNativeScopeConfig } from "react-native-nativescope/app"

export default defineNativeScopeConfig({
  modules: {
    storage: {
      reactQuery: true,
      indicator: true,
    },
  },
})`,
};

const rozeniteSetup = {
  install: `pnpm add -D @rozenite/storage-plugin @rozenite/sqlite-plugin`,
  config: `const storages = [
  createMMKVStorageAdapter({ storages }),
  createAsyncStorageAdapter({ storage }),
]

const adapters = [
  createExpoSqliteAdapter({ databases }),
]

useRozeniteStoragePlugin({ storages })
useRozeniteSqlitePlugin({ adapters })`,
};

function NativeScopeLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span data-compare-brand="nativescope" data-compare-logo={compact ? "compact" : "card"}>
      <BrandLogo />
    </span>
  );
}

function RozeniteLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span data-compare-brand="rozenite" data-compare-logo={compact ? "compact" : "card"}>
      <Image
        src="/brand/rozenite-logo-light.svg"
        alt=""
        width={173}
        height={32}
        data-rozenite-logo-light
      />
      <Image
        src="/brand/rozenite-logo-dark.svg"
        alt=""
        width={173}
        height={32}
        data-rozenite-logo-dark
      />
    </span>
  );
}

async function CodePanel({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "command";
}) {
  const html = await highlightCode(value, tone === "command" ? "bash" : "typescript");

  return (
    <div data-code-panel data-code-tone={tone}>
      <span>
        <Code2 size={14} aria-hidden />
        {label}
      </span>
      <div data-highlighted-code dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

export default function CompareRozenitePage() {
  return (
    <div data-compare-page>
      <JsonLd
        data={techArticleSchema({
          title: PAGE.title,
          description: PAGE.description,
          path: PAGE.path,
          published: PAGE.published,
          modified: PAGE.modified,
        })}
      />
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "Compare", path: "/compare/rozenite" },
        ])}
      />
      <header data-page-lead>
        <p>Technical comparison</p>
        <div data-compare-brands aria-label="NativeScope versus Rozenite">
          <span data-compare-brand="nativescope">
            <BrandLogo priority />
          </span>
          <span data-compare-versus aria-hidden="true">
            versus
          </span>
          <span data-compare-brand="rozenite">
            <Image
              src="/brand/rozenite-logo-light.svg"
              alt=""
              width={173}
              height={32}
              priority
              data-rozenite-logo-light
            />
            <Image
              src="/brand/rozenite-logo-dark.svg"
              alt=""
              width={173}
              height={32}
              priority
              data-rozenite-logo-dark
            />
          </span>
        </div>
        <h1>
          NativeScope and Rozenite,
          <br />
          compared by trade-offs.
        </h1>
        <span>
          This page is not a verdict. Both tools can help React Native teams debug storage. The
          useful question is which attachment model, product scope and day-to-day workflow you want.
        </span>
      </header>

      <aside data-comparison-note>
        <Info size={17} aria-hidden />
        <p>
          <strong>A correction to our original research:</strong> Rozenite now has a generic Storage
          plugin that combines MMKV, AsyncStorage and SecureStore. Its standalone MMKV plugin is
          marked for deprecation. For NativeScope&apos;s current storage surface, the fair
          comparison is one NativeScope package versus Rozenite Storage + SQLite.
        </p>
      </aside>

      <section data-compare-table aria-labelledby="comparison-heading">
        <div data-compare-head>
          <span id="comparison-heading">Comparison point</span>
          <div data-compare-mobile-brands aria-hidden="true">
            <NativeScopeLogo compact />
            <span>vs</span>
            <RozeniteLogo compact />
          </div>
          <strong aria-label="NativeScope">
            <NativeScopeLogo compact />
          </strong>
          <strong aria-label="Rozenite">
            <RozeniteLogo compact />
          </strong>
        </div>
        {rows.map((row) => (
          <div data-compare-row key={row.label}>
            <span>{row.label}</span>
            <p data-compare-cell="NativeScope">{row.native}</p>
            <p data-compare-cell="Rozenite">{row.rozenite}</p>
          </div>
        ))}
      </section>

      <section data-compare-experience>
        <header>
          <p data-section-kicker>Using the tool</p>
          <h2>The biggest difference is the storage workspace itself.</h2>
          <span>
            NativeScope&apos;s first module is shaped around the moments where storage debugging
            usually gets slow: finding the key, opening nested JSON, changing one field, comparing
            what changed and restoring safely.
          </span>
        </header>
        <div data-experience-grid>
          <article>
            <Search size={18} aria-hidden />
            <h3>Find the right value</h3>
            <p>
              Search across keys, values, SQLite tables and nested JSON fields from one local
              Studio.
            </p>
          </article>
          <article>
            <MousePointer2 size={18} aria-hidden />
            <h3>Edit visually</h3>
            <p>
              Open large JSON arrays as tables, edit cells inline, add rows through drawers and keep
              types visible.
            </p>
          </article>
          <article>
            <Layers size={18} aria-hidden />
            <h3>Work with real tables</h3>
            <p>
              SQLite gets tabs, selectable rows, sortable columns, resizable cells and direct SQL
              when needed.
            </p>
          </article>
          <article>
            <Undo2 size={18} aria-hidden />
            <h3>Diff and restore</h3>
            <p>
              Capture a baseline, act in the app, inspect changed fields and restore the exact
              value.
            </p>
          </article>
        </div>
      </section>

      <section data-config-compare>
        <header>
          <p data-section-kicker>Setup shape</p>
          <h2>Commands and app code are different concerns.</h2>
          <span>
            The install command tells you what enters the project. The code block tells you what the
            app has to know about the tool.
          </span>
        </header>
        <div>
          <article>
            <NativeScopeLogo />
            <CodePanel label="Command" value={nativeScopeSetup.install} tone="command" />
            <CodePanel label="Root config" value={nativeScopeSetup.config} />
            <small>
              NativeScope discovers storage instances without a provider, hook, adapter or instance
              registry. You enable modules in the root config, which is also where app-side behavior
              lives, such as React Query invalidation or the in-app indicator.
            </small>
          </article>
          <article>
            <RozeniteLogo />
            <CodePanel label="Command" value={rozeniteSetup.install} tone="command" />
            <CodePanel label="App registration" value={rozeniteSetup.config} />
            <small>
              Explicit registration gives the app direct control over the plugin surface.
            </small>
          </article>
        </div>
      </section>

      <section data-when-to-choose>
        <article>
          <p data-section-kicker>Choose NativeScope when</p>
          <h2>You want storage debugging to disappear into one command.</h2>
          <p className="mt-3">
            You want a local Studio that discovers what it can, stays out of release builds and
            makes large storage payloads editable. Storage ships first; the longer-term NativeScope
            goal is a modular React Native debugging environment with the same low-friction setup.
          </p>
        </article>
        <article>
          <p data-section-kicker>Choose Rozenite when</p>
          <h2>You want an explicit plugin platform.</h2>
          <p className="mt-3">
            You prefer a broader DevTools ecosystem where each capability is registered in app code.
            That model can be a better fit when your team values explicit composition across many
            debugging surfaces.
          </p>
        </article>
      </section>

      <footer data-comparison-sources>
        <p>
          Sources reviewed July 20, 2026. Product docs change; these links are the source of truth.
        </p>
        <a
          href="https://www.rozenite.dev/docs/official-plugins/mmkv"
          target="_blank"
          rel="noreferrer noopener"
        >
          MMKV plugin <ExternalLink size={13} aria-hidden />
        </a>
        <a
          href="https://www.rozenite.dev/docs/official-plugins/storage"
          target="_blank"
          rel="noreferrer noopener"
        >
          Storage plugin <ExternalLink size={13} aria-hidden />
        </a>
        <a
          href="https://www.rozenite.dev/docs/official-plugins/sqlite"
          target="_blank"
          rel="noreferrer noopener"
        >
          SQLite plugin <ExternalLink size={13} aria-hidden />
        </a>
        <Link href="/docs/storage/quickstart">Read the NativeScope quickstart</Link>
      </footer>
    </div>
  );
}
