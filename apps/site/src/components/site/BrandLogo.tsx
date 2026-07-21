import Image from "next/image";

export function BrandLogo({ priority = false }: { priority?: boolean }) {
  return (
    <span data-brand-logo aria-hidden="true">
      <Image
        src="/brand/nativescope-logo.png"
        alt=""
        width={1586}
        height={323}
        priority={priority}
        data-brand-logo-light
      />
      <Image
        src="/brand/nativescope-logo-reversed.png"
        alt=""
        width={1586}
        height={323}
        priority={priority}
        data-brand-logo-dark
      />
    </span>
  );
}
