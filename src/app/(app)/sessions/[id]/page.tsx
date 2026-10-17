import { Suspense } from "react";

import { notFound } from "next/navigation";
import { connection } from "next/server";

import {
  IconBan,
  IconCash,
  IconCircleCheck,
  IconCreditCard,
  IconHourglassHigh,
  IconMapPin,
} from "@tabler/icons-react";
import Link from "next/link";

import { CancelRegistration } from "@/components/sessions/cancel-registration";
import { CapacityRail } from "@/components/sessions/capacity-rail";
import { LiveCountdown } from "@/components/sessions/live-countdown";
import { RegisterButton } from "@/components/sessions/register-button";
import { RegistrantsList } from "@/components/sessions/registrants-list";
import { RulesCard } from "@/components/sessions/rules-card";
import { StageBadge } from "@/components/sessions/stage-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser } from "@/lib/auth";
import {
  inPersonRemainderNote,
  myBalanceHint,
  seatMoneyLabel,
  seatOutstanding,
  type SeatMoney,
} from "@/lib/balance";
import { formatToman } from "@/lib/format";
import { formatDuration } from "@/lib/jalali";
import { neshanSearchUrl } from "@/lib/neshan";
import { banSentence } from "@/lib/penalties";
import {
  needsPayment,
  NOTHING_OWED_YET,
  paymentModeLabel,
  sessionFullTimeLabel,
  stageAllowsRegistration,
  stageLabel,
  waitlistPositionLabel,
  type SessionDetail,
} from "@/lib/sessions";
import { getSessionDetail } from "@/server/sessions/queries";

/**
 * Session detail — «تابلوی سانس» for one slot.
 *
 * Structure (Cache Components, `AGENTS.md`): a static shell whose single
 * `<Suspense>` streams the request-time part — cookie, session read, ban, roster.
 * Everything below the boundary is `await connection()`-gated and reads real
 * data; the skeleton keeps the same rhythm so nothing shifts when it lands.
 *
 * The screen answers one question in one scroll: *can I register, and if not,
 * why*. Exactly one primary action is rendered, decided by the state machine in
 * `RegistrationBlock` — a ban beats everything, then an existing registration
 * (confirmed or waitlisted), then the derived stage. The server action re-checks
 * every one of those conditions inside its transaction; this is presentation.
 */
export const metadata = { title: "سانس" };

/**
 * The one route that renders per request instead of shipping a prerendered shell.
 *
 * The shared chrome (`AppHeader`, `TabBar`) and the Eitaa bridge read
 * `usePathname()`, and a **dynamic** segment is the one case where the framework
 * cannot know that value while prerendering a shell: instant-navigation validation
 * fails the build with `CLIENT_HOOK_DYNAMIC` («usePathname() in a Client Component
 * outside of <Suspense>»). Wrapping the chrome in Suspense would mean rendering it
 * without an active tab / with a placeholder title on every route, so the chrome
 * stays honest and this segment opts out instead — Next's own remedy for a route
 * whose layout cannot be instant (`dist/docs/…/route-segment-config/instant.md`).
 *
 * What does *not* change: Cache Components still governs the data. Everything
 * request-time below is behind `<Suspense>` + `await connection()`, exactly as
 * `AGENTS.md` requires — the segment simply is not prerendered, so the shell is
 * flushed per request (the skeleton still reaches the user first) and a navigation
 * to it blocks until the render completes.
 */
export const instant = false;

export default function SessionPage(props: PageProps<"/sessions/[id]">) {
  return (
    <Suspense fallback={<SessionDetailSkeleton />}>
      <SessionDetailScreen params={props.params} />
    </Suspense>
  );
}

