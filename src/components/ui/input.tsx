import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Restyled from the nova preset to `DESIGN_SYSTEM.md` §6: 44px tall, 10px radius,
 * a *perceivable* outline (`--input` = #75817A, 4.1:1) and 16px text at every
 * breakpoint — 16px is what stops mobile browsers from zooming on focus, and
 * Persian copy must never render below 16px.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-lg border border-input bg-transparent px-3 py-2 text-base transition-colors outline-none file:inline-flex file:h-8 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-ink-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/25",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
