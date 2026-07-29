import { pageMetadata, softwareApplicationSchema } from "@/lib/seo";
import { JsonLd } from "@/components/seo/JsonLd";
import { PlatformHome } from "@/components/home/PlatformHome";
import { Founder } from "@/components/sections/Founder";
import { Reveal } from "@/components/ui/Reveal";

export const metadata = pageMetadata({
  title: "NativeScope — local React Native debugging environment",
  description:
    "One local, modular Studio for React Native debugging. Inspect storage and understand network traffic without an account or cloud.",
  path: "/",
  ogTitle: "NativeScope — one local Studio for React Native debugging",
  ogDescription:
    "Storage and Network are live now. One package, one local Studio, zero accounts and zero cloud hops.",
});

/**
 * A landing é só composição. Todo texto vem de content/landing.ts — nada de
 * copy inline aqui, para que um passe de design não reescreva a mensagem
 * do produto sem querer.
 *
 * Cada seção entra com uma revelação suave (Reveal). ProductStory cuida das
 * próprias, por ter três seções internas.
 */
export default function HomePage() {
  return (
    <>
      <JsonLd data={softwareApplicationSchema()} />
      <Reveal immediate>
        <PlatformHome />
      </Reveal>
      <Reveal>
        <Founder />
      </Reveal>
    </>
  );
}
