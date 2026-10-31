import Image from "next/image";

type BrandLogoProps = {
  className?: string;
  priority?: boolean;
  size?: number;
};

/** Renders the supplied Wind EDU brand artwork at the requested size. */
export function BrandLogo({ className, priority = false, size = 42 }: BrandLogoProps) {
  return (
    <Image
      alt="Wind EDU"
      className={`shrink-0 rounded-xl object-cover ${className ?? ""}`}
      height={size}
      priority={priority}
      src="/logo-web.jpg"
      width={size}
    />
  );
}
