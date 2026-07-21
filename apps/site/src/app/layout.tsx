import type { Metadata } from "next";
import { Instrument_Sans, JetBrains_Mono } from "next/font/google";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import "./globals.css";

const sans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-site-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-site-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://nativescope.dev"),
  title: {
    default: "NativeScope — inspect your React Native app's data, live",
    template: "%s · NativeScope",
  },
  description:
    "A plug-and-play studio for inspecting and editing AsyncStorage, MMKV and SQLite while your React Native app runs. Zero config, fully local.",
  openGraph: {
    type: "website",
    siteName: "NativeScope",
    title: "NativeScope — see your React Native app's data. Live.",
    description:
      "Inspect and edit AsyncStorage, MMKV and SQLite in real time. Zero app code, fully local.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "NativeScope Studio" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "NativeScope — see your React Native app's data. Live.",
    description: "A zero-config, fully local storage studio for React Native.",
    images: ["/og.png"],
  },
};

/**
 * Roda antes da pintura para evitar flash. Fica inline de propósito:
 * qualquer alternativa pisca.
 *
 * Duas preferências viajam por aqui:
 *  - tema: a classe `dark`, que os tokens usam como variante (packages/tokens);
 *  - gerenciador de pacotes: `data-pm`, que o CSS usa para escolher qual
 *    comando de instalação aparece. Sem isto, quem escolheu bun veria npm
 *    piscar a cada navegação.
 */
const preferencesScript = `
(function () {
  var root = document.documentElement;
  try {
    var storedTheme = localStorage.getItem("nativescope-theme");
    var dark = storedTheme ? storedTheme === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (dark) root.classList.add("dark");
  } catch (e) {}
  try {
    var pm = localStorage.getItem("nativescope-pm");
    if (pm === "npm" || pm === "yarn" || pm === "pnpm" || pm === "bun") {
      root.setAttribute("data-pm", pm);
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: preferencesScript }} />
        {/* Sem JS as revelações não animam: garante que o conteúdo apareça mesmo assim. */}
        <noscript>
          <style>{`[data-reveal]{opacity:1!important;transform:none!important}`}</style>
        </noscript>
      </head>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <SiteHeader />
        <main id="main">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
