import Image from "next/image";
import Link from "next/link";
import { Braces, Code2, ExternalLink, GitCompareArrows, History, Info, Search } from "lucide-react";
import { JsonLd } from "@/components/seo/JsonLd";
import { BrandLogo } from "@/components/site/BrandLogo";
import { highlightCode } from "@/lib/highlight";
import { breadcrumbSchema, pageMetadata, techArticleSchema } from "@/lib/seo";

const PAGE = {
  title: "NativeScope Network vs Reactotron",
  description:
    "A factual comparison of React Native network capture, inspection, replay, setup and debugging scope.",
  path: "/compare/reactotron",
  published: "2026-07-28",
  modified: "2026-07-28",
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
    label: "Product scope",
    native:
      "A modular local React Native debugging environment. Network is a dedicated workspace beside Storage.",
    reactotron:
      "An established general-purpose React and React Native debugger. Networking is one capability among state, logs, errors, performance, overlays, commands and plugins.",
  },
  {
    label: "Capture surface",
    native:
      "Instruments global fetch and XMLHttpRequest, including native fetch implementations that do not pass through XHR.",
    reactotron:
      "The official networking plugin documents XMLHttpRequest tracking. Apisauce uses a separate monitor integration.",
  },
  {
    label: "Attachment style",
    native:
      "Starts Metro with its resolver attached. The Network module is enabled with network: true in the root config.",
    reactotron:
      "Runs as a desktop Electron app. The project creates a Reactotron config, connects the client and imports it from the app entrypoint in development.",
  },
  {
    label: "Finding a request",
    native:
      "Live search across URL, headers and body, plus method, status class and duration filters. Repeated endpoints can be grouped.",
    reactotron:
      "Network events share Reactotron's broader event timeline. The networking docs expose regex exclusions for URLs and response content types.",
  },
  {
    label: "Request inspection",
    native:
      "Separate Request, Response and Response headers views, with a navigable read-only JSON workspace for large payloads.",
    reactotron:
      "Displays API requests and responses as part of the cross-tool timeline, keeping network activity near logs and state events.",
  },
  {
    label: "Replay and compare",
    native:
      "Structured query, header and body editing; original or current-session credentials; replay tags and repeated-execution comparison.",
    reactotron:
      "Replay and request comparison are not documented capabilities of the official networking plugin.",
  },
  {
    label: "Storage causality",
    native:
      "Associates storage changes that happen after a response and opens the affected key directly in Storage.",
    reactotron:
      "Offers networking and storage plugins, but the official docs do not describe per-request correlation between them.",
  },
  {
    label: "Capture boundaries",
    native:
      "Documents configurable limits for request history, fast previews, retained full bodies, URL exclusions and sensitive headers.",
    reactotron:
      "Documents URL and content-type exclusions for networking. Its desktop network retention and body limits are not described on that plugin page.",
  },
  {
    label: "Release behavior",
    native:
      "The Metro resolver serves original modules to release builds; CI also checks that the development shim is absent.",
    reactotron:
      "Installed as a dev dependency. The official guide imports the config behind __DEV__ so the client does not connect in production.",
  },
  {
    label: "Best fit",
    native:
      "Teams that want a focused network workflow, editable replay and direct context across request and storage.",
    reactotron:
      "Teams that want network events inside a mature, extensible debugger covering many areas of the running app.",
  },
];

const nativeScopeSetup = {
  install: `pnpm add -D react-native-nativescope
pnpm nativescope`,
  config: `// nativescope.config.ts
import { defineNativeScopeConfig } from "react-native-nativescope/app"

export default defineNativeScopeConfig({
  modules: {
    network: true,
  },
})`,
};

const reactotronSetup = {
  install: `brew install --cask reactotron
pnpm add -D reactotron-react-native`,
  config: `// ReactotronConfig.js
import Reactotron, { networking } from "reactotron-react-native"

Reactotron.configure()
  .use(networking())
  .connect()`,
  entry: `// App.js or index.js
if (__DEV__) {
  require("./ReactotronConfig")
}`,
};

function NativeScopeLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span data-compare-brand="nativescope" data-compare-logo={compact ? "compact" : "card"}>
      <BrandLogo />
    </span>
  );
}

function ReactotronLogo({ compact = false, hero = false }: { compact?: boolean; hero?: boolean }) {
  return (
    <span
      data-compare-brand="reactotron"
      data-compare-logo={hero ? "hero" : compact ? "compact" : "card"}
    >
      <Image
        src="/brand/reactotron-logo.png"
        alt=""
        width={128}
        height={128}
        data-reactotron-mark
      />
      <span>Reactotron</span>
    </span>
  );
}

async function CodePanel({
  label,
  value,
  language = "typescript",
  tone = "neutral",
}: {
  label: string;
  value: string;
  language?: "bash" | "typescript";
  tone?: "neutral" | "command";
}) {
  const html = await highlightCode(value, language);

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

export default function CompareReactotronPage() {
  return (
    <div data-compare-page="reactotron">
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
          { name: "Compare", path: "/compare/reactotron" },
        ])}
      />

      <header data-page-lead>
        <p>Technical comparison · Network</p>
        <div data-compare-brands aria-label="NativeScope versus Reactotron">
          <span data-compare-brand="nativescope">
            <BrandLogo priority />
          </span>
          <span data-compare-versus aria-hidden="true">
            versus
          </span>
          <ReactotronLogo hero />
        </div>
        <h1>
          NativeScope Network and Reactotron,
          <br />
          compared by workflow.
        </h1>
        <span>
          This is not a verdict. Reactotron is a broad and proven debugger; NativeScope Network is a
          focused request workspace. The useful question is whether you need network events inside a
          wider timeline or a deeper path from capture to replay and storage impact.
        </span>
      </header>

      <aside data-comparison-note>
        <Info size={17} aria-hidden />
        <p>
          <strong>Scope of this comparison:</strong> this page compares the NativeScope Network
          module with Reactotron&apos;s official networking surface. Reactotron&apos;s Redux, MST,
          logs, errors, benchmarking, overlays, custom commands and MCP capabilities remain genuine
          strengths outside this network-specific comparison.
        </p>
      </aside>

      <section data-compare-table aria-labelledby="network-comparison-heading">
        <div data-compare-head>
          <span id="network-comparison-heading">Comparison point</span>
          <div data-compare-mobile-brands aria-hidden="true">
            <NativeScopeLogo compact />
            <span>vs</span>
            <ReactotronLogo compact />
          </div>
          <strong aria-label="NativeScope">
            <NativeScopeLogo compact />
          </strong>
          <strong aria-label="Reactotron">
            <ReactotronLogo compact />
          </strong>
        </div>
        {rows.map((row) => (
          <div data-compare-row key={row.label}>
            <span>{row.label}</span>
            <p data-compare-cell="NativeScope">{row.native}</p>
            <p data-compare-cell="Reactotron">{row.reactotron}</p>
          </div>
        ))}
      </section>

      <section data-compare-experience>
        <header>
          <p data-section-kicker>The pains we designed around</p>
          <h2>A request is rarely useful without the context around it.</h2>
          <span>
            The Network module began with four recurring interruptions: finding one call in a noisy
            stream, reading a large payload, reproducing a request without losing its session and
            discovering what the response changed afterward.
          </span>
        </header>
        <div data-experience-grid>
          <article>
            <Search size={18} aria-hidden />
            <h3>Reduce the stream</h3>
            <p>
              Search inside URL, headers and body, combine structured filters and group repeated
              endpoints before opening a request.
            </p>
          </article>
          <article>
            <Braces size={18} aria-hidden />
            <h3>Read the whole payload</h3>
            <p>
              Move from raw data into navigable JSON tables, wrap long values and keep response
              headers in their own view.
            </p>
          </article>
          <article>
            <History size={18} aria-hidden />
            <h3>Replay without rebuilding</h3>
            <p>
              Edit query parameters, headers and JSON body while choosing captured or current
              credentials.
            </p>
          </article>
          <article>
            <GitCompareArrows size={18} aria-hidden />
            <h3>Follow the consequence</h3>
            <p>
              Compare repeated executions, identify storage changes after the response and open the
              exact affected value.
            </p>
          </article>
        </div>
      </section>

      <section data-compare-workspace>
        <header>
          <p data-section-kicker>The NativeScope side, visible</p>
          <h2>A dedicated workspace instead of one more event row.</h2>
          <span>
            This is the actual Network module. The request list, detail panes, response viewer and
            Storage impact links remain on screen together so moving deeper does not discard
            context.
          </span>
        </header>
        <figure>
          <Image
            src="/screenshots/network-inspector-light.png"
            alt="NativeScope Network workspace with request list, request details, Storage impact and JSON response viewer"
            width={1440}
            height={900}
            quality={95}
            sizes="(max-width: 900px) 94vw, 1240px"
          />
          <figcaption>
            Real NativeScope Studio capture. Reactotron frames network calls inside its broader
            cross-tool event timeline.
          </figcaption>
        </figure>
      </section>

      <section data-config-compare>
        <header>
          <p data-section-kicker>Setup shape</p>
          <h2>Both are local. They attach at different points.</h2>
          <span>
            The commands show what enters the machine. The code blocks show what the running app
            must know about each tool.
          </span>
        </header>
        <div>
          <article>
            <NativeScopeLogo />
            <CodePanel
              label="Command"
              value={nativeScopeSetup.install}
              language="bash"
              tone="command"
            />
            <CodePanel label="Root config" value={nativeScopeSetup.config} />
            <small>
              NativeScope owns the Metro attachment and module transport. Network capture is one
              line in the shared root config.
            </small>
          </article>
          <article>
            <ReactotronLogo />
            <CodePanel
              label="Desktop + dependency"
              value={reactotronSetup.install}
              language="bash"
              tone="command"
            />
            <CodePanel label="Reactotron config" value={reactotronSetup.config} />
            <CodePanel label="App entrypoint" value={reactotronSetup.entry} />
            <small>
              Reactotron makes the client connection explicit and lets teams compose its wider
              plugin surface in application code.
            </small>
          </article>
        </div>
      </section>

      <section data-when-to-choose>
        <article>
          <p data-section-kicker>Choose NativeScope Network when</p>
          <h2>The request itself is the debugging workspace.</h2>
          <p className="mt-3">
            You want structured filters, large-payload navigation, editable replay, execution
            comparison and direct request-to-storage context with minimal app configuration.
          </p>
        </article>
        <article>
          <p data-section-kicker>Choose Reactotron when</p>
          <h2>Network is one signal in a wider debugging timeline.</h2>
          <p className="mt-3">
            You want a mature desktop debugger that places API traffic beside state, logs, errors,
            performance, overlays, custom commands and an extensible plugin ecosystem.
          </p>
        </article>
      </section>

      <footer data-comparison-sources>
        <p>
          Sources reviewed July 28, 2026. “Not documented” means the capability was not described in
          the official pages below; it is not a claim that custom extensions are impossible.
        </p>
        <a href="https://docs.infinite.red/reactotron/" target="_blank" rel="noreferrer noopener">
          Reactotron overview <ExternalLink size={13} aria-hidden />
        </a>
        <a
          href="https://docs.infinite.red/reactotron/quick-start/react-native/"
          target="_blank"
          rel="noreferrer noopener"
        >
          React Native quickstart <ExternalLink size={13} aria-hidden />
        </a>
        <a
          href="https://docs.infinite.red/reactotron/plugins/networking/"
          target="_blank"
          rel="noreferrer noopener"
        >
          Networking plugin <ExternalLink size={13} aria-hidden />
        </a>
        <a
          href="https://docs.infinite.red/reactotron/plugins/apisauce/"
          target="_blank"
          rel="noreferrer noopener"
        >
          Apisauce plugin <ExternalLink size={13} aria-hidden />
        </a>
        <a
          href="https://docs.infinite.red/reactotron/contributing/architecture/"
          target="_blank"
          rel="noreferrer noopener"
        >
          Reactotron architecture <ExternalLink size={13} aria-hidden />
        </a>
        <Link href="/docs/network/introduction">Read the NativeScope Network docs</Link>
      </footer>
    </div>
  );
}
