import { Suspense } from "react";

import { connection } from "next/server";

import {
  IconArrowUp,
  IconBallFootball,
  IconBan,
  IconCheck,
  IconCircleX,
  IconCreditCard,
  IconHourglassLow,
  IconMapPin,
} from "@tabler/icons-react";
import Link from "next/link";

import { CancelRegistration } from "@/components/sessions/cancel-registration";
import { AttendanceChip } from "@/components/sessions/attendance-chip";
import { StageBadge } from "@/components/sessions/stage-badge";
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
import { getCurrentUser } from "@/lib/auth";
import { seatMoneyLabel, seatOutstanding } from "@/lib/balance";
import { formatCount, formatToman } from "@/lib/format";
import { banSentence } from "@/lib/penalties";
import { parsePage } from "@/lib/pagination";
import {
  needsPayment,
  sessionTimeLabel,
  waitlistPositionLabel,
  type MyRegistration,
  type SessionCard as SessionCardData,
} from "@/lib/sessions";
import { getActiveBan, type ActiveBan } from "@/server/penalties";
import { listMyRegistrations } from "@/server/sessions/queries";

export const metadata = { title: "ثبت‌نام‌های من" };

/**
 * «ثبت‌نام‌های من» — the player's own ledger.
 *
 * Same shape as the home screen: static chrome, one `<Suspense>`, request-time
 * work only after `await connection()`. The shell's header already owns this
 * route's `h1`, so the screen only adds `h2` section headings.
 *
 * The list is a **roster group** — rows separated by a `--line` hairline on one
 * raised surface (`DESIGN_SYSTEM.md` §5) — not a stack of cards: these rows are
 * history and bookkeeping, and only the home board deals a card per session.
 *
 * «گذشته» is **paged** (the owner's rule: no unbounded history — `?page=`, one
 * page at a time, newest first), while «پیش رو» is naturally short. Both bounds
 * live in `listMyRegistrations`, so the screen only renders what it was handed.
 *
 * One thing sits above the groups: an active ban (PROMPT.md §۶.۳). It is read in
 * the same round trip as the ledger and rendered even when the list is empty.
 *
 * Every seat state has a row here: a confirmed seat carries the payment line (and
 * the pay link while the money is owed), a waitlisted one says it owes nothing
 * yet, a canceled one is history, and a seat that came off the waitlist keeps the
 * chip that says where it came from.
 *
 * The money line is the **seat's own** — its price snapshot and the part the
 * account's balance covered — never the session's current price, and it is written
 * by `src/lib/balance.ts` alone: «… از موجودیات کم شد · حضوری بده …» on a partly
 * covered seat, «… — لغو شد؛ به موجودیات برگشت» on a canceled one. The pay link
 * asks for the same remainder the gateway charges (`seatOutstanding`).
 */
