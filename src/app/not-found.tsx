import Link from "next/link";

import { IconBallFootball, IconRouteOff } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";

/**
 * The app's own 404 — the last non-Persian screen in Sansyar.
 *
 * Why it exists: the bridge (`EitaaRuntime`) routes a verified `start_param`
 * (`s_<sessionId>`) to `/sessions/<id>`, and that route only appears in phase 3.
 * Until then every player who taps an old session link — or mistypes any URL —
 * lands on Next's default English "404 This page could not be found".
 *
 * Two deliberate constraints:
 *  - it is **fully static**: no cookies, no headers, no database, no clock, so
 *    Cache Components keeps it prerendered (request-time values here would fail
 *    the build);
 *  - it renders in the **root layout only**, so there is no `AppShell` around it
 *    (no sticky header, no bottom tab bar) and it stays pleasant on a 375px
 *    phone inside the gate overlay.
 */
export const metadata = { title: "صفحه پیدا نشد" };

export default function NotFound() {
  return (
    <main
      id="main"
      className="app-column app-viewport pt-safe flex flex-col items-center justify-center gap-6 pb-10 text-center"
    >
      {/* A bare amber mark on the soft tint — never the fill yellow, which is
          1.85:1 on white (DESIGN_SYSTEM.md §3). */}
      <span className="flex size-16 items-center justify-center rounded-2xl bg-brand-soft text-brand-ink">
        <IconRouteOff aria-hidden="true" className="size-8" stroke={1.75} />
      </span>

      <div className="flex max-w-md flex-col gap-2">
        <h1 className="text-h1 text-ink">این صفحه پیدا نشد</h1>
        <p className="text-body text-ink-muted">
          این نشانی قدیمی یا نادرست است؛ سانس‌های باز از صفحه‌ی اصلی در دسترس‌اند.
        </p>
      </div>

      <div className="flex flex-col items-center gap-1">
        <Button asChild size="lg">
          <Link href="/">
            <IconBallFootball aria-hidden="true" />
            بازگشت به سانس‌ها
          </Link>
        </Button>
        <Button asChild variant="link">
          <Link href="/my">ثبت‌نام‌های من</Link>
        </Button>
      </div>
    </main>
  );
}
