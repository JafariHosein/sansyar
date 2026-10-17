import { Suspense, type ReactNode } from "react";

import { connection } from "next/server";

import {
  IconCalendarEvent,
  IconCalendarOff,
  IconCircleCheck,
  IconCircleX,
  IconPencil,
  IconPlus,
  IconShieldLock,
} from "@tabler/icons-react";
import Link from "next/link";

import { Pagination } from "@/components/admin/pagination";
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
import {
  parseSessionStatusFilter,
  parseSessionWhen,
  type SessionStatusFilter,
  type SessionWhen,
} from "@/lib/admin-sessions";
import { getCurrentUser } from "@/lib/auth";
import { formatCount } from "@/lib/format";
import { clampPage, parsePage } from "@/lib/pagination";
import {
  capacityLabel,
  paymentModeLabel,
  sessionFullTimeLabel,
  type SessionStatus,
} from "@/lib/sessions";
import { listAdminSessions, type AdminSessionRow } from "@/server/admin-sessions";

export const metadata = { title: "سانس‌ها" };

/**
 * «سانس‌ها» — the manager's whole schedule (PROMPT.md §۶.۴).
 *
 * Two questions one screen has to answer: *what is coming* («پیش رو», the default)
 * and *what has happened* («برگزارشده») — with the status chips narrowing either
 * one to drafts, published sessions or canceled ones.
 *
 * Shape (Cache Components, `AGENTS.md`): a static lead sentence around one
 * `<Suspense>`; the URL state, the role and the rows stream in together behind a
 * skeleton whose rhythm matches the real rows. The list **pages in the database**
 * (the owner's rule): twenty sessions and twenty thousand cost the same HTML, and
 * a stale `?page=۹` lands on the last real page.
 *
 * Every tap on a row leads to the session's own manage screen
 * (`/admin/sessions/<id>`), which owns the roster, the status change and the
 * cancellation — this list never edits anything itself.
 */
export default function AdminSessionsPage({ searchParams }: PageProps<"/admin/sessions">) {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-body text-ink-muted">
        هر سانسی که ساختی این‌جاست — پیش‌نویس‌ها تا منتشر نشدن برای بازیکن‌ها دیده نمی‌شن و
        برگزارشده‌ها برای همیشه تو تاریخچه می‌مونن.
      </p>

      {/* `searchParams` is handed down as a promise and awaited *inside* the
          boundary, so the shell above stays prerenderable. */}
      <Suspense fallback={<SessionsSkeleton />}>
        <Sessions searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

/** Request-time work: the URL state, the viewer's role, then one page of rows. */
async function Sessions({ searchParams }: Pick<PageProps<"/admin/sessions">, "searchParams">) {
  await connection();

  const params = await searchParams;
  const when = parseSessionWhen(params.when);
  const status = parseSessionStatusFilter(params.status);
  const page = parsePage(params.page);

  const viewer = await getCurrentUser();
  if (!viewer) return <SessionsSkeleton />;

  if (viewer.role !== "ADMIN") {
    return (
      <Alert variant="destructive">
        <IconShieldLock aria-hidden="true" />
        <AlertTitle>این بخش برای مدیر سالن است</AlertTitle>
        <AlertDescription>حساب تو بازیکنه، پس فهرست سانس‌ها برات باز نمی‌شه.</AlertDescription>
      </Alert>
    );
  }

  // One clock for the page: «پیش رو» و «برگزارشده» must split the same way for
  // the filter and for the rows it returns.
  const now = new Date();
  const { rows, total } = await listAdminSessions({ when, status, page, now });

  // The query clamped the page before reading the rows (`clampPage`); the pager
  // needs that same number to point at the page it is actually showing.
  const servedPage = clampPage(page, total);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="text-caption text-ink-muted">
          {total > 0 ? `${formatCount(total, "سانس")} تو این بازه` : "سانسی تو این بازه نیست"}
        </p>

        <Button asChild>
          <Link href="/admin/sessions/new">
            <IconPlus aria-hidden="true" />
            سانس جدید
          </Link>
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-caption text-ink-muted">زمان</span>
          <nav aria-label="فیلتر زمان" className="flex flex-wrap gap-2">
            {WHEN_CHIPS.map((chip) => (
              <Button
                key={chip.key}
                asChild
                size="sm"
                // The active chip is a filled state, never a colour-only cue: it
                // carries `aria-current` and the sunken fill.
                variant={chip.key === when ? "secondary" : "outline"}
              >
                <Link
                  href={sessionsHref({ when: chip.key, status })}
                  aria-current={chip.key === when ? "page" : undefined}
                >
                  {chip.label}
                </Link>
              </Button>
            ))}
          </nav>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-caption text-ink-muted">وضعیت</span>
          <nav aria-label="فیلتر وضعیت" className="flex flex-wrap gap-2">
            {STATUS_CHIPS.map((chip) => (
              <Button
                key={chip.key}
                asChild
                size="sm"
                variant={chip.key === status ? "secondary" : "outline"}
              >
                <Link
                  href={sessionsHref({ when, status: chip.key })}
                  aria-current={chip.key === status ? "page" : undefined}
                >
                  {chip.label}
                </Link>
              </Button>
            ))}
          </nav>
        </div>
      </div>

      {rows.length > 0 ? (
        // One group surface with hairline-separated rows (DESIGN_SYSTEM.md §5):
        // a schedule is a list, not a stack of cards.
        <ul className="divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-card">
          {rows.map((row) => (
            <SessionRow key={row.id} row={row} />
          ))}
        </ul>
      ) : (
        <SessionsEmpty when={when} status={status} />
      )}

      <Pagination
        page={servedPage}
        total={total}
        basePath="/admin/sessions"
        // The filters survive paging; the canonical URL omits the defaults.
        query={{
          when: when === "upcoming" ? undefined : when,
          status: status === "ALL" ? undefined : status,
        }}
        itemLabel="سانس"
      />
    </div>
  );
}