async function SessionDetailScreen({
  params,
}: {
  params: PageProps<"/sessions/[id]">["params"];
}) {
  // Marks everything below as request-time work: the shell stays prerenderable
  // while the cookie read, the session query and the clock happen per request.
  await connection();

  const { id } = await params;
  // One clock for the whole screen: the query resolves the stages and the cancel
  // verdict against it, and the live countdowns start from the same instant — so
  // nothing on the screen can disagree about what "now" is.
  const now = new Date();
  const viewer = await getCurrentUser();
  const session = await getSessionDetail(id, viewer?.id ?? null, now);
  if (!session) notFound();

  // Handed to the live countdown as an absolute instant, so the first client
  // render matches the server markup exactly and the ticking only starts when the
  // user could actually see it.
  const serverNowIso = now.toISOString();

  return (
    <div className="flex flex-col gap-6">
      <FactsCard session={session} />
      <RegistrationBlock session={session} serverNowIso={serverNowIso} />
      <CapacityBlock session={session} />
      <RulesCard rulesSentences={session.rulesSentences} />
      <RegistrantsList
        confirmed={session.confirmed}
        waitlist={session.waitlist}
        capacity={session.capacity}
        occupiedCount={session.occupiedCount}
      />
    </div>
  );
}

/** Title, hall, time and price — the four facts a player decides with. */
function FactsCard({ session }: { session: SessionDetail }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-h1 text-ink">{session.title}</h1>
          <StageBadge stage={session.stage} />
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-h3 text-ink">{session.venueName}</p>
          <p className="text-sm text-ink-muted">{session.address}</p>
          {/* Never a dead button: the manager's Neshan link wins, the venue's own
              link comes next, and the address becomes a Neshan search when both
              are empty (`src/lib/neshan.ts`). External, so a new window — the
              WebView hands it to the phone, which opens the Neshan app. */}
          <Button asChild variant="link" size="sm" className="self-start px-0">
            <a
              href={session.mapUrl ?? neshanSearchUrl(session.address)}
              target="_blank"
              rel="noreferrer"
            >
              <IconMapPin aria-hidden="true" />
              مسیریابی در نشان
            </a>
          </Button>
        </div>

        <Separator />

        <dl className="flex flex-col gap-3">
          <Fact label="زمان">
            <span className="text-body text-ink">
              {sessionFullTimeLabel(session.startsAt, session.endsAt)}
            </span>
          </Fact>
          <Fact label="مدت">
            <span className="text-body text-ink">
              {formatDuration(session.endsAt.getTime() - session.startsAt.getTime())}
            </span>
          </Fact>
          <Fact label="هزینه">
            <span className="text-numeral text-ink">{formatToman(session.priceToman)}</span>
            <span className="text-caption text-ink-muted">
              {paymentModeLabel(session.paymentMode)}
            </span>
          </Fact>
        </dl>
      </CardContent>
    </Card>
  );
}

/** One label/value pair of the facts list. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <dt className="text-caption text-ink-muted">{label}</dt>
      <dd className="flex flex-col gap-1">{children}</dd>
    </div>
  );
}

/**
 * The state machine of a session — first match wins:
 *
 * 1. an active ban → a destructive alert that says how long is left, **no** action;
 * 2. a confirmed seat → the payment state, the (mock) gateway while money is owed,
 *    and «لغو ثبت‌نام» with the rule in force at this moment (§۵.۴);
 * 3. a waitlisted seat → the position, plus that same cancel control;
 * 4. otherwise the stage decides the one primary action: «ثبت‌نام در سانس» while
 *    open, «ورود به لیست انتظار» when full, and a disabled «ثبت‌نام» with the
 *    reason spelled out for upcoming / closed / running / finished / canceled.
 *
 * There is no per-seat decision left (the owner's newest round): an approved
 * member's tap lands `CONFIRMED` — straight in the hall — which is why the only
 * two seat states below are «seat» and «queue».
 *
 * The **money** of a seat is read from the seat itself, never from the session's
 * current price (a taken seat keeps the snapshot the engine wrote,
 * `MyRegistration.amountToman`), and every sentence about it comes from
 * `src/lib/balance.ts`: the seat's own line, the hint a player with a balance
 * reads before registering, and — for a pay-in-person seat the balance already
 * paid part of — the line the player shows the manager at the door.
 *
 * The cancel verdict arrives from the query, never from the client: the free
 * window depends on the settings row *and* on this player's late-cancel history,
 * and the server action re-derives both inside its transaction. The dialog only
 * states what the engine is about to write.
 */
