/** @type {import("next").NextConfig} */
const nextConfig = {
  // O site lê arquivos reais do monorepo em build time (lib/snippets.ts).
  // outputFileTracingRoot evita o aviso de "lockfile em diretório pai".
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  experimental: {
    // MDX é compilado em RSC via next-mdx-remote/rsc.
    optimizePackageImports: ["lucide-react"],
  },
  images: {
    // Screenshots de UI têm texto fino: o WebP padrão (q75) borra. Liberamos
    // 95 para elas continuarem nítidas mesmo reencodadas.
    qualities: [75, 95],
  },
};

export default nextConfig;
