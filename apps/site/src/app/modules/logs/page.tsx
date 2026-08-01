import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Braces,
  CheckCircle2,
  Clock3,
  Copy,
  Flag,
  Gauge,
  Layers3,
  Search,
  ScrollText,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { HighlightedCode } from "@/components/ui/HighlightedCode";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbSchema, pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Logs — React Native console debugging in context",
  description:
    "Capture JavaScript logs from boot, inspect structured values and connect every log to the requests and storage writes around it in one local React Native Studio.",
  path: "/modules/logs",
  ogTitle: "NativeScope Logs — the line is only the beginning",
  ogDescription:
    "Capture console output locally, inspect the real values and use Timeline to see what happened around the moment that matters.",
});

const quickConfig = `import { defineNativeScopeConfig } from
  "react-native-nativescope/app"

export default defineNativeScopeConfig({
  modules: {
    logs: true,
  },
})`;

const capabilities = [
  [
    Search,
    "Find the useful line",
    "Search messages, namespaces, stacks and structured arguments without losing the surrounding stream.",
    "/docs/logs/reading-logs",
  ],
  [
    Braces,
    "Inspect the real value",
    "Objects, arrays and errors open in the same visual JSON workspace used by Storage — not a flattened terminal preview.",
    "/docs/logs/structured-data",
  ],
  [
    Copy,
    "Take the exact evidence",
    "Copy a log or its JSON payload into a bug report, issue or investigation without reconstructing it by hand.",
    "/docs/logs/reading-logs",
  ],
  [
    Gauge,
    "Survive noisy sessions",
    "Repeated lines become ×N, bursts respect a per-second ceiling and dropped entries stay visible instead of disappearing silently.",
    "/docs/logs/safety",
  ],
  [
    Flag,
    "Mark the moment",
    "Drop a marker before an action, keep the earlier stream out of the way and focus on everything that follows.",
    "/docs/logs/mark",
  ],
  [
    Layers3,
    "See the whole story",
    "Open Timeline from a log, error or request and place Logs, Network and Storage on one chronological axis.",
    "/docs/logs/timeline",
  ],
] as const;

