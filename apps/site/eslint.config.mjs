import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const config = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      ".next/**",
      ".next-compare-check/**",
      "node_modules/**",
      "out/**",
      "next-env.d.ts",
      "*.tsbuildinfo",
    ],
  },
  {
    files: ["*.config.mjs"],
    rules: {
      "import/no-anonymous-default-export": "off",
    },
  },
  {
    files: ["src/components/home/JsonInspector.tsx"],
    rules: {
      "react-hooks/exhaustive-deps": "off",
    },
  },
];

export default config;
