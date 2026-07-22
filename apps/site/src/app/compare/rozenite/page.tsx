import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Check, ExternalLink, Info } from "lucide-react";
import { BrandLogo } from "@/components/site/BrandLogo";

export const metadata: Metadata = {
  title: "NativeScope vs Rozenite storage plugins",
  description: "A factual comparison of setup and scope for React Native storage inspection.",
};

const rows = [
  {
    label: "Install for MMKV + AsyncStorage + SQLite",
    native: "One dev dependency",
    rozenite: "Storage plugin + SQLite plugin",
  },
  {
    label: "App-level setup",
    native: "None for discovery; optional config for cache sync",
    rozenite: "Create adapters and mount plugin hooks",
  },
  {
    label: "MMKV instances",
    native: "Observed when constructed",
    rozenite: "Passed explicitly as an id-to-instance record",
  },
  {
    label: "AsyncStorage",
    native: "Detected from the existing import",
    rozenite: "Passed to createAsyncStorageAdapter",
  },
  {
    label: "SQLite databases",
    native: "Observed when opened with expo-sqlite",
    rozenite: "Registered in createExpoSqliteAdapter",
  },
  {
    label: "Product shape",
    native: "One local DevTools environment, storage module first",
    rozenite: "DevTools plugin platform with a broader plugin ecosystem",
  },
];

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
      <Image src="/brand/rozenite-logo-light.svg" alt="" width={173} height={32} data-rozenite-logo-light />
      <Image src="/brand/rozenite-logo-dark.svg" alt="" width={173} height={32} data-rozenite-logo-dark />
    </span>
  );
}

export default function CompareRozenitePage() {
  return (
    <div data-compare-page>
      <header data-page-lead>
        <p>Technical comparison</p>
        <div data-compare-brands aria-label="NativeScope versus Rozenite">
          <span data-compare-brand="nativescope">
            <BrandLogo priority />
          </span>
          <span data-compare-versus aria-hidden="true">versus</span>
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
        <h1>NativeScope and Rozenite,<br />without the marketing fog.</h1>
        <span>
          Both can inspect React Native storage. The meaningful difference is how the capability
          attaches to your app, and how broad you need the surrounding DevTools platform to be.
        </span>
      </header>

      <aside data-comparison-note>
        <Info size={17} aria-hidden />
        <p>
          <strong>A correction to our original research:</strong> Rozenite now has a generic Storage
          plugin that combines MMKV, AsyncStorage and SecureStore. Its standalone MMKV plugin is
          marked for deprecation. For all three NativeScope providers, the current fair comparison is
          one NativeScope package versus Rozenite Storage + SQLite — not three separate plugins.
        </p>
      </aside>

      <section data-compare-table aria-labelledby="comparison-heading">
        <div data-compare-head>
          <span id="comparison-heading">Integration surface</span>
          <strong aria-label="NativeScope"><NativeScopeLogo compact /></strong>
          <strong aria-label="Rozenite"><RozeniteLogo compact /></strong>
        </div>
        {rows.map((row) => (
          <div data-compare-row key={row.label}>
            <span>{row.label}</span>
            <p><Check size={15} aria-hidden />{row.native}</p>
            <p>{row.rozenite}</p>
          </div>
        ))}
      </section>

      <section data-config-compare>
        <header>
          <p data-section-kicker>What setup looks like</p>
          <h2>Same storage coverage. Different attachment points.</h2>
        </header>
        <div>
          <article>
            <NativeScopeLogo />
            <pre><code>{`pnpm add -D react-native-nativescope
pnpm nativescope

# optional: keep React Query screens in sync
// nativescope.config.ts
import { defineNativeScopeConfig } from
  "react-native-nativescope/app"

export default defineNativeScopeConfig({
  modules: { storage: { reactQuery: true } }
})`}</code></pre>
            <small>
              No provider, hook, adapter or instance registry. The root config is only for
              app-side behavior such as cache invalidation.
            </small>
          </article>
          <article>
            <RozeniteLogo />
            <pre><code>{`pnpm add -D \
  @rozenite/storage-plugin \
  @rozenite/sqlite-plugin

const storages = [
  createMMKVStorageAdapter({ storages }),
  createAsyncStorageAdapter({ storage })
]

const adapters = [
  createExpoSqliteAdapter({ databases })
]

useRozeniteStoragePlugin({ storages })
useRozeniteSqlitePlugin({ adapters })`}</code></pre>
            <small>Explicit registration gives the app direct control over the plugin surface.</small>
          </article>
        </div>
      </section>

      <section data-when-to-choose>
        <article>
          <p data-section-kicker>Choose NativeScope when</p>
          <h2>You want the quiet debugger that keeps expanding.</h2>
          <p className="mt-3">
            You want one local command, no account, no cloud, no ceremony. Storage is the first
            module because it was the sharpest daily pain; the product direction is a complete
            React Native debugging room where new modules appear without new setup rituals.
          </p>
        </article>
        <article>
          <p data-section-kicker>Choose Rozenite when</p>
          <h2>You want to assemble the room yourself.</h2>
          <p className="mt-3">
            You prefer a broad DevTools platform where each capability is registered explicitly.
            That model gives teams direct control over storage, navigation, network, Redux,
            performance, forms and agent tools inside the same plugin ecosystem.
          </p>
        </article>
      </section>

      <footer data-comparison-sources>
        <p>Sources reviewed July 20, 2026. Product docs change; these links are the source of truth.</p>
        <a href="https://www.rozenite.dev/docs/official-plugins/mmkv" target="_blank" rel="noreferrer noopener">MMKV plugin <ExternalLink size={13} aria-hidden /></a>
        <a href="https://www.rozenite.dev/docs/official-plugins/storage" target="_blank" rel="noreferrer noopener">Storage plugin <ExternalLink size={13} aria-hidden /></a>
        <a href="https://www.rozenite.dev/docs/official-plugins/sqlite" target="_blank" rel="noreferrer noopener">SQLite plugin <ExternalLink size={13} aria-hidden /></a>
        <Link href="/docs/quickstart">Read the NativeScope quickstart</Link>
      </footer>
    </div>
  );
}
