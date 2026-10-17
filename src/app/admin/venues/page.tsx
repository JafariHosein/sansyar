import { Suspense } from "react";

import { connection } from "next/server";

import {
  IconCircleCheck,
  IconCircleOff,
  IconMapPin,
  IconPencil,
  IconPlus,
  IconShieldLock,
} from "@tabler/icons-react";
import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser } from "@/lib/auth";
import { formatCount } from "@/lib/format";
import { listVenues } from "@/server/admin-venues";

export const metadata = { title: "مکان‌ها" };

/**
 * «مکان‌ها» — the manager's halls (PROMPT.md §۶.۴).
 *
 * The screen answers one question before any editing: *where do the sessions
 * happen, and is each place still in service?* Each row is a venue with its
 * address, its active switch state and how many sessions have ever been held
 * there; «ویرایش» opens the same form the «مکان جدید» button does.
 *
 * Shape (Cache Components, `AGENTS.md`): a static lead sentence around one
 * `<Suspense>` whose fallback keeps the list's rhythm. Everything request-time —
 * the cookie, the role, the rows — runs inside, after `await connection()`. The
 * heading row lives there too, because the «مکان جدید» button must disappear when
 * the empty state already carries the one call to action.
 *
 * Deletes are absent by design: a venue with session history cannot be erased
 * (`Session.venueId` is `onDelete: Restrict`); taking it out of service is the
 * `isActive` switch inside the form.
 */
export default function AdminVenuesPage() {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-body text-ink-muted">
        سالن‌هایی که سانس‌ها رویشان برگزار می‌شه؛ اسم و آدرسشون روی کارت هر سانس می‌آد.
      </p>

      <Suspense fallback={<VenuesSkeleton />}>
        <VenuesSection />
      </Suspense>
    </div>
  );
}

/** Request-time work: the viewer's role, then the venues and their session counts. */
async function VenuesSection() {
  await connection();

  const viewer = await getCurrentUser();
  if (!viewer) return <VenuesSkeleton />;

  if (viewer.role !== "ADMIN") {
    return (
      <Alert variant="destructive">
        <IconShieldLock aria-hidden="true" />
        <AlertTitle>این بخش برای مدیر سالن است</AlertTitle>
        <AlertDescription>حساب تو بازیکنه، پس پنل مدیریت برات باز نمی‌شه.</AlertDescription>
      </Alert>
    );
  }

  const venues = await listVenues();
  const hasVenues = venues.length > 0;

  return (
    <section aria-labelledby="venues-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h2 id="venues-heading" className="text-h2 text-ink">
            مکان‌های سالن
          </h2>
          {hasVenues ? (
            <span className="text-caption text-ink-muted">{formatCount(venues.length, "مکان")}</span>
          ) : null}
        </div>

        {hasVenues ? (
          <Button asChild>
            <Link href="/admin/venues/new">
              <IconPlus aria-hidden="true" />
              مکان جدید
            </Link>
          </Button>
        ) : null}
      </div>

      {hasVenues ? (
        <ul className="divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-card">
          {venues.map((venue) => (
            <li key={venue.id} className="flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="truncate text-h3 text-ink">{venue.name}</span>
                  {/* Colour is never the only cue: each badge carries its own word
                      and icon (DESIGN_SYSTEM.md §3). */}
                  {venue.isActive ? (
                    <Badge variant="success">
                      <IconCircleCheck aria-hidden="true" />
                      فعال
                    </Badge>
                  ) : (
                    <Badge variant="secondary">
                      <IconCircleOff aria-hidden="true" />
                      غیرفعال
                    </Badge>
                  )}
                </div>

                <Button asChild variant="outline" size="sm">
                  <Link href={`/admin/venues/${venue.id}/edit`} aria-label={`ویرایش ${venue.name}`}>
                    <IconPencil aria-hidden="true" />
                    ویرایش
                  </Link>
                </Button>
              </div>

              <p className="flex items-start gap-1.5 text-caption text-ink-muted">
                <IconMapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0" stroke={1.75} />
                <span className="min-w-0">{venue.address}</span>
              </p>

              <p className="text-caption text-ink-muted">
                {formatCount(venue.sessionCount, "سانس")} روی این مکان
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <Empty className="rounded-xl bg-surface shadow-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconMapPin aria-hidden="true" className="size-6" stroke={1.75} />
            </EmptyMedia>
            <EmptyTitle>هنوز مکانی ثبت نشده</EmptyTitle>
            <EmptyDescription>
              اولین سالنت رو اضافه کن؛ بعد از اون می‌تونی برای همین مکان سانس بسازی.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link href="/admin/venues/new">
                <IconPlus aria-hidden="true" />
                مکان جدید
              </Link>
            </Button>
          </EmptyContent>
        </Empty>
      )}
    </section>
  );
}

/** Same rhythm as the real screen: a heading row, then three venue rows. */
function VenuesSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <span className="sr-only">در حال بارگذاری مکان‌ها</span>

      <div className="flex items-center justify-between gap-3" aria-hidden="true">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-11 w-28" />
      </div>

      <div
        className="divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-card"
        aria-hidden="true"
      >
        {[0, 1, 2].map((index) => (
          <div key={index} className="flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-9 w-20" />
            </div>
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
