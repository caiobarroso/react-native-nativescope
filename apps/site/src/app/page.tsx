import type { Metadata } from "next";
import { landing } from "@content/landing";
import { Hero } from "@/components/sections/Hero";
import { FeatureGrid } from "@/components/sections/FeatureGrid";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { Faq } from "@/components/sections/Faq";
import { ProductStory } from "@/components/sections/ProductStory";
import { Founder } from "@/components/sections/Founder";
import { Journal } from "@/components/sections/Journal";
import { StorageDemo } from "@/components/home/StorageDemo";
import { Reveal } from "@/components/ui/Reveal";

export const metadata: Metadata = {
  title: "NativeScope — live React Native storage debugging",
  description:
    "NativeScope is a local React Native debugging environment. The first module lets you inspect, edit, diff and restore AsyncStorage, MMKV and SQLite while your app runs.",
  openGraph: {
    type: "website",
    siteName: "NativeScope",
    title: "NativeScope — live React Native storage debugging",
    description:
      "A local React Native debugging environment. Storage ships first: AsyncStorage, MMKV and SQLite in one Studio.",
    url: "/",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "NativeScope local React Native debugging Studio",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "NativeScope — live React Native storage debugging",
    description:
      "A local React Native debugging environment. Storage ships first: AsyncStorage, MMKV and SQLite in one Studio.",
    images: ["/og.png"],
  },
};

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
      <Reveal immediate><Hero content={landing.hero} /></Reveal>
      <ProductStory />
      <Reveal><StorageDemo /></Reveal>
      <Reveal><FeatureGrid features={landing.features} /></Reveal>
      <Reveal><HowItWorks steps={landing.howItWorks} /></Reveal>
      <Reveal><Journal /></Reveal>
      <Reveal><Faq items={landing.faq} /></Reveal>
      <Reveal><Founder /></Reveal>
    </>
  );
}
