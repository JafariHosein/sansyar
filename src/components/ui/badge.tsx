import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Slot } from "radix-ui";

/**
 * Status pills, restyled to `DESIGN_SYSTEM.md` §6: a tinted background with the
 * *darker* text of the same hue, always paired with an icon or a word so status
 * is never communicated by colour alone.
 *
 * Fixed vocabulary: `success` «در حال ثبت‌نام» · `default` «به‌زودی» ·
 * `secondary` «ظرفیت پر» · `destructive` «لغو شده».
 */
const badgeVariants = cva(
  "group/badge inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full border border-transparent px-2.5 text-caption whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/25 [&>svg]:pointer-events-none [&>svg]:size-4!",
  {
    variants: {
      variant: {
        default: "bg-brand-soft text-brand-ink [a]:hover:bg-brand-soft/70",
        success: "bg-success-soft text-success-strong [a]:hover:bg-success-soft/70",
        secondary: "bg-sunken text-ink [a]:hover:bg-sunken/70",
        destructive: "bg-danger-soft text-danger [a]:hover:bg-danger-soft/70",
        outline: "border-line-strong text-ink [a]:hover:bg-sunken",
        ghost: "text-ink-muted [a]:hover:bg-sunken",
        link: "text-brand-ink underline-offset-4 [a]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
