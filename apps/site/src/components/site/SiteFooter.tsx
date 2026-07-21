import Link from "next/link";
import { BrandLogo } from "@/components/site/BrandLogo";

export function SiteFooter() {
  return (
    <footer data-site-footer>
      <div data-footer-inner>
        <div data-footer-brand>
          <div data-footer-wordmark><BrandLogo /></div>
          <p>Open source. Fully local. Your app data never leaves your machine.</p>
        </div>
        <div data-footer-columns>
          <nav aria-label="Product">
            <span>Product</span>
            <Link href="/docs">Documentation</Link>
            <Link href="/docs/quickstart">Quickstart</Link>
            <Link href="/our-goal">Our Goal</Link>
            <Link href="/compare/rozenite">Compare</Link>
          </nav>
          <nav aria-label="Resources">
            <span>Resources</span>
            <Link href="/journal">Journal</Link>
            <Link href="/docs/privacy">Privacy</Link>
            <a
              href="https://github.com/caiobarroso/react-native-storage-inspector"
              target="_blank"
              rel="noreferrer noopener"
            >
              GitHub
            </a>
          </nav>
        </div>
      </div>
      <div data-footer-baseline>
        <small>© {new Date().getFullYear()} NativeScope. Built in the open by Caio Barroso.</small>
      </div>
    </footer>
  );
}
