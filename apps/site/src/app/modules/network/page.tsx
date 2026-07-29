import Image from "next/image";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BarChart3,
  BellRing,
  Braces,
  Clock3,
  Database,
  Filter,
  Flag,
  Group,
  LockKeyhole,
  Network,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { HighlightedCode } from "@/components/ui/HighlightedCode";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbSchema, pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Network — HTTP and GraphQL debugging for React Native",
  description:
    "Capture HTTP and GraphQL, filter traffic, inspect payloads, replay requests, analyze endpoints and follow storage impact in one local React Native Studio.",
  path: "/modules/network",
  ogTitle: "NativeScope Network — HTTP and GraphQL in context",
  ogDescription:
    "Capture, filter, inspect, replay and analyze React Native HTTP and GraphQL traffic locally, then follow the storage it changed.",
});

const quickConfig = `import { defineNativeScopeConfig } from
  "react-native-nativescope/app"

export default defineNativeScopeConfig({
  modules: {
    network: true,
  },
})`;

const capabilities = [
  [
    Flag,
    "Focus without deleting history",
    "Start a new capture from this moment, keep earlier traffic behind a marker and return to it whenever context matters.",
    "/docs/network/capture-controls",
  ],
  [
    Filter,
    "Search every layer",
    "Combine URL, header and body search with method, status, duration, protocol and GraphQL operation filters.",
    "/docs/network/requests",
  ],
  [
    Braces,
    "Read complete payloads",
    "Inspect request, response and headers separately. Large bodies stay bounded, then load completely only when requested.",
    "/docs/network/requests",
  ],
  [
    BarChart3,
    "Understand the session",
    "Open Insights for request volume, failures, p95 latency, transferred data, a timeline and endpoint-level drill-down.",
    "/docs/network/insights",
  ],
  [
    BellRing,
    "Hear only what matters",
    "Use a local sound for every request, failures only or selected endpoint rules, with a compact volume control.",
    "/docs/network/capture-controls",
  ],
  [
    Database,
    "Follow storage impact",
    "See which storage entries changed immediately after a response and open the exact value in the Storage module.",
    "/docs/network/storage-impact",
  ],
] as const;