function RegistrationBlock({
  session,
  serverNowIso,
}: {
  session: SessionDetail;
  serverNowIso: string;
}) {
  const now = new Date(serverNowIso);
  const my = session.myRegistration;
  const cancelVerdict = my?.cancel ?? null;
  // The mock gateway only opens while the session is live: a canceled or finished
  // slot takes no money, and the server refuses it anyway.
  const payNow =
    needsPayment(session, my) && session.status === "PUBLISHED" && now < session.endsAt;

  if (session.ban) {
    return (
      <Alert variant="destructive">
        <IconBan aria-hidden="true" />
        <AlertTitle>محروم از ثبت‌نام</AlertTitle>
        <AlertDescription>
          {banSentence(session.ban.until, now)} محروم هستی — دلیل: {session.ban.reason}
        </AlertDescription>
      </Alert>
    );
  }

  if (my?.status === "CONFIRMED") {
    // The seat's own money: its price snapshot and the part the balance covered.
    // Never `session.priceToman` — a taken seat keeps the numbers it was taken
    // with, and every sentence below is the wording of `src/lib/balance.ts`.
    const money: SeatMoney = {
      amountToman: my.amountToman,
      paidFromBalance: my.paidFromBalance,
      paymentStatus: my.paymentStatus,
    };
    // The door sentence: on a pay-in-person slot whose balance already paid part
    // of the seat, the remainder is all the manager collects — the player shows
    // them this line. `null` when the balance played no part or nothing is left
    // to pay, so a settled seat never carries it.
    const doorNote =
      session.paymentMode === "IN_PERSON" ? inPersonRemainderNote(money) : null;

    return (
      <div className="flex flex-col gap-3">
        {/* §۵.۲: a seat that came off the waitlist was given, not taken — the
            alert leads with the promotion; the payment line follows either way. */}
        <Alert variant="success">
          <IconCircleCheck aria-hidden="true" />
          <AlertTitle>{my.promoted ? "از لیست انتظار دراومدی" : "ثبت‌نامت قطعی شد"}</AlertTitle>
          <AlertDescription className="flex flex-col gap-1">
            {my.promoted ? (
              <span className="text-ink">یک جا آزاد شد و ثبت‌نامت قطعی شد.</span>
            ) : null}
            <span>
              {seatMoneyLabel({
                ...money,
                registrationStatus: my.status,
                paymentMode: session.paymentMode,
              })}
            </span>
            {my.promoted && payNow ? (
              <span className="text-ink">حالا مبلغ رو پرداخت کن.</span>
            ) : null}
          </AlertDescription>
        </Alert>

        {doorNote ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-line-strong bg-surface p-3.5">
            <IconCash
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-brand-ink"
              stroke={1.75}
            />
            <p className="text-body text-ink">{doorNote}</p>
          </div>
        ) : null}

        {payNow ? (
          <Button asChild size="lg" className="w-full">
            <Link href={`/sessions/${session.id}/pay`}>
              <IconCreditCard aria-hidden="true" />
              پرداخت {formatToman(seatOutstanding(money))}
            </Link>
          </Button>
        ) : null}

        {cancelVerdict ? (
          <CancelRegistration
            sessionId={session.id}
            verdict={cancelVerdict}
            money={money}
            size="lg"
            className="w-full"
          />
        ) : null}
      </div>
    );
  }

  if (my?.status === "WAITLIST") {
    return (
      <div className="flex flex-col gap-3">
        <Alert>
          <IconHourglassHigh aria-hidden="true" />
          <AlertTitle>در لیست انتظار هستی</AlertTitle>
          <AlertDescription className="flex flex-col gap-1">
            {my.waitlistPosition !== null ? (
              <span className="text-body text-ink">
                {waitlistPositionLabel(my.waitlistPosition)}
              </span>
            ) : null}
            {/* A freed seat promotes the first waiter **straight into the hall**:
                the membership gate already vetted the person, so the queue is the
                only wait left. */}
            <span>با آزاد شدن یک جا، نوبتت می‌رسه و جات تو سانس قطعی می‌شه.</span>
            {/* §۵.۲/§۵.۳: the seat is not theirs yet, so neither is the bill —
                said on the screen too, not only in the toast that put them here. */}
            {session.paymentMode === "AT_REGISTRATION" ? (
              <span className="text-ink">{NOTHING_OWED_YET}.</span>
            ) : null}
          </AlertDescription>
        </Alert>

        {cancelVerdict ? (
          <CancelRegistration
            sessionId={session.id}
            verdict={cancelVerdict}
            money={{
              amountToman: my.amountToman,
              paidFromBalance: my.paidFromBalance,
              paymentStatus: my.paymentStatus,
            }}
            size="lg"
            variant="outline"
            className="w-full"
          />
        ) : null}
      </div>
    );
  }

  // No seat, no queue, no ban: the one action left — and, when the viewer has a
  // balance, the quiet line under it that says the balance will be spent first.
  return <NoSeatActions session={session} serverNowIso={serverNowIso} />;
}

