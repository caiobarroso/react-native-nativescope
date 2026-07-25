import type { MetadataRoute } from "next";

/**
 * Web app manifest. Completa o conjunto de ícones/tema e dá nome/ícone
 * quando alguém salva o site na tela inicial. Ícones vêm dos PNGs já
 * versionados em src/app (icon.png, apple-icon.png).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NativeScope — local React Native debugging",
    short_name: "NativeScope",
    description:
      "A plug-and-play, fully local debugging environment for React Native. Inspect and edit AsyncStorage, MMKV and SQLite while your app runs.",
    start_url: "/",
    display: "standalone",
    background_color: "#faf9f5",
    theme_color: "#faf9f5",
    icons: [
      { src: "/icon.png", sizes: "128x128", type: "image/png" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
