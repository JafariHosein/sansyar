import { Suspense, type ReactNode } from "react";

import { connection } from "next/server";

import {
  IconBallFootballOff,
  IconCalendarEvent,
  IconCalendarTime,
  IconHistory,
} from "@tabler/icons-react";
import Link from "next/link";

import { HomeTabs, type HomeTab } from "@/components/sessions/home-tabs";
import { SessionRow } from "@/components/sessions/session-row";
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
import type { SessionCard as SessionCardData, SessionStage } from "@/lib/sessions";
import { listHomeSessions } from "@/server/sessions/queries";

export const metadata = { title: "سانس‌ها" };

/**
 * «تابلوی سانس» — the home screen.
 *
 * Shape: a **static shell** (the one `h1` this route owns, since the shell's
 * header shows the wordmark on `/`) wrapping a single `<Suspense>` whose
 * fallback mirrors the real rhythm. Everything dynamic — the cookie, the
 * viewer, the list, `new Date()` — happens inside the boundary *and* after
 * `await connection()`, which is what Cache Components requires (an uncached
 * read outside it fails the build with `blocking-prerender-current-time`).
 *
 * The three tabs are URL state (`?tab=…`), not client state: a shared link can
 * point at «به‌زودی», the back button works, and the server renders the right
 * bucket on the first byte.
 *
 * The page is valid for an anonymous request (`viewer === null`) — the "only
 * inside Eitaa" gate is a client overlay, so the screen simply renders with no
 * «تو ثبت‌نامی» marker in that pass.
 */
