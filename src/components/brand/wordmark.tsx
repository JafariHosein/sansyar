import { cn } from "@/lib/utils";

/**
 * The wordmark — the only place the brand name is rendered, so it can be swapped
 * in one edit (DESIGN_SYSTEM.md §9). Live text in Estedad 800 with a single
 * brand-yellow full stop as its mark; there is no raster logo anywhere.
 */
export function Wordmark({
  className,
  size = "md",
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const sizeClasses = {
    sm: "text-h3",
    md: "text-h2",
    lg: "text-display",
  }[size];

  const dotClasses = {
    sm: "size-1.5",
    md: "size-2",
    lg: "size-2.5",
  }[size];

  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1 font-extrabold tracking-tight text-ink",
        sizeClasses,
        className,
      )}
    >
      سانس‌یار
      <span
        aria-hidden="true"
        className={cn("translate-y-[-0.05em] rounded-full bg-brand", dotClasses)}
      />
    </span>
  );
}
