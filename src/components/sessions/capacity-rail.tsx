import { CapacityBench } from "@/components/session/capacity-bench";
import { cn } from "@/lib/utils";
import { capacityLabel, waitlistLabel } from "@/lib/sessions";

/**
 * The capacity line a session row shows: the **bench rail** plus its paired
 * text summary.
 *
 * Why it wraps `<CapacityBench>` instead of drawing a second bar: the bench is
 * the design system's signature component (`DESIGN_SYSTEM.md` §6) — a segmented
 * rail of `capacity` seats that fills with `--brand-mark` and leaves the free
 * seats on `--sunken` + a `--line` hairline — and §6 explicitly says
 * `size="sm"` is the one used inside list rows. A second, differently-shaped
 * meter on the home screen would contradict the locked contract and give the
 * same fact two looks. So this component only owns the *label*, which is
 * derived in `src/lib/sessions.ts` so every screen phrases it identically:
 * «۸ از ۱۲ نفر» and, behind the line, «۲ نفر در لیست انتظار».
 *
 * A full session stays **full-but-calm**: the rail is entirely `--brand-mark`
 * (never red — full is an outcome, not an error), and the badge that says
 * «ظرفیت پر — لیست انتظار» sits in the row header.
 *
 * Server-safe (no `"use client"`).
 */
export function CapacityRail({
  confirmed,
  capacity,
  waitlist = 0,
  size = "sm",
  className,
}: {
  confirmed: number;
  capacity: number;
  /** People queued behind the rail; `0` renders no waitlist text. */
  waitlist?: number;
  /**
   * `sm` is the row rail on the board and `/my`; `md` is the detail screen's
   * (`DESIGN_SYSTEM.md` §6 fixes the two: list rows are small, the session page
   * is the fuller one).
   */
  size?: "sm" | "md";
  className?: string;
}) {
  // Clamp so the label can never disagree with the seats that are filled.
  const seats = Math.max(capacity, 0);
  const taken = Math.min(Math.max(confirmed, 0), seats);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <CapacityBench
        capacity={seats}
        confirmed={taken}
        waitlisted={Math.max(waitlist, 0)}
        size={size}
        withLabel={false}
      />
      <p className="text-caption text-ink-muted">
        <span className="text-ink">{capacityLabel(taken, seats)}</span>
        {waitlist > 0 ? ` · ${waitlistLabel(waitlist)}` : null}
      </p>
    </div>
  );
}
