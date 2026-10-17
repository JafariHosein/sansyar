"use client";

import { useEffect, useState } from "react";

import { usePathname, useRouter } from "next/navigation";

import { IconPencil, IconShare } from "@tabler/icons-react";

import { CopyButton } from "@/components/common/copy-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * «اشتراک‌گذاری سانس» — the product's key ask (PROMPT.md §۱۳.۶): the manager gets a
 * ready message plus the session's deep link and drops it into an Eitaa group.
 * **The link itself is the way in** — tapping it opens the mini app on that
 * session, and on Android the same link makes Eitaa draw a «ثبت‌نام» button under
 * the message (the `btn` param; web/desktop draw none). The «دکمه» configured in
 * the EitaaYar panel stays the program's own chat card, so nothing here promises
 * a card inside the message text.
 *
 * Both strings are built **on the server** (`src/lib/share-message.ts`) and travel
 * here as plain text, so the preview, the clipboard and the message a player reads
 * are one and the same string — this component decides nothing about the wording.
 *
 * The dialog also opens by itself on the one occasion the manager expects it: right
 * after creating a session (`?created=1`, the redirect `SessionForm` pushes) or when
 * a link asks for it (`?share=1`). The query is stripped immediately with an
 * idempotent `router.replace`, so a reload never springs the dialog on the manager
 * again — the double mount React does in dev just replaces the same URL twice.
 *
 * A draft carries a warning: the link is real but a draft is invisible to players, so
 * whoever opens it lands on the board with «سانس مورد نظر پیدا نشد» — the manager has
 * to publish first, and the dialog says so instead of handing over a dead link.
 */

export function ShareSessionButton({
  text,
  message,
  link,
  draft = false,
  autoOpen = false,
}: {
  /** §۱۳.۶'s lines — what «کپی متن» copies (the CTA line rides only with a link). */
  text: string;
  /** The same text with the link on its own line — what «کپی متن + لینک» copies. */
  message: string;
  /** The session's Eitaa deep link, or `null` when the app link is not configured. */
  link: string | null;
  /** Whether the session is still invisible to players. */
  draft?: boolean;
  /** Open on mount — the `?created=1` / `?share=1` arrival. */
  autoOpen?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(autoOpen);

  useEffect(() => {
    if (!autoOpen) return;
    // `pathname` carries no query string, so this is exactly "drop the flag" — and
    // repeating it changes nothing (no one-shot guard is needed, and a guard would
    // break on React 19's double mount).
    router.replace(pathname, { scroll: false });
  }, [autoOpen, pathname, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <IconShare aria-hidden="true" />
          اشتراک‌گذاری سانس
        </Button>
      </DialogTrigger>

      {/* The ready message is long and the phone is short: the dialog scrolls
          instead of pushing its own footer out of reach. */}
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>اشتراک‌گذاری سانس</DialogTitle>
          <DialogDescription>
            این متن را در گروه یا کانال ایتا بفرست؛ هرکس روی لینکش بزند، برنامک مستقیم همین سانس
            را باز می‌کنه — روی اندروید یک دکمه‌ی «ثبت‌نام» هم زیر پیام می‌آد.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-4">
          {draft ? (
            // A bare amber mark on the brand tint — never the fill yellow.
            <p className="flex items-start gap-1.5 rounded-lg bg-brand-soft p-3 text-caption text-brand-ink">
              <IconPencil aria-hidden="true" className="mt-0.5 size-4 shrink-0" stroke={1.75} />
              <span>
                این سانس پیش‌نویسه؛ تا منتشرش نکنی این لینک بازیکن رو به سانس نمی‌بره.
              </span>
            </p>
          ) : null}

          <div className="flex flex-col gap-2">
            <span className="text-caption text-ink-muted">پیام آماده</span>
            <p className="rounded-lg bg-sunken p-3 text-sm break-words whitespace-pre-wrap text-ink">
              {text}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-caption text-ink-muted">لینک سانس</span>
            {link ? (
              // A URL is left-to-right whatever the page's direction is, and it has
              // to wrap instead of stretching the dialog. `break-all` alone is the
              // wrap: a `whitespace-nowrap` here kept the long link on one line and
              // pushed a horizontal scrollbar into the dialog (the grid track grew
              // past the phone's width).
              <p dir="ltr" className="text-caption break-all text-brand-ink">
                {link}
              </p>
            ) : (
              <p className="text-caption text-ink-muted">
                لینک برنامک هنوز تنظیم نشده — این متن بدون لینک می‌ره و بازیکن‌ها راهی به همین
                سانس ندارن.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <CopyButton
            value={text}
            label="کپی متن"
            successMessage="متن پیام کپی شد"
            variant="outline"
            size="default"
          />
          <CopyButton
            value={message}
            label="کپی متن + لینک"
            successMessage="پیام همراه لینک کپی شد"
            size="default"
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
