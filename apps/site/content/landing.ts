/**
 * CONTEÚDO DA LANDING — CONGELADO.
 *
 * A implementação de design NÃO deve editar este arquivo. Ele existe para que
 * a copy tenha um dono só e não seja reescrita sem querer durante um passe
 * visual. Componentes consomem esses dados; não os inlineiam.
 *
 * `icon` é um nome de ícone do lucide-react. O componente resolve o nome —
 * assim o conteúdo continua sendo dado puro, sem importar React.
 */

export interface Feature {
  icon: string;
  title: string;
  body: string;
}

export interface Step {
  title: string;
  body: string;
  /** Comando literal, igual em qualquer gerenciador. */
  code?: string;
  /** Pacote a instalar como dev dependency — renderiza com alternador. */
  install?: string;
  /** Binário local a rodar — renderiza com alternador. */
  run?: string;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface LandingContent {
  hero: {
    eyebrow: string;
    title: string;
    subtitle: string;
    install: string;
    primaryCta: { label: string; href: string };
    secondaryCta: { label: string; href: string };
  };
  features: Feature[];
  howItWorks: Step[];
  faq: FaqItem[];
}

export const landing: LandingContent = {
  hero: {
    eyebrow: "Open source · Runs entirely on your machine",
    title: "See your React Native app's data. Live.",
    subtitle:
      "NativeScope is a plug-and-play studio for inspecting and editing AsyncStorage, MMKV and SQLite while your app runs. No provider, root component wrapper or instance registry.",
    install: "npx nativescope",
    primaryCta: { label: "Get started", href: "/docs/quickstart" },
    secondaryCta: { label: "View on GitHub", href: "https://github.com/caiobarroso/react-native-storage-inspector" },
  },

  features: [
    {
      icon: "Zap",
      title: "Genuinely zero-config",
      body: "A Metro resolver detects AsyncStorage, MMKV and expo-sqlite on its own and instruments them in dev. You do not import anything, mount anything, or wrap anything.",
    },
    {
      icon: "ArrowLeftRight",
      title: "Bidirectional and realtime",
      body: "Edit a value in the studio and the device storage changes immediately. Write from the app and the studio shows it as it happens. Cache-backed screens use the optional one-file bridge below.",
    },
    {
      icon: "ShieldCheck",
      title: "Nothing leaves your machine",
      body: "The studio talks to your app over a local WebSocket on 127.0.0.1. There is no account, no telemetry and no cloud. Your production data stays yours.",
    },
    {
      icon: "Gauge",
      title: "Built for gigabytes",
      body: "Paged values, bounded wire messages, streamed large payloads and virtualized rendering keep the expensive work tied to what you inspect, not to an entire database.",
    },
    {
      icon: "Database",
      title: "A real SQLite client",
      body: "Browse schema, edit rows inline, run arbitrary SQL against the live database on the device, and export a table without pulling it through memory.",
    },
    {
      icon: "RefreshCw",
      title: "Keeps your cache honest",
      body: "If your screens render through React Query, one optional config file invalidates the right queries when the studio changes data, so the UI never lies.",
    },
  ],

  howItWorks: [
    {
      title: "Add it as a dev dependency",
      body: "Release builds bypass every instrumentation shim. NativeScope's CI exports a real release bundle and fails if the shim marker appears.",
      install: "react-native-nativescope",
    },
    {
      title: "Run it instead of Metro",
      body: "NativeScope starts Metro with its resolver attached, sets up the Android tunnel if a device is plugged in, and opens the studio.",
      run: "nativescope",
    },
    {
      title: "Open your app",
      body: "The moment the app connects, its storages appear in the sidebar. That is the complete setup for inspection and editing.",
    },
  ],

  faq: [
    {
      question: "Do I have to change my app code?",
      answer:
        "Not for storage discovery, inspection or editing. The Metro resolver wires up AsyncStorage, MMKV and expo-sqlite in development. Add the optional root nativescope.config.ts only when you want app-side behavior such as the update indicator or automatic React Query cache invalidation.",
    },
    {
      question: "Can this end up in a production build?",
      answer:
        "No. The Metro resolver bypasses every NativeScope shim when dev is false. The NativeScope repository also exports a real release bundle in CI and fails if the shim marker appears.",
    },
    {
      question: "Does any of my data get uploaded?",
      answer:
        "Never. The studio is a local web client that connects to your app over 127.0.0.1 with a per-session token. Data is read on the device and rendered on your machine. There is no server in between.",
    },
    {
      question: "Which storage libraries are supported?",
      answer:
        "AsyncStorage, MMKV (including multiple named instances, discovered automatically) and expo-sqlite. The adapter layer is generic, so more providers can be added without protocol changes.",
    },
    {
      question: "What happens if a value is enormous?",
      answer:
        "You still get all of it. Large values arrive as a bounded preview first so the UI stays responsive, with the complete value streamed on demand in chunks. Editing is blocked until the full value is loaded, so a preview can never overwrite real data.",
    },
    {
      question: "Does it work on a physical device?",
      answer:
        "Android devices work over an adb reverse tunnel that NativeScope sets up and keeps alive on its own. The iOS simulator works out of the box.",
    },
  ],
};