/**
 * The no-seat area: the same stage-derived register control as before, plus the
 * one money fact a player about to register needs — `myBalanceHint` (the sentence
 * of `src/lib/balance.ts`), a quiet caption, not another card.
 *
 * The three branches are the state machine's tail, unchanged: open/full is the
 * live action, `upcoming` carries the countdown to the opening, and every other
 * stage is a disabled button that names its own reason.
 */
function NoSeatActions({
  session,
  serverNowIso,
}: {
  session: SessionDetail;
  serverNowIso: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      {stageAllowsRegistration(session.stage) ? (
        <RegisterButton
          sessionId={session.id}
          stage={session.stage}
          paymentMode={session.paymentMode}
        />
      ) : session.stage === "upcoming" ? (
        <>
          <RegisterButton
            sessionId={session.id}
            stage={session.stage}
            label="ثبت‌نام"
            paymentMode={session.paymentMode}
          />
          {/* Client island: ticks once a minute and re-syncs when Eitaa brings the
              mini app back from the background. It renders its own clock icon and
              the «ثبت‌نام از … شروع می‌شه — … دیگر» sentence. */}
          <LiveCountdown
            variant="opens"
            targetIso={session.registrationOpensAt.toISOString()}
            initialNowIso={serverNowIso}
          />
        </>
      ) : (
        // Every remaining stage has no action and one reason: the stage itself.
        <RegisterButton
          sessionId={session.id}
          stage={session.stage}
          label="ثبت‌نام"
          disabledReason={stageLabel(session.stage)}
          paymentMode={session.paymentMode}
        />
      )}

      {session.viewerBalance > 0 ? (
        <p className="text-caption text-ink-muted">{myBalanceHint(session.viewerBalance)}</p>
      ) : null}
    </div>
  );
}

/** The bench rail — the session page's fuller `md` size, with paired numbers. */
function CapacityBlock({ session }: { session: SessionDetail }) {
  return (
    <CapacityRail
      // Occupancy: the seats people hold. A waitlisted row is not in the hall —
      // it has its own line — so this is the number the stage and «ظرفیت پر» are
      // about.
      confirmed={session.occupiedCount}
      capacity={session.capacity}
      waitlist={session.waitlistCount}
      size="md"
    />
  );
}

/** Same blocks and row rhythm as the real screen, so streaming never shifts it. */
function SessionDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden="true">
      <div className="flex flex-col gap-4 rounded-xl bg-surface p-4 shadow-card">
        <div className="flex items-start justify-between gap-3">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-52" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-5 w-56" />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <Skeleton className="h-11 w-full rounded-lg" />
        <Skeleton className="h-3.5 w-full rounded-[3px]" />
        <Skeleton className="h-4 w-40" />
      </div>

      <div className="flex flex-col gap-3 rounded-xl bg-surface p-4 shadow-card">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
      </div>

      <div className="flex flex-col gap-3">
        <Skeleton className="h-6 w-44" />
        <div className="divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-card">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="flex items-center gap-3 p-4">
              <Skeleton className="size-9 rounded-full" />
              <Skeleton className="h-4 w-32" />
            </div>
          ))}
        </div>
      </div>

      <span className="sr-only">در حال بارگذاری سانس</span>
    </div>
  );
}
