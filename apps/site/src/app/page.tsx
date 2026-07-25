import { landing } from "@content/landing";
import { pageMetadata, softwareApplicationSchema, faqPageSchema } from "@/lib/seo";
import { JsonLd } from "@/components/seo/JsonLd";
import { Hero } from "@/components/sections/Hero";
import { FeatureGrid } from "@/components/sections/FeatureGrid";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { Faq } from "@/components/sections/Faq";
import { ProductStory } from "@/components/sections/ProductStory";
import { Founder } from "@/components/sections/Founder";
import { Journal } from "@/components/sections/Journal";
import { StorageDemo } from "@/components/home/StorageDemo";
import { HandsOnVideo } from "@/components/home/HandsOnVideo";
import { Reveal } from "@/components/ui/Reveal";

export const metadata = pageMetadata({
  title: "NativeScope — live React Native storage debugging",
  description:
    "NativeScope is a local React Native debugging environment. The first module lets you inspect, edit, diff and restore AsyncStorage, MMKV and SQLite while your app runs.",
  path: "/",
  ogTitle: "NativeScope — live React Native storage debugging",
  ogDescription:
    "A local React Native debugging environment. Storage ships first: AsyncStorage, MMKV and SQLite in one Studio.",
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
      <JsonLd data={faqPageSchema(landing.faq)} />
      <Reveal immediate>
        <Hero content={landing.hero} />
      </Reveal>
      <ProductStory />
      <Reveal>
        <StorageDemo />
      </Reveal>
      {/* <Reveal>
        <HandsOnVideo />
      </Reveal> */}
      <Reveal>
        <FeatureGrid features={landing.features} />
      </Reveal>
      <Reveal>
        <HowItWorks steps={landing.howItWorks} />
      </Reveal>
      <Reveal>
        <Journal />
      </Reveal>
      <Reveal>
        <Faq items={landing.faq} />
      </Reveal>
      <Reveal>
        <Founder />
      </Reveal>
    </>
  );
}
