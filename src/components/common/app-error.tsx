"use client";

import Link from "next/link";

import { useEffect } from "react";

import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";

/**
 * The one fallback every error boundary renders (phase ۸, «حالت‌های خطا»): a
 * thrown screen must never fall through to the framework's English page — inside
 * Eitaa there is no browser chrome to escape with — so the block states what
 * happened and offers the one useful action, `retry()` (Next 16's stable prop:
 * it re-fetches and re-renders the failed segment).
 *
 * The copy is fixed vocabulary, one home: same sentence on every surface,
 * «تو» voice, no apology, no error code. The mark is the red tint of a
 * destructive event (`bg-danger-soft text-danger` — the same tokens as the
 * destructive alert), never the fill yellow, which is 1.85:1 on white.
 *
 * `homeHard` is for `global-error.tsx`, which may run with a broken router
 * stack: a plain `<a>` is a hard reload and always works there.
 */
export function AppError({
  error,
  retry,
  homeHref = "/",
  homeLabel = "بازگشت به سانس‌ها",
  homeHard = false,
}: {
  /** The thrown value, forwarded by the boundary (`unknown` by design). */
  error: unknown;
  /** Next 16.3+: re-fetch and re-render the boundary's children. */
  retry: () => void;
  /** Where the secondary link leads — the surface's own home. */
  homeHref?: string;
  homeLabel?: string;
  /** Render the home link as a plain anchor (global-error only). */
  homeHard?: boolean;
}) {
  useEffect(() => {
    console.error("[screen] render failed", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center gap-6 py-10 text-center">
      <span className="flex size-16 items-center justify-center rounded-2xl bg-danger-soft text-danger">
        <IconAlertTriangle aria-hidden="true" className="size-8" stroke={1.75} />
      </span>

      <div className="flex max-w-md flex-col gap-2">
        <h1 className="text-h1 text-ink">مشکلی پیش آمد</h1>
        <p className="text-body text-ink-muted">
          یک‌بار دیگه امتحان کن — اگر باز هم همین شد، برنامک را ببند و از نو باز کن.
        </p>
      </div>

      <div className="flex flex-col items-center gap-1">
        <Button size="lg" onClick={() => retry()}>
          <IconRefresh aria-hidden="true" />
          دوباره امتحان کن
        </Button>
        {homeHard ? (
          <Button asChild variant="link">
            <a href={homeHref}>{homeLabel}</a>
          </Button>
        ) : (
          <Button asChild variant="link">
            <Link href={homeHref}>{homeLabel}</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
