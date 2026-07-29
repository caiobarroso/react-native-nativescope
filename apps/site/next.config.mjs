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
  async redirects() {
    // As docs de Storage foram movidas de /docs/* para /docs/storage/*, seguindo
    // o mesmo namespacing do Network (/docs/network/*). Redirect permanente para
    // não quebrar links antigos e transferir SEO.
    const storageDocs = [
      "introduction",
      "quickstart",
      "devices",
      "storage-providers",
      "configuration",
      "react-query",
      "large-datasets",
      "cli",
      "api",
      "privacy",
    ];
    return [
      ...storageDocs.map((slug) => ({
        source: `/docs/${slug}`,
        destination: `/docs/storage/${slug}`,
        permanent: true,
      })),
      // A raiz de cada módulo cai na sua introdução.
      { source: "/docs/storage", destination: "/docs/storage/introduction", permanent: false },
      { source: "/docs/network", destination: "/docs/network/introduction", permanent: false },
    ];
  },
};

export default nextConfig;
