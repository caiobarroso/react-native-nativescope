import { defineConfig } from "vitest/config";

// Config dedicada de testes: ambiente node (a lógica testada é pura — grouping,
// filtros, diff, correlação, export/TS). Não carrega os plugins do app (react/
// tailwind) — os testes só importam módulos .ts sem JSX.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
