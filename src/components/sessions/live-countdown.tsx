"use client";

import { useEffect, useState } from "react";

import { IconClock } from "@tabler/icons-react";

import { cn } from "@/lib/utils";
import { registrationClosesLabel, registrationOpensLabel } from "@/lib/sessions";

/**
 * The scoreboard line of a card: «ثبت‌نام از … شروع می‌شه — ۱ روز و ۴ ساعت دیگر».
 *
 * The hard part is hydration, not the arithmetic. `initialNowIso` is the
 * server's `new Date().toISOString()`, captured inside the Suspense boundary,
 * and the **first** client render formats with it — so the markup React
 * hydrates is byte-identical to the markup the server sent. Only after mount
 * does the clock start moving (`new Date()` on the client), which React never
 * compares against anything.
 *
 * The WebView freezes timers while the app is backgrounded, so `visibilitychange`
 * re-syncs the label the moment Eitaa brings the mini app back — that is the
 * only reason this is a client island at all.
 *
 * Server-safe rendering, client ticking: the module is small and the label
 * itself always comes from the pure helpers in `src/lib/sessions.ts`.
 */

/** Half a minute is already generous: the labels resolve to whole minutes. */
const TICK_MS = 30_000;

export function LiveCountdown({
  targetIso,
  initialNowIso,
  variant,
  className,
}: {
  /** The deadline, as an ISO string (serializable across the RSC boundary). */
  targetIso: string;
  /** The server's "now" at render time — also the first client render's "now". */
  initialNowIso: string;
  /** ○ `opens`: registration has not started yet. ○ `closes`: it is about to end. */
  variant: "opens" | "closes";
  className?: string;
}) {
  const [nowIso, setNowIso] = useState(initialNowIso);

  useEffect(() => {
    const tick = () => setNowIso(new Date().toISOString());
    // One immediate tick: the server render may already be a few seconds old.
    tick();
    const timer = window.setInterval(tick, TICK_MS);
    document.addEventListener("visibilitychange", tick);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  const target = new Date(targetIso);
  const now = new Date(nowIso);
  const label =
    variant === "opens"
      ? registrationOpensLabel(target, now)
      : registrationClosesLabel(target, now);

  return (
    <p className={cn("flex items-start gap-1.5 text-caption text-ink-muted", className)}>
      <IconClock aria-hidden="true" className="mt-0.5 size-4 shrink-0" stroke={1.75} />
      {/* Proportional figures (§Numerals in globals.css): a "۱ روز و ۴ ساعت"
          label must not swell with the font's tabular set, and each digit keeps
          its own advance, so a new minute never re-flows the sentence. */}
      <span>{label}</span>
    </p>
  );
}
