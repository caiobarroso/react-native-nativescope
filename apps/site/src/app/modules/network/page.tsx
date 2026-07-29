import Image from "next/image";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Braces,
  Clock3,
  Database,
  Filter,
  GitCompareArrows,
  Group,
  LockKeyhole,
  Network,
  Repeat2,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { HighlightedCode } from "@/components/ui/HighlightedCode";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbSchema, pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Network — React Native request inspection and replay",
  description:
    "Capture fetch and XHR, inspect complete payloads, replay requests, compare executions and follow storage impact in one local React Native Studio.",
  path: "/modules/network",
  ogTitle: "NativeScope Network — see every request in context",
  ogDescription:
    "Capture, filter, inspect, replay and compare React Native requests locally, then follow the storage they changed.",
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
    Activity,
    "Capture without rewrites",
    "NativeScope instruments the fetch and XMLHttpRequest APIs your app already uses.",
  ],
  [
    Filter,
    "Find signal quickly",
    "Filter by URL, header, body, method, status class or duration. Group repeated endpoints when the list gets noisy.",
  ],
  [
    Braces,
    "Read real payloads",
    "Inspect request, response and headers separately. Large bodies stay bounded and load completely only when requested.",
  ],
  [
    Repeat2,
    "Replay deliberately",
    "Choose original or current credentials, edit structured query parameters and headers, validate JSON, then replay.",
  ],
  [
    GitCompareArrows,
    "Compare executions",
    "Put repeated calls side by side and isolate what changed instead of scanning two payloads by hand.",
  ],
  [
    Database,
    "Follow storage impact",
    "See which storage entries changed immediately after a response and open the exact value in the Storage module.",
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
            Capture fetch and XHR, inspect the complete exchange, replay with control and follow a
            response into the storage it changed. Fully local, inside the same Studio.
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
          <strong>fetch + XHR</strong>
          <span>the APIs your app already calls</span>
        </p>
        <p>
          <strong>1,000</strong>
          <span>bounded requests by default</span>
        </p>
        <p>
          <strong>32 KB</strong>
          <span>fast body preview by default</span>
        </p>
        <p>
          <strong>2 MB</strong>
          <span>full-body retention limit by default</span>
        </p>
      </section>

      <section data-network-capabilities>
        <header data-platform-section-head>
          <div>
            <p data-section-kicker>The working surface</p>
            <h2>From traffic to explanation.</h2>
          </div>
          <p>
            The interface stays dense where comparison matters and quiet where a single request
            needs your attention.
          </p>
        </header>
        <div>
          {capabilities.map(([Icon, title, body]) => (
            <article key={title}>
              <Icon size={19} aria-hidden />
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section data-network-flow>
        <div data-network-flow-copy>
          <p data-section-kicker>Replay without the guesswork</p>
          <h2>Change the request, not your concentration.</h2>
          <p>
            Query parameters and headers are structured rows. Common header names are suggested but
            never forced. JSON bodies are formatted and validated before the request leaves your
            machine, and untouched sections keep the captured request exactly as it was.
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
                <small>Query, headers and body remain separate.</small>
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
            request list responsive. The full body loads on demand.
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
