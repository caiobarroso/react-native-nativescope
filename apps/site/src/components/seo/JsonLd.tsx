/**
 * Injeta um bloco JSON-LD no HTML servido (RSC, sem custo de client JS).
 *
 * O escape de `<` evita que um valor de dado feche o <script> por acidente
 * (defesa padrão de XSS para JSON-LD inline).
 */
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
