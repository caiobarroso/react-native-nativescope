import { ArticleShell } from "@/components/articles/ArticleShell";
import {
  AutoDiscoveryDiagram,
  OptionalConfigDiagram,
  ReleaseBoundaryDiagram,
  ResolverCompositionDiagram,
  ResolverInterceptDiagram,
} from "@/components/articles/ZeroConfigDiagrams";
import { pageMetadata, techArticleSchema, breadcrumbSchema } from "@/lib/seo";
import { JsonLd } from "@/components/seo/JsonLd";

const ARTICLE = {
  title: "Plug-and-play, by construction",
  description:
    "How NativeScope instruments the modules an app already uses without changing app code.",
  path: "/journal/zero-config",
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

export default function ZeroConfigArticlePage() {
  return (
    <ArticleShell
      eyebrow="Architecture / engineering note"
      title="Plug-and-play, by construction"
      description="A resolver, transparent development shims and a release guard — the architecture behind one command."
      readTime="8 min read"
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
        <p data-article-kicker>The standard</p>
        <h2>Setup is part of the product</h2>
        <p>
          A storage inspector is most useful in the moment you did not plan to need it. If adopting
          it means restructuring the root component, threading providers through the tree or keeping
          an instance registry up to date, the tool arrives after the debugging session is over.
        </p>
        <p>NativeScope starts with a stricter constraint: the app source should not know it exists.</p>
      </section>

      <section>
        <p data-article-kicker>The attachment point</p>
        <h2>Meet the app where its imports resolve</h2>
        <p>
          When Metro resolves <code>react-native-mmkv</code>, <code>expo-sqlite</code>,{" "}
          <code>@op-engineering/op-sqlite</code> or{" "}
          <code>@react-native-async-storage/async-storage</code> in development, NativeScope returns a
          small shim from its own package. The shim loads the real module, wraps the behavior needed
          for inspection, and re-exports the public API transparently.
        </p>
        <ResolverInterceptDiagram />
      </section>

      <section>
        <p data-article-kicker>Composition</p>
        <h2>Custom Metro configs remain custom</h2>
        <p>
          The resolver composes with an existing <code>resolveRequest</code> instead of replacing it.
          Symlinked local packages add their real package root to Metro watch folders, while React
          and React Native always resolve from the consuming app to preserve singleton identity.
        </p>
        <p>
          Requests originating inside a shim bypass interception. That anti-loop rule lets the shim
          import the real storage library without resolving itself forever.
        </p>
        <ResolverCompositionDiagram />
      </section>

      <section>
        <p data-article-kicker>Discovery</p>
        <h2>The storage registry builds itself</h2>
        <p>
          AsyncStorage is available as soon as the intercepted module is used. MMKV instances are
          observed as they are created. SQLite databases are registered when the app opens them. The
          developer does not need to repeat names or query keys in a second configuration surface.
        </p>
        <AutoDiscoveryDiagram />
      </section>

      <section>
        <p data-article-kicker>The boundary</p>
        <h2>Development is not a runtime flag</h2>
        <p>
          When Metro resolves a release bundle, the real module passes through directly. NativeScope
          adds a second, independent belt: every shim contains a marker and CI scans the exported
          release bundle for it. If the marker is found, the build fails.
        </p>
        <ReleaseBoundaryDiagram />
      </section>

      <section>
        <p data-article-kicker>The declaration</p>
        <h2>Declare modules, discover instances</h2>
        <p>
          A root <code>nativescope.config.ts</code> is where you enable each module and set behavior
          the tool cannot infer safely, such as invalidating a client-side cache layer after a Studio
          edit. You declare the modules; the storage instances behind them still discover themselves,
          so the file never becomes an inventory of your app&apos;s stores.
        </p>
        <OptionalConfigDiagram />
      </section>

      <section data-article-closer>
        <p>
          Plug-and-play is not the absence of architecture. It is architecture that accepts the
          integration cost on behalf of every person who installs the tool.
        </p>
      </section>
    </ArticleShell>
  );
}
