import Link from "next/link";

import { IconBallFootball, IconBallFootballOff } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";

/**
 * 404 for one session: the link was old, the id was mistyped, or the manager
 * deleted the session. It lives **inside** the `(app)` group, so the player keeps
 * the header and the tab bar and can walk back into the app instead of hitting a
 * dead end.
 *
 * Fully static — no cookies, no database, no clock — so Cache Components keeps
 * the nearest shell prerenderable (request-time values here would fail the build).
 */
export const metadata = { title: "سانس پیدا نشد" };

export default function SessionNotFound() {
  return (
    <div className="flex flex-col items-center gap-6 py-4 text-center">
      {/* A bare amber mark on the soft tint — never the fill yellow, which is
          1.85:1 on white (DESIGN_SYSTEM.md §3). */}
      <span className="flex size-16 items-center justify-center rounded-2xl bg-brand-soft text-brand-ink">
        <IconBallFootballOff aria-hidden="true" className="size-8" stroke={1.75} />
      </span>

      <div className="flex max-w-md flex-col gap-2">
        <h1 className="text-h1 text-ink">این سانس پیدا نشد</h1>
        <p className="text-body text-ink-muted">
          شاید حذف شده یا نشانی درست نیست؛ سانس‌های باز از صفحه‌ی اصلی در دسترس‌اند.
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
    </div>
  );
}
