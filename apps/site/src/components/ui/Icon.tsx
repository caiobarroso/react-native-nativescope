import * as icons from "lucide-react";

/**
 * Resolve um nome de ícone vindo do conteúdo (content/landing.ts) para o
 * componente do lucide. Existe para que o conteúdo continue sendo dado puro,
 * sem importar React.
 *
 * Nome desconhecido não quebra a página: não renderiza nada.
 */
export function Icon({
  name,
  size = 20,
  ...rest
}: {
  name: string;
  size?: number;
} & React.SVGProps<SVGSVGElement>) {
  const Component = (icons as unknown as Record<string, React.ComponentType<never>>)[name];
  if (!Component) return null;

  const Resolved = Component as React.ComponentType<
    { size?: number } & React.SVGProps<SVGSVGElement>
  >;
  return <Resolved size={size} aria-hidden focusable={false} {...rest} />;
}
