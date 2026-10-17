import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Slot } from "radix-ui";

/**
 * Restyled from the nova preset to `DESIGN_SYSTEM.md` §6:
 * - touch targets: `sm` 36px · default 44px · `lg` 52px · `icon` 44px square
 * - primary = brand yellow **with ink text** (9.0:1); white on yellow is banned
 * - destructive is a solid red fill (it is a real action, not a tint)
 * - pressed = `scale(.98)`, focus = solid 2px amber ring, disabled = 40%
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-transparent bg-clip-padding font-[650] whitespace-nowrap transition-[color,background-color,border-color,box-shadow,transform] outline-none select-none focus-visible:ring-2 focus-visible:ring-ring active:not-aria-[haspopup]:scale-[.98] disabled:pointer-events-none disabled:opacity-40 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/25 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        default: "bg-brand text-ink hover:bg-brand-hover",
        outline:
          "border-line-strong bg-surface text-ink hover:bg-sunken aria-expanded:bg-sunken",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-sunken/70 aria-expanded:bg-secondary",
        ghost: "text-ink hover:bg-sunken aria-expanded:bg-sunken",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/40",
        success:
          "bg-success text-white hover:bg-success-strong focus-visible:ring-success-strong/50",
        link: "text-brand-ink underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-4 text-button",
        xs: "h-8 gap-1.5 rounded-md px-2.5 text-xs",
        sm: "h-9 gap-1.5 px-3 text-sm",
        lg: "h-13 px-5 text-button",
        icon: "size-11",
        "icon-xs": "size-8 rounded-md",
        "icon-sm": "size-9",
        "icon-lg": "size-13",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