export default function HomePage({ searchParams }: PageProps<"/">) {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-h1 text-ink">سانس‌ها</h1>
        <p className="text-body text-ink-muted">
          ظرفیت را ببین و در سانسی که جا دارد ثبت‌نام کن.
        </p>
      </header>

      {/* `searchParams` is handed down as a promise and awaited *inside* the
          boundary, so the shell above stays prerenderable. */}
      <Suspense fallback={<HomeSessionsSkeleton />}>
        <HomeSessions searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

/** Request-time work: the tab from the URL, the viewer, then the board. */
async function HomeSessions({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  await connection();

  const { tab } = await searchParams;
  const active = parseTab(tab);

  const viewer = await getCurrentUser();
  const sessions = await listHomeSessions(viewer?.id ?? null);

  // One clock for the whole render: every countdown on the page formats against
  // the same instant, and it is the value the client hydrates with.
  const nowIso = new Date().toISOString();

  const buckets = bucketSessions(sessions);
  const counts = {
    open: buckets.open.length,
    soon: buckets.soon.length,
    past: buckets.past.length,
  };
  const listed = buckets[active];

  return (
    <div className="flex flex-col gap-4">
      <HomeTabs active={active} counts={counts} />

      {active === "past" ? (
        // The owner's rule, said out loud: the board's archive is bounded. A
        // player looking for an older سانس should know why it is not here.
        <p className="text-caption text-ink-muted">فقط سانس‌های دو هفته‌ی اخیر این‌جاست.</p>
      ) : null}

      {listed.length > 0 ? (
        /* One group surface with hairline-separated fixture lines — §5: a list
           is *a group of rows*, not a stack of individual cards. */
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-card">
          {listed.map((session) => (
            <li key={session.id}>
              <SessionRow session={session} nowIso={nowIso} />
            </li>
          ))}
        </ul>
      ) : (
        <HomeEmpty tab={active} hasAnySession={sessions.length > 0} />
      )}
    </div>
  );
}

/**
 * Empty states invite the next action instead of apologising. The open tab
 * splits in two: "nothing open right now" (so offer the upcoming bucket) is a
 * different fact from "the manager has not published anything yet".
 */
function HomeEmpty({ tab, hasAnySession }: { tab: HomeTab; hasAnySession: boolean }) {
  if (tab === "open" && hasAnySession) {
    return (
      <EmptyState
        icon={<IconBallFootballOff aria-hidden="true" className="size-6" stroke={1.75} />}
        title="الان سانسی برای ثبت‌نام نیست"
        description="سانس‌های به‌زودی را ببین؛ ثبت‌نام هر سانس سر ساعت خودش باز می‌شه."
        action={
          <Button variant="outline" asChild>
            <Link href="/?tab=soon">دیدن سانس‌های به‌زودی</Link>
          </Button>
        }
      />
    );
  }

  if (tab === "open") {
    return (
      <EmptyState
        icon={<IconCalendarEvent aria-hidden="true" className="size-6" stroke={1.75} />}
        title="سانس جدیدی منتشر نشده"
        description="به‌زودی همین‌جا منتشر می‌شه."
      />
    );
  }

  if (tab === "soon") {
    return (
      <EmptyState
        icon={<IconCalendarTime aria-hidden="true" className="size-6" stroke={1.75} />}
        title="سانسی در راه نیست"
        description="سانس‌های در حال ثبت‌نام را ببین."
        action={
          <Button variant="outline" asChild>
            <Link href="/?tab=open">دیدن سانس‌های باز</Link>
          </Button>
        }
      />
    );
  }

  return (
    <EmptyState
      icon={<IconHistory aria-hidden="true" className="size-6" stroke={1.75} />}
      title="هنوز سانسی برگزار نشده"
      description="سانس‌هایی که برگزار شدن، با وضعیت حضورت، همین‌جا میان."
    />
  );
}

/** The `Empty` composition, written once so all four states read identically. */
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
 * The skeleton mirrors the real rhythm — the tab strip, then three fixture
 * lines with the same rows in the same order (title+badge, venue, time, price,
 * bench rail) — so streaming the data never shifts the layout.
 */
function HomeSessionsSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <span className="sr-only">در حال بارگذاری سانس‌ها</span>

      <div className="flex flex-col gap-4" aria-hidden="true">
        <Skeleton className="h-13 w-full rounded-lg" />

        {/* The same group + hairline rhythm as the real rows, so nothing shifts
            when the data lands. */}
        <div className="flex flex-col divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-card">
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-4 w-28" />
                </div>
                <Skeleton className="h-6 w-24 rounded-full" />
              </div>
              <Skeleton className="h-5 w-52" />
              <Skeleton className="h-4 w-36" />
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-2.5 w-full rounded-[3px]" />
                <Skeleton className="h-4 w-24" />
              </div>
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

/**
 * `?tab=` → a real tab. Anything unknown (a typo in a shared link, a repeated
 * parameter) falls back to the open list instead of erroring.
 */
function parseTab(value: string | string[] | undefined): HomeTab {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "soon" || raw === "past" ? raw : "open";
}

/** Which bucket a stage belongs to. `draft` is in none — players never see it. */
function bucketFor(stage: SessionStage): HomeTab | null {
  if (stage === "open" || stage === "full") return "open";
  if (stage === "upcoming" || stage === "closed") return "soon";
  if (stage === "running" || stage === "finished" || stage === "canceled") return "past";
  return null;
}

/**
 * Bucket the board, then order each one the way it is actually scanned:
 * «در حال ثبت‌نام» and «به‌زودی» soonest-first (what can I join next?),
 * «گذشته» newest-first (what just happened?).
 */
function bucketSessions(sessions: SessionCardData[]): Record<HomeTab, SessionCardData[]> {
  const buckets: Record<HomeTab, SessionCardData[]> = { open: [], soon: [], past: [] };

  for (const session of sessions) {
    const tab = bucketFor(session.stage);
    if (tab) buckets[tab].push(session);
  }

  buckets.open.sort(byStartsAtAscending);
  buckets.soon.sort(byStartsAtAscending);
  buckets.past.sort(byStartsAtDescending);

  return buckets;
}

const byStartsAtAscending = (a: SessionCardData, b: SessionCardData) =>
  a.startsAt.getTime() - b.startsAt.getTime();

const byStartsAtDescending = (a: SessionCardData, b: SessionCardData) =>
  b.startsAt.getTime() - a.startsAt.getTime();
