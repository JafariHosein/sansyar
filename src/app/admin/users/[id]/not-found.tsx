import Link from "next/link";

import { IconArrowRight, IconUserX } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";

/**
 * 404 for one account: the link is old, the id was mistyped, or the row is gone.
 *
 * It lives **inside** the `/admin` layout, so the manager keeps the panel's own
 * chrome («کاربران» in the header, the section strip and the tab bar) and can walk
 * back into the list instead of hitting a dead end — the same shape as the
 * sessions and venues 404s next door.
 *
 * Fully static — no cookies, no database, no clock — so Cache Components keeps the
 * nearest shell prerenderable. The heading is an `h2`: the header already owns the
 * screen's only `h1` (DESIGN_SYSTEM.md §11).
 */
export const metadata = { title: "کاربر پیدا نشد" };

export default function AdminUserNotFound() {
  return (
    <div className="flex flex-col items-center gap-6 py-4 text-center">
      {/* A bare amber mark on the soft tint — never the fill yellow, which is
          1.85:1 on white (DESIGN_SYSTEM.md §3). */}
      <span className="flex size-16 items-center justify-center rounded-2xl bg-brand-soft text-brand-ink">
        <IconUserX aria-hidden="true" className="size-8" stroke={1.75} />
      </span>

      <div className="flex max-w-md flex-col gap-2">
        <h2 className="text-h1 text-ink">این کاربر پیدا نشد</h2>
        <p className="text-body text-ink-muted">
          شاید حسابی که دنبالش بودی حذف شده یا نشانی درست نیست؛ فهرست کاربران همیشه در دسترسه.
        </p>
      </div>

      <Button asChild size="lg">
        <Link href="/admin/users">
          <IconArrowRight aria-hidden="true" />
          بازگشت به کاربران
        </Link>
      </Button>
    </div>
  );
}
