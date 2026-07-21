/**
 * TRADUÇÃO DE COMANDOS POR GERENCIADOR — CONGELADO.
 *
 * A doc declara a INTENÇÃO ("instalar como dev dependency", "rodar este
 * binário") e este módulo traduz para cada gerenciador. Assim um comando novo
 * nasce correto nos quatro, e não existe string de npm/yarn/pnpm/bun espalhada
 * pelo conteúdo para alguém esquecer de atualizar.
 */

export const PACKAGE_MANAGERS = ["npm", "yarn", "pnpm", "bun"] as const;

export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

/**
 * npm é o default porque é o que existe em toda máquina — quem usa outro
 * troca uma vez e a escolha persiste em todo o site.
 */
export const DEFAULT_PACKAGE_MANAGER: PackageManager = "npm";

export const PACKAGE_MANAGER_STORAGE_KEY = "nativescope-pm";

export function isPackageManager(value: unknown): value is PackageManager {
  return (
    typeof value === "string" && (PACKAGE_MANAGERS as readonly string[]).includes(value)
  );
}

/** Instalar como dev dependency. */
export function installCommand(pkg: string, manager: PackageManager): string {
  switch (manager) {
    case "npm":
      return `npm install --save-dev ${pkg}`;
    case "yarn":
      return `yarn add --dev ${pkg}`;
    case "pnpm":
      return `pnpm add -D ${pkg}`;
    case "bun":
      return `bun add --dev ${pkg}`;
  }
}

/**
 * Rodar um binário local do projeto.
 *
 * `args` já inclui o nome do binário, ex.: "nativescope --port 5000".
 */
export function runCommand(args: string, manager: PackageManager): string {
  switch (manager) {
    case "npm":
      return `npx ${args}`;
    case "yarn":
      return `yarn ${args}`;
    case "pnpm":
      return `pnpm ${args}`;
    case "bun":
      return `bunx ${args}`;
  }
}

export function commandFor(
  manager: PackageManager,
  spec: { install?: string; run?: string },
): string {
  if (spec.install) return installCommand(spec.install, manager);
  if (spec.run) return runCommand(spec.run, manager);
  throw new Error("package-managers: informe `install` ou `run`");
}