export default function MyRegistrationsPage({ searchParams }: PageProps<"/my">) {
  return (
    <div className="flex flex-col gap-6">
      {/* `searchParams` is handed down as a promise and awaited *inside* the
          boundary (the home board's pattern), so the shell above stays
          prerenderable while the past page streams in. */}
      <Suspense fallback={<MyRegistrationsSkeleton />}>
        <MyRegistrations searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function MyRegistrations({ searchParams }: Pick<PageProps<"/my">, "searchParams">) {
  await connection();

  const { page } = await searchParams;
  const pastPage = parsePage(page);

  const viewer = await getCurrentUser();
  // Missing session handled exactly like `/profile`: the splash and the
  // "only inside Eitaa" gate are the shell's business, so this screen simply
  // keeps its own rhythm instead of inventing a redirect.
  if (!viewer) return <MyRegistrationsSkeleton />;

  // One clock for the screen: the ban sentence and the cancel verdicts below are
  // both relative to "now" and must not disagree.
  const now = new Date();

  // The ledger and the ban are one round trip: the two facts belong to the same
  // screen, so a player never reads one without the other.
  const [ledger, ban] = await Promise.all([
    listMyRegistrations(viewer.id, { now, pastPage }),
    getActiveBan(viewer.id, now),
  ]);

  const { ahead, past, pastTotal, pastPage: servedPage } = ledger;
  const isEmpty = ahead.length === 0 && pastTotal === 0;

  return (
    <div className="flex flex-col gap-6">
      {/* PROMPT.md §۶.۳: the active-ban card goes above everything — above the
          groups *and* above the empty state, so a banned player with nothing
          registered still learns why the door is shut. */}
      {ban ? <ActiveBanCard ban={ban} now={now} /> : null}

      {isEmpty ? <MyEmpty /> : null}

      {ahead.length > 0 ? (
        <section aria-labelledby="my-ahead" className="flex flex-col gap-3">
          <h2 id="my-ahead" className="text-h2 text-ink">
            پیش رو
          </h2>
          <RegistrationGroup sessions={ahead} />
        </section>
      ) : null}

      {pastTotal > 0 ? (
        <section aria-labelledby="my-past" className="flex flex-col gap-3">
          <h2
            id="my-past"
            className="flex flex-wrap items-baseline gap-x-2 text-h2 text-ink"
          >
            گذشته
            <span className="text-caption text-ink-muted">{formatCount(pastTotal, "ثبت‌نام")}</span>
          </h2>
          <RegistrationGroup sessions={past} />
          <Pagination page={servedPage} total={pastTotal} basePath="/my" itemLabel="ثبت‌نام" />
        </section>
      ) : null}
    </div>
  );
}

/**
 * The active ban — the card PROMPT.md §۶.۳ asks for at the top of this screen.
 * Same shape, icon and wording as the session page's `RegistrationBlock` ban
 * branch, so the two screens say the same thing about the same row; only the
 * second line is new here, because this screen is about the player rather than
 * one session.
 */
function ActiveBanCard({ ban, now }: { ban: ActiveBan; now: Date }) {
  return (
    <Alert variant="destructive">
      <IconBan aria-hidden="true" />
      <AlertTitle>محروم از ثبت‌نام</AlertTitle>
      <AlertDescription className="flex flex-col gap-1">
        <span>{banSentence(ban.until, now)} محروم هستی — دلیل: {ban.reason}</span>
        <span>تا پایان محرومیت نمی‌تونی تو هیچ سانسی ثبت‌نام کنی.</span>
      </AlertDescription>
    </Alert>
  );
}

/** One roster group: hairline-separated rows on a single raised surface. */
function RegistrationGroup({ sessions }: { sessions: SessionCardData[] }) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-card">
      {sessions.map((session) => (
        <MyRegistrationRow key={session.id} session={session} />
      ))}
    </ul>
  );
}

/**
 * One registration: the session first, then what *you* did about it.
 *
 * The row used to be one big `<Link>`; the actions phase ۴ adds cannot live
 * inside an anchor (a button inside a link is invalid HTML and swallows taps), so
 * the link now covers the reading part and the action row sits below it — still
 * inside the same hairline group.
 */
