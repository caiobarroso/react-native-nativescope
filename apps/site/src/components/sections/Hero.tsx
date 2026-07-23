import type { LandingContent } from "@content/landing";
import Image from "next/image";
import { CheckCircle2, Github } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { HighlightedCode } from "@/components/ui/HighlightedCode";
import { NpmLogo } from "@/components/ui/NpmLogo";

/**
 * Primeira dobra. O comando de instalação é copiável de propósito — é a
 * primeira coisa que alguém avaliando a ferramenta quer.
 */
export function Hero({ content }: { content: LandingContent["hero"] }) {
  return (
    <section data-hero>
      <div data-hero-copy>
        <p data-hero-eyebrow>
          <span aria-hidden /> {content.eyebrow}
        </p>
        <h1 data-hero-title>{content.title}</h1>
        <p data-hero-subtitle>{content.subtitle}</p>

        <div data-hero-actions>
          <Button href={content.primaryCta.href} variant="primary" size="lg">
            Getting Started
          </Button>
          <Button
            href="https://github.com/caiobarroso/react-native-nativescope"
            variant="secondary"
            size="lg"
            arrow={false}
          >
            <Github size={16} aria-hidden /> {content.secondaryCta.label}
          </Button>
        </div>

        <div data-hero-install-row>
          <div data-hero-install>
            <span>$</span>
            <HighlightedCode code={content.install} language="bash" />
          </div>
          <a
            data-hero-npm
            href="https://www.npmjs.com/package/react-native-nativescope"
            target="_blank"
            rel="noreferrer noopener"
            aria-label="View react-native-nativescope on npm"
          >
            <NpmLogo size={17} /> npm
          </a>
        </div>

        <ul data-hero-assurances>
          <li>
            <CheckCircle2 size={14} aria-hidden /> Zero app code
          </li>
          <li>
            <CheckCircle2 size={14} aria-hidden /> Dev-only by design
          </li>
          <li>
            <CheckCircle2 size={14} aria-hidden /> Fully local
          </li>
        </ul>
      </div>

      <div data-hero-product aria-label="NativeScope visual JSON editor">
        <div data-product-window>
          <div data-window-bar>
            <span />
            <span />
            <span />
            <strong>NativeScope Studio</strong>
            <em>connected</em>
          </div>
          <Image
            src="/screenshots/json-visual-light.png"
            width={1280}
            height={720}
            priority
            quality={95}
            sizes="(max-width: 900px) 92vw, 680px"
            alt="NativeScope displaying a JSON value as an editable field table while storage activity updates live"
          />
        </div>
        <div data-live-note>
          <span aria-hidden />
          <div>
            <strong>Live now</strong>
            <small>AsyncStorage changed from the app</small>
          </div>
        </div>
      </div>
    </section>
  );
}