/**
 * One سانس: what it is, when it is, where it is, how full it is — and the one tap
 * that leads to its own screen.
 *
 * The row carries the **stored** status («پیش‌نویس» / «منتشرشده» / «لغوشده»), not
 * the derived stage the player screens show: the manager is looking at the record
 * they own, and «برگزار شده» about a published session would hide whether it is
 * still published at all.
 */
function SessionRow({ row }: { row: AdminSessionRow }) {
  return (
    <li className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-h3 text-ink">{row.title}</span>
          <span className="text-caption text-ink-muted">
            {sessionFullTimeLabel(row.startsAt, row.endsAt)}
          </span>
        </div>

        <StatusBadge status={row.status} />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-muted">
        <span className="min-w-0 truncate">{row.venueName}</span>
        <span aria-hidden="true">·</span>
        <span>{capacityLabel(row.occupiedCount, row.capacity)}</span>
        <span aria-hidden="true">·</span>
        <span>{paymentModeLabel(row.paymentMode)}</span>
      </div>

      <div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/admin/sessions/${row.id}`} aria-label={`مدیریت سانس ${row.title}`}>
            مدیریت
          </Link>
        </Button>
      </div>
    </li>
  );
}

/** The stored status — word **and** icon, so the state is never colour alone. */
function StatusBadge({ status }: { status: SessionStatus }) {
  switch (status) {
    case "DRAFT":
      return (
        <Badge variant="outline">
          <IconPencil aria-hidden="true" />
          {STATUS_LABELS.DRAFT}
        </Badge>
      );

    case "PUBLISHED":
      return (
        <Badge variant="success">
          <IconCircleCheck aria-hidden="true" />
          {STATUS_LABELS.PUBLISHED}
        </Badge>
      );

    case "CANCELED":
      return (
        <Badge variant="destructive">
          <IconCircleX aria-hidden="true" />
          {STATUS_LABELS.CANCELED}
        </Badge>
      );
  }
}

/**
 * Four different nothings, four different sentences: an empty filter is not an
 * empty history and neither is «هنوز سانسی نساختی». Each one offers the way out.
 */
function SessionsEmpty({ when, status }: { when: SessionWhen; status: SessionStatusFilter }) {
  if (status !== "ALL") {
    return (
      <EmptyState
        icon={<IconCalendarOff aria-hidden="true" className="size-6" stroke={1.75} />}
        title="تو این فیلتر سانسی نیست"
        description={`تو بازه‌ی «${WHEN_LABELS[when]}» هیچ سانسی با وضعیت «${STATUS_LABELS[status]}» نیست.`}
        action={
          <Button variant="outline" asChild>
            <Link href={sessionsHref({ when, status: "ALL" })}>دیدن همه‌ی سانس‌های این بازه</Link>
          </Button>
        }
      />
    );
  }

  if (when === "past") {
    return (
      <EmptyState
        icon={<IconCalendarOff aria-hidden="true" className="size-6" stroke={1.75} />}
        title="هنوز سانسی برگزار نشده"
        description="وقتی سانسی تموم بشه، از همین‌جا سابقه‌ش رو می‌بینی."
        action={
          <Button variant="outline" asChild>
            <Link href={sessionsHref({ when: "upcoming", status: "ALL" })}>سانس‌های پیش رو</Link>
          </Button>
        }
      />
    );
  }

  if (when === "all") {
    return (
      <EmptyState
        icon={<IconCalendarEvent aria-hidden="true" className="size-6" stroke={1.75} />}
        title="هنوز سانسی نساختی"
        description="اولین سانست رو بساز؛ بعد از انتشار، بازیکن‌ها می‌تونن ثبت‌نام کنن."
        action={
          <Button asChild>
            <Link href="/admin/sessions/new">
              <IconPlus aria-hidden="true" />
              سانس جدید
            </Link>
          </Button>
        }
      />
    );
  }

  return (
    <EmptyState
      icon={<IconCalendarEvent aria-hidden="true" className="size-6" stroke={1.75} />}
      title="سانسی پیش رو نیست"
      description="یا یه سانس تازه بساز، یا برگزارشده‌ها رو ببین."
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button asChild>
            <Link href="/admin/sessions/new">
              <IconPlus aria-hidden="true" />
              سانس جدید
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={sessionsHref({ when: "past", status: "ALL" })}>برگزارشده‌ها</Link>
          </Button>
        </div>
      }
    />
  );
}

/** The `Empty` composition every admin screen uses, so the states read alike. */
function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Empty className="rounded-xl bg-surface shadow-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}

/**
 * Same rhythm as the real screen — the header row, the two chip rows and three
 * rows with a title line, a badge and a facts line — so streaming never moves what
 * is already painted.
 */
function SessionsSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <span className="sr-only">در حال بارگذاری سانس‌ها</span>

      <div className="flex flex-col gap-4" aria-hidden="true">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-11 w-32 rounded-lg" />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-4 w-10" />
          {[0, 1, 2].map((chip) => (
            <Skeleton key={chip} className="h-9 w-20 rounded-lg" />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-4 w-12" />
          {[0, 1, 2, 3].map((chip) => (
            <Skeleton key={chip} className="h-9 w-20 rounded-lg" />
          ))}
        </div>

        <div className="flex flex-col divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-card">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-4 w-32" />
                </div>
                <Skeleton className="h-6 w-24 rounded-full" />
              </div>
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-9 w-20 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** What each stored status is called — the chips, the pill and the empties. */
const STATUS_LABELS: Record<SessionStatus, string> = {
  DRAFT: "پیش‌نویس",
  PUBLISHED: "منتشرشده",
  CANCELED: "لغوشده",
};

/** The three time windows, in the order the manager reads them. */
const WHEN_CHIPS: readonly { key: SessionWhen; label: string }[] = [
  { key: "upcoming", label: "پیش رو" },
  { key: "past", label: "برگزارشده" },
  { key: "all", label: "همه" },
];

/** What «پیش رو» / «برگزارشده» / «همه» means in a sentence. */
const WHEN_LABELS: Record<SessionWhen, string> = {
  upcoming: "پیش رو",
  past: "برگزارشده",
  all: "همه",
};

const STATUS_CHIPS: readonly { key: SessionStatusFilter; label: string }[] = [
  { key: "ALL", label: "همه" },
  { key: "DRAFT", label: STATUS_LABELS.DRAFT },
  { key: "PUBLISHED", label: STATUS_LABELS.PUBLISHED },
  { key: "CANCELED", label: STATUS_LABELS.CANCELED },
];

/** The URL for one filter combination; the defaults are the bare list. */
function sessionsHref({
  when,
  status,
}: {
  when: SessionWhen;
  status: SessionStatusFilter;
}): string {
  const params = new URLSearchParams();
  if (when !== "upcoming") params.set("when", when);
  if (status !== "ALL") params.set("status", status);

  const qs = params.toString();
  return qs ? `/admin/sessions?${qs}` : "/admin/sessions";
}