export default function NetworkModulePage() {
  return (
    <div data-network-page>
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "Network", path: "/modules/network" },
        ])}
      />

      <section data-network-hero>
        <div data-network-hero-copy>
          <p data-hero-eyebrow>
            <span aria-hidden /> NativeScope module 02 · available now
          </p>
          <h1>See every request in the context that made it matter.</h1>
          <p>
            Capture HTTP and GraphQL, find the exact call, inspect the complete exchange, replay
            with control and follow a response into the storage it changed. Fully local, inside the
            same Studio.
          </p>
          <div data-network-actions>
            <Button href="/docs/network/quickstart" size="lg">
              Add Network
            </Button>
            <Button href="/docs/network/introduction" variant="secondary" size="lg">
              Read the docs
            </Button>
          </div>
          <ul data-network-facts>
            <li>
              <ShieldCheck size={14} aria-hidden /> Local only
            </li>
            <li>
              <Clock3 size={14} aria-hidden /> Bounded memory
            </li>
            <li>
              <LockKeyhole size={14} aria-hidden /> Configurable redaction
            </li>
          </ul>
        </div>

        <div data-network-hero-visual>
          <div data-network-browser>
            <header>
              <span />
              <span />
              <span />
              <strong>Network · NativeScope Studio</strong>
              <em>live</em>
            </header>
            <Image
              src="/screenshots/network-inspector-light.png"
              width={1440}
              height={900}
              priority
              quality={95}
              sizes="(max-width: 900px) 94vw, 760px"
              alt="NativeScope Network displaying a request list, request detail and response body"
            />
          </div>
        </div>
      </section>

      <section data-network-promise>
        <p>
          <strong>HTTP + GraphQL</strong>
          <span>one operation-aware timeline</span>
        </p>
        <p>
          <strong>fetch + XHR</strong>
          <span>automatic development capture</span>
        </p>
        <p>
          <strong>1 line</strong>
          <span>to enable the whole module</span>
        </p>
        <p>
          <strong>0 cloud</strong>
          <span>accounts, proxies or remote dashboards</span>
        </p>
      </section>

      <section data-network-protocol>
        <div data-network-protocol-visual aria-label="HTTP and GraphQL requests in one timeline">
          <header>
            <div>
              <Activity size={14} aria-hidden />
              <strong>Unified timeline</strong>
            </div>
            <span>live</span>
          </header>
          <div data-network-protocol-filters>
            <span data-active>All traffic</span>
            <span>HTTP</span>
            <span>GraphQL</span>
            <span>Mutations</span>
          </div>
          <div data-network-protocol-head>
            <span>Type</span>
            <span>Operation or endpoint</span>
            <span>Status</span>
          </div>
          <div data-network-protocol-row>
            <b data-tone="query">QUERY</b>
            <p>
              <strong>GetViewer</strong>
              <small>/graphql</small>
            </p>
            <em data-tone="ok">200</em>
          </div>
          <div data-network-protocol-row data-selected>
            <b data-tone="mutation">MUT</b>
            <p>
              <strong>UpdateSettings</strong>
              <small>/graphql · 2 variables</small>
            </p>
            <em data-tone="semantic">GQL 1</em>
          </div>
          <div data-network-protocol-row>
            <b data-tone="http">GET</b>
            <p>
              <strong>/api/profile</strong>
              <small>HTTP · 148 ms</small>
            </p>
            <em data-tone="ok">200</em>
          </div>
          <div data-network-protocol-row>
            <b data-tone="http">POST</b>
            <p>
              <strong>/checkout</strong>
              <small>HTTP · 1.2 s</small>
            </p>
            <em data-tone="error">409</em>
          </div>
        </div>

        <div data-network-protocol-copy>
          <p data-section-kicker>One timeline, two protocols</p>
          <h2>GraphQL should not look like a wall of POST requests.</h2>
          <p>
            NativeScope recognizes GraphQL over HTTP automatically. Queries, mutations, persisted
            operations and batches keep their operation names, variables and semantic errors
            without another client adapter or schema upload.
          </p>
          <ul>
            <li>
              <Braces size={14} aria-hidden />
              Document and variables remain separate.
            </li>
            <li>
              <Filter size={14} aria-hidden />
              Filter by protocol, query, mutation or batch.
            </li>
            <li>
              <Activity size={14} aria-hidden />
              GraphQL errors stay visible even when HTTP returns 200.
            </li>
          </ul>
          <Link href="/docs/network/graphql">
            Explore GraphQL debugging <ArrowRight size={15} aria-hidden />
          </Link>
        </div>
      </section>

      <section data-network-capabilities>
        <header data-platform-section-head>
          <div>
            <p data-section-kicker>Control the session</p>
            <h2>Keep the signal. Lose the noise.</h2>
          </div>
          <p>
            Capture controls, filtering and session-level analysis stay close to the timeline
            without changing how your app makes a request.
          </p>
        </header>
        <div>
          {capabilities.map(([Icon, title, body, href]) => (
            <article key={title}>
              <Icon size={19} aria-hidden />
              <h3>{title}</h3>
              <p>{body}</p>
              <Link href={href} aria-label={`Learn more about ${title}`}>
                Learn more <ArrowRight size={13} aria-hidden />
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section data-network-flow>
        <div data-network-flow-copy>
          <p data-section-kicker>Replay HTTP and GraphQL</p>
          <h2>Change the request, not your concentration.</h2>
          <p>
            Query parameters and headers are structured rows. Common header names are suggested but
            never forced. JSON bodies are formatted and validated; GraphQL gets dedicated Operation
            and Variables editors. Untouched sections keep the captured request exactly as it was.
          </p>
          <ol>
            <li>
              <span>01</span>
              <div>
                <strong>Choose the session</strong>
                <small>Original capture or current app credentials.</small>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>Edit only what matters</strong>
                <small>Query, headers, body, operation and variables stay separate.</small>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>Replay, compare, follow impact</strong>
                <small>The new execution is tagged in the request list.</small>
              </div>
            </li>
          </ol>
          <Link href="/docs/network/replay">
            Learn replay and compare <ArrowRight size={15} aria-hidden />
          </Link>
        </div>
        <div data-network-replay-shot>
          <Image
            src="/screenshots/network-replay-light.png"
            width={1360}
            height={900}
            quality={95}
            alt="NativeScope structured request replay editor"
          />
        </div>
      </section>

      <section data-network-config>
        <div>
          <p data-section-kicker>The whole integration</p>
          <h2>One line turns the module on.</h2>
          <p>
            Use the defaults first. Fine-tune body capture, limits, ignored URLs and redacted
            headers only when the app needs it.
          </p>
          <Button href="/docs/network/configuration" variant="secondary">
            See every option
          </Button>
        </div>
        <div data-network-code>
          <header>
            <Network size={15} aria-hidden />
            <span>nativescope.config.ts</span>
          </header>
          <HighlightedCode code={quickConfig} language="typescript" />
          <footer>
            <Group size={14} aria-hidden />
            The module appears when the app reconnects.
          </footer>
        </div>
      </section>

      <section data-network-safety>
        <div>
          <p data-section-kicker>Useful boundaries</p>
          <h2>Detailed when you ask. Bounded when you do not.</h2>
        </div>
        <div>
          <p>
            <strong>Preview first.</strong> Large payloads send a bounded preview to keep the
            request list responsive. The full body loads on demand, with a 32 KB preview and 2 MB
            retention limit by default.
          </p>
          <p>
            <strong>Buffers stay finite.</strong> Request history and retained bodies have explicit,
            configurable limits instead of growing with the session forever.
          </p>
          <p>
            <strong>Your credentials stay local.</strong> Redact additional headers when necessary,
            and remember that replay performs a real request with real side effects.
          </p>
        </div>
      </section>

      <section data-network-closer>
        <div>
          <p data-section-kicker>Network is live</p>
          <h2>Stop reconstructing the request from logs.</h2>
        </div>
        <div>
          <Button href="/docs/network/quickstart" size="lg">
            Enable Network
          </Button>
          <Button href="/modules/storage" variant="secondary" size="lg">
            Explore Storage
          </Button>
        </div>
      </section>
    </div>
  );
}
