import Image from "next/image";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Braces,
  CheckCircle2,
  Clock3,
  Database,
  Github,
  Layers3,
  LockKeyhole,
  Network,
  Repeat2,
  Search,
  ShieldCheck,
  ScrollText,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { HighlightedCode } from "@/components/ui/HighlightedCode";
import { NpmLogo } from "@/components/ui/NpmLogo";

const configCode = `import { defineNativeScopeConfig } from
  "react-native-nativescope/app"

export default defineNativeScopeConfig({
  modules: {
    storage: true,
    network: true,
    logs: true,
  },
})`;

const principles = [
  [
    LockKeyhole,
    "Local by default",
    "Requests, credentials and app state stay between your device and your machine.",
  ],
  [
    Zap,
    "One deliberate setup",
    "Install once. Enable the modules you want in one config file. Never restructure the app around a debugger.",
  ],
  [
    ShieldCheck,
    "Dev-only by design",
    "Metro removes the instrumentation from release builds, and CI verifies the boundary.",
  ],
  [
    Layers3,
    "Context travels",
    "A log can lead directly to the request and storage values around the moment that matters.",
  ],
] as const;

export function PlatformHome() {
  return (
    <div data-platform-home>
      <section data-platform-hero>
        <div data-platform-hero-copy>
          <p data-hero-eyebrow>
            <span aria-hidden /> Open source · fully local · three modules live
          </p>
          <h1>One local Studio for what your React Native app is doing — and why.</h1>
          <p>
            NativeScope is a modular debugging environment with no account and no cloud. Inspect
            storage, understand HTTP and GraphQL traffic, capture JavaScript logs and connect the
            evidence in Timeline without rebuilding your workflow around another platform.
          </p>
          <div data-platform-actions>
            <Button href="/docs/storage/quickstart" size="lg">
              Get started
            </Button>
            <Button
              href="https://github.com/caiobarroso/react-native-nativescope"
              variant="secondary"
              size="lg"
              arrow={false}
            >
              <Github size={16} aria-hidden /> View on GitHub
            </Button>
          </div>
          <div data-platform-command>
            <span>$</span>
            <HighlightedCode code="npx nativescope" language="bash" />
            <a
              href="https://www.npmjs.com/package/react-native-nativescope"
              target="_blank"
              rel="noreferrer noopener"
            >
              <NpmLogo size={16} /> npm
            </a>
          </div>
          <ul data-platform-assurances>
            <li>
              <CheckCircle2 size={14} aria-hidden />
              One package
            </li>
            <li>
              <CheckCircle2 size={14} aria-hidden />
              No login
            </li>
            <li>
              <CheckCircle2 size={14} aria-hidden />
              No cloud
            </li>
          </ul>
        </div>

        <div data-platform-product>
          <div data-platform-window>
            <header>
              <span />
              <span />
              <span />
              <strong>NativeScope Studio</strong>
              <em>connected</em>
            </header>
            <div data-platform-window-body>
              <div data-platform-screen>
                <Image
                  src="/screenshots/network-inspector-light.png"
                  width={1440}
                  height={900}
                  priority
                  quality={95}
                  sizes="(max-width: 900px) 92vw, 720px"
                  alt="NativeScope Network showing captured requests, response data and the storage impact of a request"
                />
              </div>
            </div>
          </div>
          <div data-context-note>
            <Activity size={16} aria-hidden />
            <div>
              <strong>Shared context</strong>
              <small>Request → response → changed storage</small>
            </div>
          </div>
        </div>
      </section>

      <section data-platform-signals aria-label="NativeScope in numbers">
        <p>
          <strong>3</strong>
          <span>modules available now</span>
        </p>
        <p>
          <strong>1</strong>
          <span>local Studio</span>
        </p>
        <p>
          <strong>0</strong>
          <span>accounts or cloud hops</span>
        </p>
        <p>
          <strong>1</strong>
          <span>config file, modules declared</span>
        </p>
      </section>

      <section id="modules" data-module-showcase>
        <header data-platform-section-head>
          <div>
            <p data-section-kicker>Available now</p>
            <h2>
              Three hard debugging problems.
              <br />
              One calm interface.
            </h2>
          </div>
          <p>
            Each module goes deep on its own job. Together they preserve the context that usually
            disappears between tools, with Timeline as the shared lens.
          </p>
        </header>

        <article data-module-feature="storage">
          <div data-module-copy>
            <span>
              <Database size={17} aria-hidden /> Module 01 · Storage
            </span>
            <h3>See and change the state your app is actually using.</h3>
            <p>
              Inspect AsyncStorage, MMKV and SQLite live. Navigate large JSON visually, edit inline,
              compare snapshots and restore safely.
            </p>
            <ul>
              <li>
                <Search size={14} aria-hidden />
                Structured search and filters
              </li>
              <li>
                <Braces size={14} aria-hidden />
                Visual JSON navigation
              </li>
              <li>
                <Repeat2 size={14} aria-hidden />
                Bidirectional editing and restore
              </li>
            </ul>
            <Link href="/modules/storage">
              Explore Storage <ArrowRight size={15} aria-hidden />
            </Link>
          </div>
          <div data-module-shot>
            <Image
              src="/screenshots/json-visual-light.png"
              width={1280}
              height={720}
              quality={95}
              alt="NativeScope Storage visual JSON editor"
            />
          </div>
        </article>

        <article data-module-feature="network">
          <div data-module-copy>
            <span>
              <Network size={17} aria-hidden /> Module 02 · Network
            </span>
            <h3>Follow every request from the wire to the state it changed.</h3>
            <p>
              Capture HTTP and GraphQL, isolate a new scenario without deleting history, inspect
              full payloads, replay safely and understand the complete session.
            </p>
            <ul>
              <li>
                <Activity size={14} aria-hidden />
                Operation-aware HTTP + GraphQL timeline
              </li>
              <li>
                <Repeat2 size={14} aria-hidden />
                Structured replay and session Insights
              </li>
              <li>
                <Database size={14} aria-hidden />
                Automatic Storage impact
              </li>
            </ul>
            <Link href="/modules/network">
              Explore Network <ArrowRight size={15} aria-hidden />
            </Link>
          </div>
          <div data-module-shot>
            <Image
              src="/screenshots/network-inspector-light.png"
              width={1440}
              height={900}
              quality={95}
              alt="NativeScope Network inspector for HTTP and GraphQL traffic"
            />
          </div>
        </article>

        <article data-module-feature="logs">
          <div data-module-copy>
            <span>
              <ScrollText size={17} aria-hidden /> Module 03 · Logs
            </span>
            <h3>A log is a clue. Timeline shows the story.</h3>
            <p>
              Capture JavaScript console output from boot, inspect structured values and connect a
              failed line to the requests and storage writes around it.
            </p>
            <ul>
              <li>
                <Search size={14} aria-hidden />
                Search, levels and namespaces
              </li>
              <li>
                <Braces size={14} aria-hidden />
                Expand real structured values
              </li>
              <li>
                <Clock3 size={14} aria-hidden />
                Timeline across Logs, Network and Storage
              </li>
            </ul>
            <Link href="/modules/logs">
              Explore Logs <ArrowRight size={15} aria-hidden />
            </Link>
          </div>
          <div data-module-shot>
            <Image
              src="/screenshots/logs-inspector-light.png"
              width={1440}
              height={900}
              quality={95}
              alt="NativeScope Logs showing a selected structured value and its detail viewer"
            />
          </div>
        </article>
      </section>

      <section data-platform-config>
        <div data-platform-config-copy>
          <p data-section-kicker>One integration surface</p>
          <h2>
            Add capability.
            <br />
            Do not add friction.
          </h2>
          <p>
            NativeScope has one package and one root config where you declare the modules you want.
            Enable only what you need; the Studio grows with it. Removing a module removes its
            surface without leaving an app architecture behind.
          </p>
          <Button href="/docs/storage/configuration" variant="secondary">
            Read configuration
          </Button>
        </div>
        <div data-platform-config-code>
          <header>
            <span>nativescope.config.ts</span>
            <small>declare your modules</small>
          </header>
          <HighlightedCode code={configCode} language="typescript" />
          <footer>
            <span>Storage</span>
            <span>Network</span>
            <span>Logs</span>
            <em>Timeline connects them</em>
          </footer>
        </div>
      </section>

      <section data-platform-principles>
        <header data-platform-section-head>
          <div>
            <p data-section-kicker>The product contract</p>
            <h2>Serious tooling without platform gravity.</h2>
          </div>
          <p>
            Every module must earn its place and preserve the same local, understandable path into
            the product.
          </p>
        </header>
        <div>
          {principles.map(([Icon, title, body]) => (
            <article key={title}>
              <Icon size={18} aria-hidden />
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
