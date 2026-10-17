import { Suspense } from "react";

import { connection } from "next/server";

import {
  IconBallFootball,
  IconBan,
  IconCreditCard,
  IconPlus,
  IconShieldLock,
  IconUserCheck,
  type Icon,
} from "@tabler/icons-react";
import Link from "next/link";

import {
  MembershipQueueSections,
  MembershipQueueSkeleton,
} from "@/components/admin/membership-queue";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser } from "@/lib/auth";
import { formatCount, formatToman, toPersianDigits } from "@/lib/format";
import { formatJalaliDayMonth, formatTime } from "@/lib/jalali";
import type { DashboardStats } from "@/server/admin-dashboard";
import { getDashboardStats } from "@/server/admin-dashboard";
import { listMembershipQueue } from "@/server/sessions/queries";

export const metadata = { title: "مدیریت سالن" };

/**
 * «داشبورد» — the manager's home inside `/admin` (PROMPT.md §۶.۴).
 *
 * It answers the four questions a manager opens the panel with — «امروز چند
 * ثبت‌نام شد؟ سانس بعدی کِیه و چقدر پره؟ چقدر پول نگرفتم؟ چند نفر محرومن؟» —
 * and then shows the one queue that needs a human decision today: the membership
 * requests (oldest first) with the rejected list underneath.
 *
 * Shape (Cache Components, `AGENTS.md`): a static header row — the lead sentence
 * and «سانس جدید» — around one `<Suspense>` whose fallback keeps the tiles' and
 * the queue's rhythm. Everything request-time (the cookie, the role, the stats)
 * runs inside, after `await connection()`.
 *
 * The chrome question is settled by `AdminShell`: the section strip above and the
 * bottom tab bar below mean the dashboard never needs the messenger's BackButton
 * (the owner's rule) — hence no «بازگشت» link here any more.
 */
export default function AdminDashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="text-body text-ink-muted">
          سانس بساز، عضوها رو تأیید کن و دریافتی‌ها رو ببین.
        </p>
        <Button asChild>
          <Link href="/admin/sessions/new">
            <IconPlus aria-hidden="true" />
            سانس جدید
          </Link>
        </Button>
      </header>

      <Suspense fallback={<DashboardSkeleton />}>
        <Dashboard />
      </Suspense>
    </div>
  );
}

/** Request-time work: the viewer's role, then the numbers and the queue. */
async function Dashboard() {
  await connection();

  const viewer = await getCurrentUser();
  if (!viewer) return <DashboardSkeleton />;

  if (viewer.role !== "ADMIN") {
    return (
      <Alert variant="destructive">
        <IconShieldLock aria-hidden="true" />
        <AlertTitle>این بخش برای مدیر سالن است</AlertTitle>
        <AlertDescription>حساب تو بازیکنه، پس پنل مدیریت برات باز نمی‌شه.</AlertDescription>
      </Alert>
    );
  }

  // One clock for the whole screen: the tiles and the next-session countdown-ish
  // wording can never describe two different moments.
  const now = new Date();
  const [stats, queue] = await Promise.all([getDashboardStats(now), listMembershipQueue()]);

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="آمار سالن" className="grid auto-rows-fr grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          icon={IconUserCheck}
          label="ثبت‌نام امروز"
          value={formatCount(stats.todayRegistrations, "نفر")}
          meta="برای سانس‌های امروز"
        />
        <NextSessionTile nextSession={stats.nextSession} />
        <StatTile
          icon={IconCreditCard}
          label="دریافت‌نشده"
          value={formatToman(stats.unpaid.totalToman)}
          meta={
            stats.unpaid.count > 0
              ? `${formatCount(stats.unpaid.count, "ثبت‌نام")} در سانس‌های ۳۰ روز اخیر`
              : "همه‌چیز تسویه است"
          }
        />
        <StatTile
          icon={IconBan}
          label="محروم فعال"
          value={formatCount(stats.activeBans, "نفر")}
          meta={stats.activeBans > 0 ? "الآن نمی‌تونن ثبت‌نام کنن" : "کسی محروم نیست"}
          href="/admin/users"
        />
      </section>

      <MembershipQueueSections pending={queue.pending} rejected={queue.rejected} />
    </div>
  );
}

/** «سانس بعدی» — the one tile that answers with a place, a time and a booking. */
function NextSessionTile({ nextSession }: { nextSession: DashboardStats["nextSession"] }) {
  if (!nextSession) {
    return (
      <StatTile
        icon={IconBallFootball}
        label="سانس بعدی"
        value="—"
        meta="سانسی در پیش نیست"
        href="/admin/sessions/new"
      />
    );
  }

  return (
    <StatTile
      icon={IconBallFootball}
      label="سانس بعدی"
      value={formatTime(nextSession.startsAt)}
      caption={nextSession.title}
      meta={`${formatJalaliDayMonth(nextSession.startsAt)} · ${toPersianDigits(
        nextSession.occupiedCount,
      )} از ${toPersianDigits(nextSession.capacity)} نفر`}
      href={`/admin/sessions/${nextSession.id}`}
    />
  );
}

/**
 * One number, one name, one quiet line — and an optional destination. A tile
 * with `href` is a link (the tile *is* the affordance, so the whole surface is
 * tappable); a tile without one is plain text and never pretends otherwise.
 */
function StatTile({
  icon: TileIcon,
  label,
  value,
  caption,
  meta,
  href,
}: {
  icon: Icon;
  label: string;
  value: string;
  /** A name the tile is about (the session title) — truncated, one line. */
  caption?: string;
  /** The quiet closing line: what the number means. */
  meta?: string;
  href?: string;
}) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-caption text-ink-muted">
        <TileIcon aria-hidden="true" className="size-4" stroke={1.75} />
        {label}
      </span>
      <span className="text-h2 text-ink">{value}</span>
      {caption ? <span className="truncate text-caption text-ink">{caption}</span> : null}
      {meta ? <span className="mt-auto text-caption text-ink-muted">{meta}</span> : null}
    </>
  );

  const tileClassName =
    "flex h-full flex-col gap-1 rounded-xl bg-surface p-4 shadow-card transition-colors";

  if (!href) return <div className={tileClassName}>{body}</div>;

  return (
    <Link href={href} className={`${tileClassName} hover:bg-sunken/40 active:bg-sunken/60`}>
      {body}
    </Link>
  );
}

/**
 * Same rhythm as the real screen — four tiles, then the queue heading and two
 * rows — so streaming the dashboard never moves what is already painted.
 */
function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <span className="sr-only">در حال بارگذاری داشبورد</span>

      <div className="grid auto-rows-fr grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden="true">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="flex flex-col gap-2 rounded-xl bg-surface p-4 shadow-card">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-4 w-28" />
          </div>
        ))}
      </div>

      <MembershipQueueSkeleton />
    </div>
  );
}
