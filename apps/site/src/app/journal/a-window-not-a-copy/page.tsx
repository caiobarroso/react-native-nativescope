import { ArticleShell } from "@/components/articles/ArticleShell";
import {
  BytePathDiagram,
  FluidityDiagram,
  StreamDiagram,
  TwinGridsDiagram,
  WindowVsCopyDiagram,
} from "@/components/articles/ScaleDiagrams";
import { pageMetadata, techArticleSchema, breadcrumbSchema } from "@/lib/seo";
import { JsonLd } from "@/components/seo/JsonLd";

const ARTICLE = {
  title: "A window, not a copy",
  description: "How NativeScope reads gigabytes without freezing your app or the Studio.",
  path: "/journal/a-window-not-a-copy",
  published: "2026-07-21",
  modified: "2026-07-21",
};

export const metadata = pageMetadata({
  title: ARTICLE.title,
  description: ARTICLE.description,
  path: ARTICLE.path,
  type: "article",
  publishedTime: ARTICLE.published,
  modifiedTime: ARTICLE.modified,
});

const budgets = [
  ["Single WebSocket message", "≤ 256 KB", "Measured in UTF-8 bytes and covered by budget tests."],
  ["Key-value preview", "≤ 64 KB", "A complete value moves to the cancelable stream lane."],
  ["SQLite cell preview", "≤ 4 KB", "The grid never receives a full oversized cell by accident."],
  ["Value reads per key page", "≤ 500", "Names may be enumerated by the provider; values stay paged."],
  ["Dashboard DOM", "O(viewport)", "Virtualization bounds mounted rows as loaded pages grow."],
  ["Runtime scheduling", "cooperative", "Value batches yield to the app event loop between slices."],
];

export default function ScaleArticlePage() {
  return (
    <ArticleShell
      eyebrow="Performance / engineering note"
      title="A window, not a copy"
      description="How the inspector reads gigabytes of on-device storage without freezing your app — or our dashboard."
      readTime="12 min read"
    >
      <JsonLd
        data={techArticleSchema({
          title: ARTICLE.title,
          description: ARTICLE.description,
          path: ARTICLE.path,
          published: ARTICLE.published,
          modified: ARTICLE.modified,
        })}
      />
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "Journal", path: "/journal" },
          { name: ARTICLE.title, path: ARTICLE.path },
        ])}
      />
      <section>
        <p data-article-kicker>The problem</p>
        <h2>The trap every inspector falls into</h2>
        <p>
          The obvious design serializes every key, row and value, then ships the copy to a desktop
          dashboard. It looks fine against twenty keys. Against a real database, the app stalls while
          stringifying and the browser chokes while parsing a payload it never needed.
        </p>
        <p>
          A faster serializer, compression or a heavier grid cannot fix that shape of problem. The
          cost is still proportional to the size of the data. You cannot optimize your way out of
          moving a gigabyte you never needed to move.
        </p>
      </section>

      <section>
        <p data-article-kicker>The thesis</p>
        <h2>One rule: the window, not the copy</h2>
        <p>
          The values stay where they live. The interface slides a window over them, and the rendered
          row count remains tied to the viewport. Key inventory is the explicit exception:
          AsyncStorage and MMKV expose all names through <code>getAllKeys()</code>, so NativeScope
          cannot make that provider operation constant-time. It keeps the expensive value reads,
          transfer and DOM work bounded after enumeration.
        </p>
        <WindowVsCopyDiagram />
      </section>

      <section>
        <p data-article-kicker>The contract</p>
        <h2>The budgets we refuse to break</h2>
        <p>
          A principle you cannot measure is just a slogan. The hard byte, preview and page limits are
          covered by CI tests. Scheduling and rendering behavior are exercised by the scale runtime
          and browser QA rather than presented as synthetic millisecond guarantees.
        </p>
        <div data-article-table>
          <table>
            <thead><tr><th>Budget</th><th>Limit</th><th>Why it exists</th></tr></thead>
            <tbody>{budgets.map(([name, limit, why]) => <tr key={name}><td>{name}</td><td>{limit}</td><td>{why}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section>
        <p data-article-kicker>The architecture</p>
        <h2>The path a byte takes</h2>
        <p>
          Three actors sit between a byte on the device and a pixel on screen. The runtime reads one
          requested page and truncates values to bounded previews. A local bridge relays bounded
          frames. The Studio virtualizes the viewport and avoids rebuilding off-screen SQLite rows.
        </p>
        <BytePathDiagram />
      </section>

      <section>
        <p data-article-kicker>On the device</p>
        <h2>Read little, yield often</h2>
        <p>
          Key names are fetched first. One page is read in small batches and each value becomes a
          preview before crossing the wire. Between batches, NativeScope returns the JavaScript
          thread to the event loop, keeping taps, animations and network callbacks alive.
        </p>
        <p>
          Pagination uses keyset cursors instead of <code>OFFSET</code>, so page one and page one
          hundred thousand have the same shape of cost. Search runs next to the data and returns only
          matches, instead of transferring a store to filter it elsewhere.
        </p>
      </section>

      <section>
        <p data-article-kicker>The transport</p>
        <h2>Stream, never dump</h2>
        <p>
          Large values use a separate lane: bounded chunks with a beginning, an end and a running
          checksum. Streams are cancelable, and Chromium exports can flow directly to disk. Browsers
          without the File System Access API use a clearly signaled buffered fallback.
        </p>
        <StreamDiagram />
      </section>

      <section>
        <p data-article-kicker>The dashboard</p>
        <h2>A viewport over millions</h2>
        <p>
          A million-key list still mounts roughly thirty recycled DOM nodes. Large JSON collections
          use the same virtual-row discipline, while node counting stops at a fixed diagnostic cap.
          Live SQLite refreshes re-query the visible window, not everything the user has ever
          scrolled through. Fluidity on both ends is one rule applied twice.
        </p>
        <FluidityDiagram />
      </section>

      <section>
        <p data-article-kicker>In the tables</p>
        <h2>Two grids, one window</h2>
        <p>
          The same discipline reaches the two places where NativeScope shows data in bulk. A
          million-row SQLite table and a JSON array with tens of thousands of items both render as
          a small set of recycled rows. Global key search and SQLite search run next to the data, so
          matches return without transferring the underlying values or rows first. Once a JSON value
          is explicitly loaded, its visual filter runs locally over that value.
        </p>
        <p>
          Live refresh follows the same rule. When data changes, NativeScope re-queries only the
          visible rows by keyset cursor. The cost stays proportional to the viewport, not to
          everything the user has already scrolled through.
        </p>
        <TwinGridsDiagram />
      </section>

      <section>
        <p data-article-kicker>The guarantee</p>
        <h2>100% of the data, always</h2>
        <p>
          A preview is a display choice, never a limit on access. It carries the true size and an
          explicit truncation marker. The complete value is always available on demand or as a
          streamed file, verified against accidental corruption in transit.
        </p>
      </section>

      <section data-article-closer>
        <p>
          We stopped copying data to show it and started opening a window onto data that stays where
          it is. The budgets, cursors, streams and virtualization are what keep that window honest at
          the scale of gigabytes.
        </p>
      </section>
    </ArticleShell>
  );
}
