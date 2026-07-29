import { cn } from "@/lib/cn";

/** Brand card surface. `imprint` adds the translucent 2CO watermark. */
export function Card({
  className,
  imprint = false,
  children,
}: {
  className?: string;
  imprint?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-line bg-white shadow-[var(--shadow-card)]",
        imprint && "cn-imprint",
        className,
      )}
    >
      <div className="relative z-10">{children}</div>
    </div>
  );
}

/** A titled section card. `soon` tags features arriving in a later slice. */
export function Section({
  title,
  subtitle,
  soon,
  right,
  className,
  imprint,
  children,
}: {
  title: string;
  subtitle?: string;
  soon?: boolean;
  right?: React.ReactNode;
  className?: string;
  imprint?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Card imprint={imprint} className={cn("p-6", className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-pine-700">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
        </div>
        {soon ? (
          <span className="shrink-0 rounded-full bg-sage-100 px-2.5 py-1 text-xs font-medium text-sage-700">
            Coming next
          </span>
        ) : (
          right
        )}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </Card>
  );
}