export default function LogsModulePage() {
  return (
    <div data-logs-page>
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "Logs", path: "/modules/logs" },
        ])}
      />

      <section data-logs-hero>
        <div data-logs-hero-copy>
          <p data-hero-eyebrow>
            <span aria-hidden /> NativeScope module 03 · available now
          </p>
          <h1>A log is a clue. Timeline shows the story.</h1>
          <p>
            Capture JavaScript console output from boot, inspect the values behind each line and
            connect the moment that matters to every request and storage write around it. Fully
            local, inside the same Studio.
          </p>
          <div data-logs-actions>
            <Button href="/docs/logs/quickstart" size="lg">
              Add Logs
            </Button>
            <Button href="/docs/logs/introduction" variant="secondary" size="lg">
              Read the docs
            </Button>
          </div>
          <ul data-logs-facts>
            <li>
              <ScrollText size={14} aria-hidden /> JavaScript console
            </li>
            <li>
              <Zap size={14} aria-hidden /> Captures from boot
            </li>
            <li>
              <ShieldCheck size={14} aria-hidden /> Local + bounded
            </li>
          </ul>
        </div>

        <div data-logs-hero-visual>
          <div data-logs-browser>
            <header>
              <span />
              <span />
              <span />
              <strong>Logs · NativeScope Studio</strong>
              <em>live</em>
            </header>
            <Image
              src="/screenshots/logs-timeline-light.png"
              width={1440}
              height={900}
              priority
              quality={95}
              sizes="(max-width: 900px) 94vw, 760px"
              alt="NativeScope Timeline showing a highlighted log error with surrounding requests and storage changes"
            />
          </div>
        </div>
      </section>

      <section data-logs-promise>
        <p>
          <strong>console.*</strong>
          <span>passthrough capture, no new logger</span>
        </p>
        <p>
          <strong>1 line</strong>
          <span>to enable the whole module</span>
        </p>
        <p>
          <strong>×N + dropped</strong>
          <span>honest protection from bursts</span>
        </p>
        <p>
          <strong>0 cloud</strong>
          <span>local service, local Studio</span>
        </p>
      </section>

      <section data-logs-timeline>
        <div data-logs-timeline-shot>
          <Image
            src="/screenshots/logs-timeline-light.png"
            width={2880}
            height={1800}
            quality={95}
            alt="NativeScope Timeline placing logs, a request and storage activity before and after the selected error"
          />
        </div>
        <div data-logs-timeline-copy>
          <p data-section-kicker>The reason Logs matters</p>
          <h2>One moment. Every signal around it.</h2>
          <p>
            A console line rarely explains itself. Open Timeline from a log, an error, a failed
            request or a Mark and NativeScope aligns the three sources on one clock. The selected
            moment stays unmistakable; the context before and after can expand only when you need
            it.
          </p>
          <ul>
            <li>
              <Clock3 size={14} aria-hidden /> Choose ±5s, ±30s, ±2min or an event count.
            </li>
            <li>
              <Layers3 size={14} aria-hidden /> Toggle Logs, Network and Storage independently.
            </li>
            <li>
              <Flag size={14} aria-hidden /> Keep a Mark as the start of a focused investigation.
            </li>
          </ul>
          <Link href="/docs/logs/timeline">
            Learn how Timeline works <ArrowRight size={15} aria-hidden />
          </Link>
        </div>
      </section>

      <section data-logs-inspection>
        <div data-logs-inspection-copy>
          <p data-section-kicker>Read what the app actually emitted</p>
          <h2>Keep the stream fast. Keep the evidence intact.</h2>
          <p>
            The list stays chronological and virtualized for long sessions. Filter by level or
            namespace, search the message and its data, expand any line and open the complete
            object in the same viewer you already know from Storage.
          </p>
          <ol>
            <li>
              <span>01</span>
              <div>
                <strong>Find the signal</strong>
                <small>Search, level counts, namespaces and repeat grouping keep noise out.</small>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>Open the evidence</strong>
                <small>Objects, arrays and stacks remain inspectable, searchable and copyable.</small>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>Move to the cause</strong>
                <small>Jump from the exact line into its scoped Timeline.</small>
              </div>
            </li>
          </ol>
          <Link href="/docs/logs/reading-logs">
            Learn the Logs workflow <ArrowRight size={15} aria-hidden />
          </Link>
        </div>
        <div data-logs-inspection-shot>
          <Image
            src="/screenshots/logs-inspector-light.png"
            width={2880}
            height={1800}
            quality={95}
            alt="NativeScope Logs showing a selected structured object and its JSON detail viewer"
          />
        </div>
      </section>

      <section data-logs-capabilities>
        <header data-platform-section-head>
          <div>
            <p data-section-kicker>Built for real development streams</p>
            <h2>Less console archaeology. More useful decisions.</h2>
          </div>
          <p>
            Logs keeps the ordinary console workflow intact, then adds the controls that make a
            long, noisy session understandable when something goes wrong.
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

      <section data-logs-config>
        <div>
          <p data-section-kicker>The whole integration</p>
          <h2>One line turns the module on.</h2>
          <p>
            Start with the defaults. When a project needs a narrower stream, configure levels,
            payload bounds, batching, the startup buffer or ignored namespace patterns in the same
            root config file.
          </p>
          <Button href="/docs/logs/configuration" variant="secondary">
            See the configuration
          </Button>
        </div>
        <div data-logs-code>
          <header>
            <ScrollText size={15} aria-hidden />
            <span>nativescope.config.ts</span>
          </header>
          <HighlightedCode code={quickConfig} language="typescript" />
          <footer>
            <CheckCircle2 size={14} aria-hidden />
            Capture starts before the Studio connects.
          </footer>
        </div>
      </section>

      <section data-logs-safety>
        <div>
          <p data-section-kicker>Useful boundaries</p>
          <h2>Detailed when you ask. Bounded when you do not.</h2>
        </div>
        <div>
          <p>
            <strong>JavaScript scope.</strong> Logs captures the JavaScript console and global
            uncaught errors and rejections. It does not replace native device logs or Metro’s
            terminal.
          </p>
          <p>
            <strong>Finite by design.</strong> Startup buffering, entry limits, bounded values,
            repeated-line merging and a per-second ceiling protect the app from turning its own
            debug stream into a performance problem.
          </p>
          <p>
            <strong>Local is not automatic redaction.</strong> Captured values stay in the local
            development path, but console arguments are still sensitive. Do not log secrets; Logs
            does not silently redact them for you.
          </p>
        </div>
      </section>

      <section data-logs-closer>
        <div>
          <p data-section-kicker>Logs is live</p>
          <h2>Stop reading the line in isolation.</h2>
        </div>
        <div>
          <Button href="/docs/logs/quickstart" size="lg">
            Enable Logs
          </Button>
          <Button href="/docs/logs/timeline" variant="secondary" size="lg">
            Explore Timeline
          </Button>
        </div>
      </section>
    </div>
  );
}
