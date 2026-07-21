import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Database, Gauge, ScanSearch } from "lucide-react";
import { Reveal } from "@/components/ui/Reveal";

export function ProductStory() {
  return (
    <>
      <Reveal>
        <section data-proof-strip aria-label="Product principles">
          <p><strong>3</strong><span>storage engines<br />one studio</span></p>
          <p><strong>0</strong><span>providers, wrappers<br />or registrations</span></p>
          <p><strong>O(viewport)</strong><span>rendered rows stay tied<br />to what you see</span></p>
          <p><strong>127.0.0.1</strong><span>your data remains<br />on your machine</span></p>
        </section>
      </Reveal>

      <Reveal>
      <section data-story="scale">
        <div data-story-copy>
          <p data-section-kicker><Gauge size={15} aria-hidden /> Designed for the dataset you actually have</p>
          <h2>A window into gigabytes.<br />Never a copy of them.</h2>
          <p>
            NativeScope never serializes an entire database table to render a grid. Paged values,
            streamed payloads and virtualized rendering keep transfer and DOM work bounded. The same
            viewport mounts the same number of rows with ten records or ten million.
          </p>
          <dl data-mechanism-list>
            <div><dt>Cursor pagination</dt><dd>Only requested values or rows cross the wire.</dd></div>
            <div><dt>Bounded previews</dt><dd>Large values open instantly, then stream in full.</dd></div>
            <div><dt>Frame budgets</dt><dd>Performance contracts are enforced in CI.</dd></div>
          </dl>
          <Link href="/journal/a-window-not-a-copy" data-text-link>
            Read the engineering note <ArrowRight size={15} aria-hidden />
          </Link>
        </div>

        <div data-story-visual>
          <div data-window-caption>
            <span><Database size={14} aria-hidden /> proline.db / events</span>
            <strong>100,001 rows</strong>
          </div>
          <Image
            src="/screenshots/sqlite-scale-light.png"
            width={1280}
            height={720}
            quality={95}
            sizes="(max-width: 900px) 92vw, 620px"
            alt="NativeScope SQLite grid browsing 100,001 rows with pagination and live activity"
          />
        </div>
      </section>
      </Reveal>

      <Reveal>
      <section data-story="zero-config">
        <div data-resolver-demo aria-label="How zero config works">
          <div data-code-label>your app code</div>
          <pre><code>{`import AsyncStorage from
  '@react-native-async-storage/async-storage'

await AsyncStorage.setItem('session', value)`}</code></pre>
          <div data-resolver-line><span>Metro resolver</span></div>
          <div data-code-label>development bundle</div>
          <pre><code>{`same import
same API
+ live instrumentation`}</code></pre>
          <p><ScanSearch size={15} aria-hidden /> Detected automatically</p>
        </div>

        <div data-story-copy>
          <p data-section-kicker>Zero config is architecture, not a slogan</p>
          <h2>Your code stays yours.</h2>
          <p>
            NativeScope attaches at the Metro resolver. It substitutes the storage modules your app
            already imports with transparent development shims, then gets out of the way for release
            builds. No provider. No root wrapper. No instance registry.
          </p>
          <div data-release-guard>
            <span>release bundle</span>
            <strong>instrumentation: 0 bytes</strong>
            <small>A CI guard fails if the shim marker is ever found.</small>
          </div>
          <Link href="/journal/zero-config" data-text-link>
            See how the resolver works <ArrowRight size={15} aria-hidden />
          </Link>
        </div>
      </section>
      </Reveal>
    </>
  );
}
