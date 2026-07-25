import { Journal } from "@/components/sections/Journal";
import { pageMetadata, breadcrumbSchema } from "@/lib/seo";
import { JsonLd } from "@/components/seo/JsonLd";

export const metadata = pageMetadata({
  title: "Engineering journal",
  description: "The architecture and product decisions behind NativeScope.",
  path: "/journal",
});

export default function JournalPage() {
  return (
    <div data-journal-page>
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "Journal", path: "/journal" },
        ])}
      />
      <header data-page-lead>
        <p>Engineering journal</p>
        <h1>The work behind the quiet interface.</h1>
        <span>
          Performance claims should come with mechanisms. Product decisions should come with
          trade-offs. This is where NativeScope documents both.
        </span>
      </header>
      <Journal variant="index" />
    </div>
  );
}
