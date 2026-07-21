import type { Metadata } from "next";
import { Journal } from "@/components/sections/Journal";

export const metadata: Metadata = {
  title: "Engineering journal",
  description: "The architecture and product decisions behind NativeScope.",
};

export default function JournalPage() {
  return (
    <div data-journal-page>
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
