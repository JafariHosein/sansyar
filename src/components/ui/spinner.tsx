import { IconLoader } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

/** Inline busy indicator. Announced in Persian, never as a bare English label. */
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <IconLoader
      data-slot="spinner"
      role="status"
      aria-label="در حال انجام"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
