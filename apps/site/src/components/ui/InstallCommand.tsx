"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, Copy } from "lucide-react";
import { copyToClipboard } from "@/lib/clipboard";
import {
  DEFAULT_PACKAGE_MANAGER,
  PACKAGE_MANAGERS,
  PACKAGE_MANAGER_STORAGE_KEY,
  commandFor,
  isPackageManager,
  type PackageManager,
} from "@/lib/package-managers";

/* ------------------------------------------------------------------ *
 * Store compartilhado
 *
 * Trocar o gerenciador em UM bloco troca em TODOS, na página inteira —
 * é o comportamento que se espera de uma doc. A troca visual acontece via
 * atributo `data-pm` no <html> (o CSS decide qual comando aparece), então
 * ela é instantânea e não depende de re-render.
 *
 * O React aqui só acompanha, para `aria-pressed` e para o botão de copiar
 * saber qual texto copiar.
 * ------------------------------------------------------------------ */

const listeners = new Set<() => void>();
let current: PackageManager = DEFAULT_PACKAGE_MANAGER;
let hydrated = false;

function readFromDom(): PackageManager {
  if (typeof document === "undefined") return DEFAULT_PACKAGE_MANAGER;
  const value = document.documentElement.dataset["pm"];
  return isPackageManager(value) ? value : DEFAULT_PACKAGE_MANAGER;
}

function subscribe(listener: () => void): () => void {
  // O script inline do layout já aplicou a escolha antes da pintura; aqui só
  // trazemos o valor para o React na primeira montagem.
  if (!hydrated) {
    hydrated = true;
    current = readFromDom();
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): PackageManager {
  return current;
}

/**
 * Durante SSR e hidratação o React usa este valor, que casa com o HTML
 * renderizado no servidor — é o que evita erro de hidratação mesmo quando o
 * usuário já escolheu outro gerenciador.
 */
function getServerSnapshot(): PackageManager {
  return DEFAULT_PACKAGE_MANAGER;
}

function select(manager: PackageManager): void {
  current = manager;
  document.documentElement.dataset["pm"] = manager;
  try {
    localStorage.setItem(PACKAGE_MANAGER_STORAGE_KEY, manager);
  } catch {
    /* storage bloqueado: a escolha ainda vale nesta sessão */
  }
  for (const listener of listeners) listener();
}

export function usePackageManager(): PackageManager {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/* ------------------------------------------------------------------ */

interface InstallCommandProps {
  /** Pacote a instalar como dev dependency. */
  install?: string;
  /** Binário local a rodar, com flags. Ex.: "nativescope --port 5000". */
  run?: string;
}

function renderShellCommand(command: string) {
  return command.split(/(\s+)/).map((part, index) => {
    if (!part.trim()) return part;

    let token = "arg";
    if (index === 0) token = "command";
    else if (part.startsWith("-")) token = "flag";
    else if (part.includes("react-native-nativescope") || part === "nativescope") token = "package";

    return (
      <span key={`${part}-${index}`} data-install-token={token}>
        {part}
      </span>
    );
  });
}

/**
 * Bloco de comando com alternador npm / yarn / pnpm / bun.
 *
 *   <InstallCommand install="react-native-nativescope" />
 *   <InstallCommand run="nativescope --fake --fake-scale" />
 *
 * Os quatro comandos vão para o DOM e o CSS mostra o ativo. Isso é
 * deliberado: garante que o comando certo já esteja na tela no primeiro
 * frame, sem piscar o npm antes de trocar para a escolha salva.
 */
export function InstallCommand({ install, run }: InstallCommandProps) {
  const manager = usePackageManager();
  const [copied, setCopied] = useState(false);

  const spec = { ...(install ? { install } : {}), ...(run ? { run } : {}) };

  async function copy() {
    if (await copyToClipboard(commandFor(manager, spec))) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  }

  return (
    <div data-install-block data-code-block>
      <div data-install-bar>
        <div data-install-tabs role="group" aria-label="Package manager">
          {PACKAGE_MANAGERS.map((name) => (
            <button
              key={name}
              type="button"
              data-install-tab={name}
              aria-pressed={manager === name}
              onClick={() => select(name)}
            >
              {name}
            </button>
          ))}
        </div>

        <button
          type="button"
          data-install-copy
          data-copied={copied || undefined}
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy command"}
        >
          {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
        </button>
      </div>

      <div data-install-body>
        {PACKAGE_MANAGERS.map((name) => {
          const command = commandFor(name, spec);
          return (
            <pre key={name} data-install-cmd={name}>
              <code>{renderShellCommand(command)}</code>
            </pre>
          );
        })}
      </div>
    </div>
  );
}
