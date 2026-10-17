import { cn } from "@/lib/utils";

import { toPersianDigits } from "@/lib/format";

export type CapacityBenchProps = {
  /** Seats in the session. */
  capacity: number;
  /** Seats already taken. */
  confirmed: number;
  /** People queued behind the rail. */
  waitlisted?: number;
  size?: "sm" | "md";
  /** Render the paired text summary inside the component (recommended). */
  withLabel?: boolean;
  className?: string;
};

/**
 * `<CapacityBench>` — the signature component (DESIGN_SYSTEM.md §6).
 *
 * Not a progress bar: a segmented **bench** of `capacity` seats that fills
 * left-to-right (in an RTL document that reads right-to-left, i.e. from the
 * start edge) as people register, with a thin marker for the waitlist queue
 * behind the end of the rail.
 *
 * Filled seats use `--brand-mark` (#B57F00, ≥3:1), never the fill yellow
 * (#F5B301 is only 1.85:1 on white and fails WCAG 1.4.11 for graphical
 * objects). The rail is never colour-only: it always carries a text summary and
 * exposes `role="img"` with that same summary as its accessible name.
 */
export function CapacityBench({
  capacity,
  confirmed,
  waitlisted = 0,
  size = "md",
  withLabel = true,
  className,
}: CapacityBenchProps) {
  const total = Math.max(capacity, 0);
  const taken = Math.min(Math.max(confirmed, 0), total);
  const summary = `${toPersianDigits(taken)} از ${toPersianDigits(total)} نفر`;
  const waitlistSummary =
    waitlisted > 0 ? ` · ${toPersianDigits(waitlisted)} نفر در لیست انتظار` : "";

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div
        role="img"
        aria-label={`${summary}${waitlistSummary}`}
        className={cn("flex w-full items-center gap-1", size === "sm" ? "h-2.5" : "h-3.5")}
      >
        {Array.from({ length: total }, (_, index) => (
          <span
            key={index}
            className={cn(
              "h-full flex-1 rounded-[3px] transition-colors duration-200",
              index < taken ? "bg-brand-mark" : "bg-sunken ring-1 ring-line",
            )}
          />
        ))}
        {waitlisted > 0 ? (
          <span
            aria-hidden="true"
            className={cn("h-1.5 shrink-0 rounded-full bg-ink-muted", size === "sm" ? "w-3" : "w-4")}
          />
        ) : null}
      </div>

      {withLabel ? (
        <p className="text-caption text-ink-muted">
          <span className="text-ink">{summary}</span>
          {waitlistSummary}
        </p>
      ) : null}
    </div>
  );
}
