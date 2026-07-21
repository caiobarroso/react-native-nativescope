import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  CloudOff,
  Code2,
  Layers3,
  LockKeyhole,
  Sparkles,
} from "lucide-react";
import { ModuleOrganism, OneFileContract } from "@/components/goal/GoalVisuals";
import { Button } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "Our goal",
  description: "The product principles and long-term direction behind NativeScope.",
};

const evidence = [
  {
    href: "/journal/a-window-not-a-copy",
    label: "Performance",
    title: "A window, not a copy",
    body: "The budgets, cursor pagination, streams and virtualization behind fluid inspection at gigabyte scale.",
  },
  {
    href: "/journal/zero-config",
    label: "Architecture",
    title: "Zero config, for real",
    body: "How Metro interception and release guards make plug-and-play an engineering property instead of a slogan.",
  },
  {
    href: "/compare/rozenite",
    label: "Choice",
    title: "A factual comparison",
    body: "The integration trade-offs beside another capable ecosystem, with sources and without declaring a winner.",
  },
];

const principles = [
  ["Local first", "Your debugging data stays on your machine."],
  ["No account", "A useful local tool should not begin with a signup form."],
  ["Simple by default", "A beginner gets the same safe path as an experienced engineer."],
  ["Dev-only", "Instrumentation belongs in development and is checked out of release bundles."],
  ["Modular", "Install the capability you need. The Studio reflects what is present."],
  ["Evidence over claims", "We publish mechanisms, constraints and trade-offs."],
];

export default function OurGoalPage() {
  return (
    <div data-goal-page>
      <header data-goal-hero>
        <p data-section-kicker>Our goal</p>
        <h1>One debugging environment.<br />None of the usual friction.</h1>
        <span>
          NativeScope is becoming an all-in-one React Native debugging environment: fully local,
          account-free and simple enough to adopt in the middle of a difficult debugging session.
        </span>
        <div data-goal-signals aria-label="NativeScope product commitments">
          <p><strong>0</strong><span>logins</span></p>
          <p><strong>0</strong><span>cloud dependencies</span></p>
          <p><strong>1</strong><span>optional config file</span></p>
          <p><strong>N</strong><span>modules, only when needed</span></p>
        </div>
      </header>

      <section data-goal-premise>
        <div>
          <p data-section-kicker>The honest premise</p>
          <h2>New is not automatically better.</h2>
        </div>
        <div data-goal-prose>
          <p>
            Most debugging categories already exist. We are not interested in pretending otherwise.
            We begin with workflows the community already understands, identify where they become
            slow, fragmented or difficult to adopt, and improve those points in ways we can prove.
          </p>
          <p>
            That means naming the tools that inspired us, explaining the pain we felt while using
            them and being transparent about trade-offs. The user should leave with enough evidence
            to choose, even when that choice is not NativeScope.
          </p>
          <blockquote>Borrow openly. Improve measurably. Prove everything.</blockquote>
        </div>
      </section>

      <section data-goal-proof>
        <header>
          <p data-section-kicker>The first proof</p>
          <h2>Storage is module one, not the finish line.</h2>
          <p>
            We started with storage because its problems are concrete: hidden app state, fragmented
            providers, stale UI after edits and inspectors that collapse under real datasets. The
            finished module is our evidence that calm UX can sit on serious engineering.
          </p>
        </header>
        <div data-goal-evidence>
          {evidence.map((item, index) => (
            <Link href={item.href} key={item.href}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <small>{item.label}</small>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </div>
              <ArrowUpRight size={18} aria-hidden />
            </Link>
          ))}
        </div>
      </section>

      <section data-goal-ecosystem>
        <header>
          <p data-section-kicker>The environment</p>
          <h2>One Studio for the questions that interrupt your work.</h2>
          <p>
            Storage is live today. Future modules will follow real community needs: network traffic,
            structured logs, performance, state, navigation, files and device events. Familiar
            Reactotron-style capabilities can live beside deeper purpose-built tools without turning
            installation into a platform migration.
          </p>
        </header>
        <ModuleOrganism />
      </section>

      <section data-goal-plug-play>
        <div data-goal-plug-copy>
          <p data-section-kicker>The non-negotiable</p>
          <h2>Capability may grow. Integration may not.</h2>
          <p>
            The React Native community includes people shipping their first app and engineers
            maintaining products used by millions. Neither group should have to restructure an app,
            understand our internals or maintain a second inventory just to inspect it.
          </p>
          <p>
            Automatic discovery remains the default wherever it is safe. When explicit behavior is
            necessary, it belongs in the single root config file. Adding a module should mean adding
            a line, not adopting a new architecture.
          </p>
          <ul>
            <li><Check size={15} aria-hidden />One guided integration surface</li>
            <li><Check size={15} aria-hidden />Advanced control without an advanced entry price</li>
            <li><Check size={15} aria-hidden />Modules disappear cleanly when removed</li>
          </ul>
        </div>
        <OneFileContract />
      </section>

      <section data-goal-contract>
        <header>
          <p data-section-kicker>Our contract</p>
          <h2>The rules every module has to keep.</h2>
        </header>
        <div data-goal-principles>
          {principles.map(([title, body], index) => {
            const icons = [CloudOff, LockKeyhole, Sparkles, Code2, Layers3, Check];
            const Icon = icons[index];
            return (
              <article key={title}>
                <Icon size={19} aria-hidden />
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section data-goal-closer>
        <div>
          <p data-section-kicker>Built in the open</p>
          <h2>The first module is already the proof.</h2>
          <p>
            Inspect how it works, challenge the decisions and use the evidence to decide whether it
            belongs in your workflow.
          </p>
        </div>
        <div>
          <Button href="/docs/quickstart" size="lg">Get started</Button>
          <Button href="/journal" variant="secondary" size="lg">Read the engineering</Button>
        </div>
      </section>
    </div>
  );
}
