"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/format";

/**
 * The three buckets of the session board.
 *
 * The type lives with the control because the control also owns the reading
 * order; the home screen imports it as a type only.
 */
export type HomeTab = "open" | "soon" | "past";

/** Reading order. In an RTL document this is also the visual order (start → end). */
const TABS: readonly { key: HomeTab; label: string }[] = [
  { key: "open", label: "در حال ثبت‌نام" },
  { key: "soon", label: "به‌زودی" },
  { key: "past", label: "گذشته" },
];

/**
 * Segmented control for the board's buckets.
 *
 * The tab belongs to the URL (`?tab=…`), so the server owns it — but a tap must
 * never wait for a round trip. The tap sets a local **optimistic** tab
 * immediately and pushes the route inside a transition; the moment a render
 * arrives with a new `active` (the navigation landing, or the user going back),
 * the guess is dropped and the server value wins again.
 *
 * Each segment is its label **plus the count in a small circle beside it** (18px
 * chip, digit at `text-caption`), and the strip is only as wide
 * as its content (`w-fit` + `mx-auto`) instead of splitting the full width into
 * three equal thirds. The old full-width layout centred each pair inside a ~110px
 * segment, which left 60–70px of dead layout space around the numbers; measured
 * in the running app (375px viewport) the strip is now ~292px of content in a
 * 345px box, each chip sits 4px from its own label, and the only thing between
 * two neighbouring chips is the label of the one in the middle — no empty grid
 * track for the eye to cross. `gap-0.5` (2px) and `px-2.5` (10px) are the
 * tightest values that still read as three separate segments.
 * `flex-wrap` + `max-w-full` are the escape hatch: below ~300px a segment drops
 * to a second line instead of overflowing.
 *
 * The chip's colours are pairs already verified by `scripts/check-contrast.mjs`:
 * selected = `brand-ink` on `brand-soft` («amber text on soft brand»), rest =
 * `ink` on `surface` («body ink on card»). Amber stays the *current location*
 * accent (as in `TabBar`); the fill yellow is never a bare mark on white.
 *
 * `formatCount` keeps the count in Persian digits, and the accessible name
 * spells the unit out — a screen reader hears «در حال ثبت‌نام، ۳ سانس» rather
 * than a bare number.
 */
export function HomeTabs({
  active,
  counts,
}: {
  /** The tab the server rendered — the source of truth. */
  active: HomeTab;
  counts: Record<HomeTab, number>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  /**
   * The last tap, remembered with the tab it was made against. A guess is
   * trusted only while a navigation is in flight *and* the server still shows
   * the tab the user was looking at when they tapped — so a landed navigation,
   * a back-navigation or an unrelated transition can never leave a stale
   * highlight behind. No effect: the value is derived, never synced.
   */
  const [guess, setGuess] = useState<{ tab: HomeTab; against: HomeTab } | null>(null);
  const optimistic = pending && guess?.against === active ? guess.tab : null;
  const current = optimistic ?? active;

  return (
    <nav aria-label="بازه‌های سانس">
      <ul className="mx-auto flex w-fit max-w-full flex-wrap gap-0.5 rounded-lg bg-sunken p-1">
        {TABS.map(({ key, label }) => {
          const selected = key === current;

          return (
            <li key={key}>
              <button
                type="button"
                // A segment *is* a destination (it owns `?tab=`), so it states
                // itself the way the bottom tab bar does.
                aria-current={selected ? "page" : undefined}
                aria-label={`${label}، ${formatCount(counts[key], "سانس")}`}
                aria-busy={pending && selected ? true : undefined}
                onClick={() => {
                  if (selected) return;
                  setGuess({ tab: key, against: active });
                  startTransition(() => router.push(`/?tab=${key}`, { scroll: false }));
                }}
                className={cn(
                  "flex min-h-11 flex-wrap items-center justify-center gap-x-1 gap-y-0.5 rounded-md px-2.5 py-0.5 transition-colors",
                  selected
                    ? "bg-surface text-ink shadow-card"
                    : "text-ink-muted hover:text-ink active:bg-surface/60",
                )}
              >
                <span className="whitespace-nowrap text-caption">{label}</span>
                <span
                  className={cn(
                    "flex h-[1.125rem] min-w-[1.125rem] shrink-0 items-center justify-center rounded-full px-1 text-caption leading-none",
                    selected ? "bg-brand-soft text-brand-ink" : "bg-surface text-ink",
                  )}
                >
                  {formatCount(counts[key])}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