function MyRegistrationRow({ session }: { session: SessionCardData }) {
  const mine = session.myRegistration;
  const isPast = session.stage === "finished" || session.stage === "canceled";
  const payNow = needsPayment(session, mine);
  const cancelVerdict = mine?.cancel ?? null;

  return (
    <li className="flex flex-col gap-3 p-4">
      <Link
        href={`/sessions/${session.id}`}
        className="flex flex-col gap-3 rounded-lg transition-colors hover:bg-sunken/50 active:bg-sunken"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 text-h3 text-ink">{session.title}</h3>
          <StageBadge stage={session.stage} />
        </div>

        <div className="flex flex-col gap-1">
          <p className="text-numeral text-ink">
            {sessionTimeLabel(session.startsAt, session.endsAt)}
          </p>
          <p className="flex items-start gap-1.5 text-caption text-ink-muted">
            <IconMapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0" stroke={1.75} />
            {session.venueName}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {mine ? <RegistrationState registration={mine} /> : null}
          {isPast && mine?.status === "CONFIRMED" ? (
            // Attendance only ever exists for a seat that was really held: a
            // canceled row never reached the hall, and «ثبت نشده» on one of them
            // would read like a fault. The mark carries its minutes (§۵.۵), so a
            // lateness reads as «تاخیر ۱۰ دقیقه».
            <AttendanceChip status={mine.attendance} lateMinutes={mine.lateMinutes} />
          ) : null}
        </div>

        {mine ? (
          <p className="text-caption text-ink-muted">
            {/* The seat's own money — its price snapshot and the part the balance
                covered — never the session's current price, so a waitlisted seat
                still owes nothing («تا جات نشه پرداختی لازم نیست») and a canceled
                one says out loud where its money went (back to the balance). Every
                word here comes from `src/lib/balance.ts`. */}
            {seatMoneyLabel({
              ...mine,
              registrationStatus: mine.status,
              paymentMode: session.paymentMode,
            })}
          </p>
        ) : null}
      </Link>

      {payNow || cancelVerdict ? (
        <div className="flex flex-wrap items-center gap-2">
          {payNow && mine ? (
            <Button asChild size="sm">
              <Link href={`/sessions/${session.id}/pay`}>
                <IconCreditCard aria-hidden="true" />
                {/* What is left of *this seat* after the balance: the gateway
                    charges the same number (`seatOutstanding`). */}
                پرداخت {formatToman(seatOutstanding(mine))}
              </Link>
            </Button>
          ) : null}

          {cancelVerdict && mine ? (
            <CancelRegistration
              sessionId={session.id}
              verdict={cancelVerdict}
              money={mine}
              size="sm"
              variant="outline"
            />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * The row's seat state — one badge per status, never a silent fallback:
 * «ثبت‌نامت قطعی شد» · «در لیست انتظار» · «لغو شده». Every badge carries its word
 * **and** its icon (colour is never the only cue); the waitlist label comes from
 * `src/lib/sessions.ts`, so this ledger, the board and the session page read one
 * wording.
 */
function RegistrationState({ registration }: { registration: MyRegistration }) {
  switch (registration.status) {
    case "CONFIRMED":
      return (
        <>
          <Badge variant="success">
            <IconCheck aria-hidden="true" />
            ثبت‌نامت قطعی شد
          </Badge>
          {/* §۵.۲ — the seat was handed over automatically, so the row says where
              it came from. Only a promoted seat carries it; a fresh one clears it. */}
          {registration.promoted ? (
            <Badge variant="outline">
              <IconArrowUp aria-hidden="true" />
              از لیست انتظار دراومدی
            </Badge>
          ) : null}
        </>
      );

    case "WAITLIST":
      return (
        <>
          <Badge variant="secondary">
            <IconHourglassLow aria-hidden="true" />
            در لیست انتظار
          </Badge>
          {registration.waitlistPosition !== null ? (
            <span className="text-caption text-ink-muted">
              {waitlistPositionLabel(registration.waitlistPosition)}
            </span>
          ) : null}
        </>
      );

    case "CANCELED":
      return (
        <Badge variant="destructive">
          <IconCircleX aria-hidden="true" />
          لغو شده
        </Badge>
      );
  }
}

/** Nothing registered yet — the invitation is the screen's one primary action. */
function MyEmpty() {
  return (
    <Empty className="rounded-xl bg-surface shadow-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconBallFootball aria-hidden="true" className="size-6" stroke={1.75} />
        </EmptyMedia>
        <EmptyTitle>هنوز تو هیچ سانسی ثبت‌نام نکردی</EmptyTitle>
        <EmptyDescription>
          هر سانسی که ثبت‌نام کنی، این‌جا می‌مونه: پیش رو، گذشته و وضعیت حضورت.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild>
          <Link href="/?tab=open">دیدن سانس‌ها</Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}

/**
 * Same rhythm as the real rows: a section heading, then a group of two rows
 * whose lines match the title/badge, time, venue and state lines — so the
 * streamed data never moves what is already on screen.
 */
function MyRegistrationsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <span className="sr-only">در حال بارگذاری ثبت‌نام‌ها</span>

      <div className="flex flex-col gap-3" aria-hidden="true">
        <Skeleton className="h-7 w-16" />

        <div className="divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-card">
          {[0, 1].map((index) => (
            <div key={index} className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-6 w-24 rounded-full" />
              </div>
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-6 w-40 rounded-full" />
              <Skeleton className="h-4 w-44" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

