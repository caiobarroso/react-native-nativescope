import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface DetectedProject {
  name: string;
  /** Expo ou React Native CLI — informativo por enquanto. */
  flavor: "expo" | "react-native" | "unknown";
  providers: Array<{ dependency: string; label: string }>;
}

const KNOWN_PROVIDERS: Array<{ dependency: string; label: string }> = [
  { dependency: "react-native-mmkv", label: "MMKV" },
  { dependency: "@react-native-async-storage/async-storage", label: "AsyncStorage" },
  { dependency: "expo-sqlite", label: "SQLite" },
  { dependency: "@op-engineering/op-sqlite", label: "OP-SQLite" },
];

/**
 * Rótulos para a mensagem de "nada detectado". Derivado da lista de propósito:
 * a string vivia duplicada em index.ts e envelheceu na primeira vez que a lista
 * mudou.
 */
export const KNOWN_PROVIDER_LABELS = KNOWN_PROVIDERS.map((p) => p.label).join(", ");

/**
 * Lê o package.json do projeto alvo e detecta os storages instalados.
 * Detecção de dependência ≠ detecção de instância — a segunda acontece em
 * runtime, via shim. Esta alimenta a tela de "aguardando conexão".
 */
export function detectProject(projectDir: string): DetectedProject {
  let pkg: {
    name?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  try {
    pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf8"));
  } catch {
    return { name: "project", flavor: "unknown", providers: [] };
  }

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  return {
    name: pkg.name ?? "project",
    flavor: deps["expo"] ? "expo" : deps["react-native"] ? "react-native" : "unknown",
    providers: KNOWN_PROVIDERS.filter((p) => deps[p.dependency]),
  };
}
