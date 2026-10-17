import { Suspense } from "react";

import { connection } from "next/server";

import { IconMapPin, IconPlus, IconShieldLock } from "@tabler/icons-react";
import Link from "next/link";

import { SessionForm } from "@/components/admin/session-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import {
  defaultNewSessionValues,
  getCopyFormValues,
  listVenueChoices,
} from "@/server/admin-sessions";
import { getDefaultCancelRules } from "@/server/sessions/queries";

export const metadata = { title: "سانس جدید" };

/**
 * «سانس جدید» — the empty session form (PROMPT.md §۶.۴).
 *
 * The heading and the lead sentence are static chrome; only the role check, the
 * venue choices and the opening values wait behind `<Suspense>`, so the screen
 * paints immediately and a player who typed the URL gets the same
 * «این بخش برای مدیر سالن است» answer as every other admin screen (every action
 * re-checks too — the proxy is never the guard).
 *
 * Three ways in:
 *
 *  - plain `/admin/sessions/new` opens on the next ۲۱:۰۰ Tehran, ۹۰ minutes long
 *    and twelve seats (`defaultNewSessionValues`);
 *  - `?from=<id>` — the manage screen's «کپی» — prefills everything the source
 *    session carries with all four timestamps a week later
 *    (`getCopyFormValues`), so repeating last week's سانس is two taps;
 *  - no venue at all: the form could never be saved (`venueId` is required), so
 *    the manager gets the one card that fixes it instead of a dead form.
 */
export default function NewSessionPage({ searchParams }: PageProps<"/admin/sessions/new">) {
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="new-session-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="new-session-heading" className="text-h2 text-ink">
            سانس جدید
          </h2>
          <p className="text-body text-ink-muted">
            سانس تازه رو از همین‌جا بساز؛ تا منتشرش نکنی برای بازیکن‌ها دیده نمی‌شه.
          </p>
        </div>

        {/* `searchParams` is a promise and is awaited *inside* the boundary, so
            the chrome above stays prerenderable while the role, the choices and
            the values stream in behind this skeleton. */}
        <Suspense fallback={<SessionFormSkeleton />}>
          <NewSessionForm searchParams={searchParams} />
        </Suspense>
      </section>
    </div>
  );
}

/** Request-time work: the viewer's role, the choices, then the opening values. */
async function NewSessionForm({
  searchParams,
}: Pick<PageProps<"/admin/sessions/new">, "searchParams">) {
  await connection();

  const params = await searchParams;
  const viewer = await getCurrentUser();
  if (!viewer) return <SessionFormSkeleton />;

  if (viewer.role !== "ADMIN") {
    return (
      <Alert variant="destructive">
        <IconShieldLock aria-hidden="true" />
        <AlertTitle>این بخش برای مدیر سالن است</AlertTitle>
        <AlertDescription>حساب تو بازیکنه، پس ساخت سانس برات باز نمی‌شه.</AlertDescription>
      </Alert>
    );
  }

  // `?from=<id>` is the «کپی» prefill. A hand-typed or stale id is not an error:
  // the copy reader answers `null` and the slot opens on plain defaults instead
  // of a dead end.
  const from = typeof params.from === "string" && params.from.length > 0 ? params.from : null;
  const now = new Date();

  // One round of reads: the choices, the rules the override fields mirror, and
  // whichever opening values apply — the copy, or the brand-new defaults.
  const [venues, defaultRules, source] = await Promise.all([
    listVenueChoices(),
    getDefaultCancelRules(),
    from ? getCopyFormValues(from, now) : defaultNewSessionValues(now),
  ]);

  const initialValues = source ?? (await defaultNewSessionValues(now));

  // `venueId` is empty exactly when there is no active venue to default to (a
  // copy always carries its source's venue), and the schema refuses to save a
  // session without one. «اول یه مکان بساز» is the only useful answer.
  if (initialValues.venueId === "") {
    return <NoVenueCard hasVenues={venues.length > 0} />;
  }

  return (
    <SessionForm
      mode="create"
      initialValues={initialValues}
      venues={venues}
      defaultRules={defaultRules}
    />
  );
}

/**
 * The card that stands in for the form when no **active** venue exists.
 *
 * Two truths, two sentences: a manager with no venues at all needs to build
 * their first one; a manager whose venues are all deactivated needs to switch
 * one back on — or make a new one — and both paths stay one tap away.
 */
function NoVenueCard({ hasVenues }: { hasVenues: boolean }) {
  return (
    <Empty className="rounded-xl bg-surface shadow-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconMapPin aria-hidden="true" className="size-6" stroke={1.75} />
        </EmptyMedia>
        <EmptyTitle>{hasVenues ? "مکان فعالی نداری" : "اول یه مکان بساز"}</EmptyTitle>
        <EmptyDescription>
          {hasVenues
            ? "هر سانس روی یه مکان برگزار می‌شه و مکان‌هایی که ساختی غیرفعالن. یکی رو فعال کن یا مکان تازه بساز، بعد برگرد و سانست رو بنویس."
            : "هر سانس روی یه مکان برگزار می‌شه؛ اول سالنت رو ثبت کن، بعد برگرد و سانست رو بنویس."}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button asChild>
            <Link href="/admin/venues/new">
              <IconPlus aria-hidden="true" />
              مکان جدید
            </Link>
          </Button>

          {hasVenues ? (
            <Button variant="outline" asChild>
              <Link href="/admin/venues">مکان‌ها</Link>
            </Button>
          ) : null}
        </div>
      </EmptyContent>
    </Empty>
  );
}

/** Five field cards and the submit pair — the form's own rhythm. */
function SessionFormSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <span className="sr-only">در حال آماده‌سازی فرم سانس</span>

      <div className="flex flex-col gap-6" aria-hidden="true">
        {[0, 1, 2].map((card) => (
          <div
            key={card}
            className="flex flex-col gap-4 rounded-xl bg-surface p-4 shadow-card"
          >
            <Skeleton className="h-5 w-24" />

            <div className="flex flex-col gap-5">
              {[0, 1, 2].map((field) => (
                <div key={field} className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-11 w-full" />
                  <Skeleton className="h-3.5 w-2/3" />
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="flex flex-col gap-2 rounded-xl bg-surface p-4 shadow-card">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    </div>
  );
}
