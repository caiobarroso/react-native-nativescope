import { landing } from "@content/landing";
import { pageMetadata, softwareApplicationSchema, faqPageSchema } from "@/lib/seo";
import { JsonLd } from "@/components/seo/JsonLd";
import { Hero } from "@/components/sections/Hero";
import { FeatureGrid } from "@/components/sections/FeatureGrid";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { Faq } from "@/components/sections/Faq";
import { ProductStory } from "@/components/sections/ProductStory";
import { Journal } from "@/components/sections/Journal";
import { StorageDemo } from "@/components/home/StorageDemo";
import { HandsOnVideo } from "@/components/home/HandsOnVideo";
import { Reveal } from "@/components/ui/Reveal";

export const metadata = pageMetadata({
  title: "Storage — live React Native data debugging",
  description:
    "Inspect, edit, diff and restore AsyncStorage, MMKV and SQLite while your React Native app runs.",
  path: "/modules/storage",
  ogTitle: "NativeScope Storage — see your app data live",
  ogDescription: "One local Studio for AsyncStorage, MMKV and SQLite, built for real datasets.",
});

export default function StorageModulePage() {
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
      <Reveal>
        <FeatureGrid features={landing.features} />
      </Reveal>
      <Reveal>
        <HandsOnVideo />
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
    </>
  );
}
