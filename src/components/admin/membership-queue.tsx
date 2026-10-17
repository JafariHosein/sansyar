import { IconClockHour4, IconInbox, IconPhone, IconPhoneOff } from "@tabler/icons-react";
import Link from "next/link";

import { MembershipButtons } from "@/components/admin/membership-buttons";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCount } from "@/lib/format";
import { formatJalaliDayMonth, formatTime } from "@/lib/jalali";
import { formatPhoneForDisplay } from "@/lib/phone";
import type { MembershipRequest } from "@/lib/sessions";

/**
 * The manager's membership queue (the owner's round: approval is about the
 * person, once) — moved beside the dashboard it now sits on.
 *
 * Two sections, one component: the accounts **waiting** for a decision (oldest
 * first) and the accounts the manager already **rejected** — kept visible on
 * purpose, because a rejection is not final and the re-approval tap must have a
 * home. The rejected section hides itself while empty.
 *
 * The same decisions are also available per user on `/admin/users`; this stays
 * the one-tap daily surface. Server components only — `MembershipButtons` is the
 * one client piece.
 */
export function MembershipQueueSections({
  pending,
  rejected,
}: {
  pending: MembershipRequest[];
  rejected: MembershipRequest[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="membership-pending" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
          <h2
            id="membership-pending"
            className="flex flex-wrap items-baseline gap-x-2 text-h2 text-ink"
          >
            در انتظار تأیید
            {pending.length > 0 ? (
              <span className="text-caption text-ink-muted">{formatCount(pending.length, "نفر")}</span>
            ) : null}
          </h2>
          <Link
            href="/admin/users"
            className="text-caption text-brand-ink underline-offset-4 hover:underline"
          >
            همه‌ی عضوها و تصمیم‌ها
          </Link>
        </div>

        {pending.length === 0 ? (
          <QueueEmpty />
        ) : (
          // One group surface with hairline-separated rows (DESIGN_SYSTEM.md §5):
          // a queue is a list, not a stack of cards.
          <ul className="divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-card">
            {pending.map((request) => (
              <RequestRow key={request.userId} request={request} />
            ))}
          </ul>
        )}
      </section>

      {/* Hidden while empty: a section that says «کسی نیست» twice is noise. */}
      {rejected.length > 0 ? (
        <section aria-labelledby="membership-rejected" className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2
              id="membership-rejected"
              className="flex flex-wrap items-baseline gap-x-2 text-h2 text-ink"
            >
              ردشده‌ها
              <span className="text-caption text-ink-muted">
                {formatCount(rejected.length, "نفر")}
              </span>
            </h2>
            <p className="text-caption text-ink-muted">
              اگه بررسی کردی و اوکیه، تأییدشون کن — تصمیمت از تو ایتا به خودشون می‌رسه.
            </p>
          </div>

          <ul className="divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-card">
            {rejected.map((request) => (
              <RequestRow key={request.userId} request={request} allowReject={false} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/**
 * One account: **who** is asking, and the decision(s) it takes.
 *
 * The name shown is the player's real name (falling back to the display name
 * while the second first-run question is unanswered) — this is the list the
 * manager checks against a face at the door — with the Eitaa name beside it
 * whenever the two differ, so a nickname can never make a row unrecognizable. The
 * number is the manager's to dial (`tel:`) and says «شماره نداده» rather than
 * printing an empty space when the player has none. The request date is the queue
 * order, stated so the manager can see who has been waiting.
 */
function RequestRow({
  request,
  allowReject = true,
}: {
  request: MembershipRequest;
  allowReject?: boolean;
}) {
  const name = request.fullName ?? request.name;
  const showsEitaaName = request.fullName !== null && request.fullName !== request.name;

  return (
    <li className="flex flex-col gap-3 p-4">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-h3 text-ink">{name}</span>
          {showsEitaaName ? (
            <span className="text-caption text-ink-muted">نام ایتا: {request.name}</span>
          ) : null}
        </div>

        {request.phone ? (
          // The label carries the name: a bare number is a poor link name for a
          // screen reader, and «تماس با …» is exactly what the tap does.
          <a
            href={`tel:${request.phone}`}
            aria-label={`تماس با ${name} — ${formatPhoneForDisplay(request.phone)}`}
            className="inline-flex items-center gap-1 self-start text-caption text-brand-ink underline-offset-4 hover:underline"
          >
            <IconPhone aria-hidden="true" className="size-4" stroke={1.75} />
            <span dir="ltr" className="whitespace-nowrap">
              {formatPhoneForDisplay(request.phone)}
            </span>
          </a>
        ) : (
          <span className="flex items-center gap-1 text-caption text-ink-muted">
            <IconPhoneOff aria-hidden="true" className="size-4" stroke={1.75} />
            شماره نداده
          </span>
        )}
      </div>

      <p className="flex items-center gap-1 text-caption text-ink-muted">
        <IconClockHour4 aria-hidden="true" className="size-4" stroke={1.75} />
        درخواست {formatJalaliDayMonth(request.createdAt)}، ساعت {formatTime(request.createdAt)}
      </p>

      <MembershipButtons userId={request.userId} playerLabel={name} allowReject={allowReject} />
    </li>
  );
}

/** An empty queue is good news — the screen says so instead of apologising. */
function QueueEmpty() {
  return (
    <Empty className="rounded-xl bg-surface shadow-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconInbox aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>فعلاً کسی در انتظار تأیید نیست</EmptyTitle>
        <EmptyDescription>
          هر کسی که سانس‌یار رو باز کنه، درخواستش همین‌جا میاد — تصمیمت هم از تو ایتا به خودش
          می‌رسه.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/**
 * Same rhythm as the real rows — the section heading, then two rows with a name
 * line, a number line, the request line and the controls — so streaming the queue
 * never moves what is already on screen.
 */
export function MembershipQueueSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <span className="sr-only">در حال بارگذاری درخواست‌های عضویت</span>

      <div className="flex flex-col gap-3" aria-hidden="true">
        <Skeleton className="h-7 w-36" />

        <div className="divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-card">
          {[0, 1].map((index) => (
            <div key={index} className="flex flex-col gap-3 p-4">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-44" />
              <div className="flex flex-wrap gap-2">
                <Skeleton className="h-11 w-24 rounded-lg" />
                <Skeleton className="h-11 w-20 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
