import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/cn";

/** Full CarboNature wordmark, links to the map by default. */
export function Logo({
  className,
  href = "/",
  width = 168,
  priority = false,
}: {
  className?: string;
  href?: string | null;
  width?: number;
  priority?: boolean;
}) {
  const img = (
    <Image
      src="/brand/logo-full.png"
      alt="CarboNature"
      width={width}
      height={Math.round((width * 1755) / 8334)}
      priority={priority}
      style={{ width, height: "auto" }}
    />
  );
  if (href === null) return <span className={cn("inline-flex", className)}>{img}</span>;
  return (
    <Link href={href} className={cn("inline-flex items-center", className)} aria-label="CarboNature MRV">
      {img}
    </Link>
  );
}

/** Standalone 2CO icon (the interlocking C / O₂ mark). */
export function IconMark({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <Image
      src="/brand/icon-2co.png"
      alt=""
      width={size}
      height={size}
      className={cn("object-contain", className)}
    />
  );
}
