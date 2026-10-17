import { Suspense, type ReactNode } from "react";

import { notFound } from "next/navigation";
import { connection } from "next/server";

import {
  IconBallFootball,
  IconBan,
  IconCircleCheck,
  IconClipboardCheck,
  IconCoinOff,
  IconHourglassHigh,
  IconMapPin,
  IconPencil,
  IconPhone,
  IconPhoneOff,
  IconShieldLock,
  IconUsers,
} from "@tabler/icons-react";
import Link from "next/link";

import { AttendanceCell } from "@/components/admin/attendance-cell";
import { PaymentCell } from "@/components/admin/payment-cell";
import { PromoteWaiterButton, RemoveSeatButton } from "@/components/admin/seat-controls";
import {
  CancelSessionButton,
  CloseAttendanceButton,
  SessionStatusControls,
} from "@/components/admin/session-actions";
import { ShareSessionButton } from "@/components/admin/share-session";
import { AttendanceChip } from "@/components/sessions/attendance-chip";
import { CapacityRail } from "@/components/sessions/capacity-rail";
import { LiveCountdown } from "@/components/sessions/live-countdown";
import { StageBadge } from "@/components/sessions/stage-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser } from "@/lib/auth";
import { cancelRefundToman, seatBalanceSplitLabel, type SeatMoney } from "@/lib/balance";
import { eitaaSessionLink } from "@/lib/eitaa";
import { formatCount, formatToman, toPersianDigits } from "@/lib/format";
import {
  formatDuration,
  formatJalaliDate,
  formatJalaliDayMonth,
  formatTime,
} from "@/lib/jalali";
import { neshanSearchUrl } from "@/lib/neshan";
import { formatPhoneForDisplay } from "@/lib/phone";
import { buildSessionShareMessage, sessionShareText } from "@/lib/share-message";
import {
  capacityLabel,
  paymentModeLabel,
  sessionFullTimeLabel,
  waitlistLabel,
} from "@/lib/sessions";
import {
  getAdminSessionDetail,
  type AdminSeatRow,
  type AdminSessionDetail,
} from "@/server/admin-session-detail";

/**
 * «مدیریت سانس» — one session, end to end, for the manager (PROMPT.md §۶.۴).
 *
 * The screen answers four questions in one scroll: *what is this session*, *who is
 * in*, *where is the money*, and *what ends it*. Every write it offers lives in a
 * sibling action (`admin-session-manage`, `attendance`, `admin-sessions`), each of
 * which re-checks the role and the row's state inside its own transaction — this page
 * is never the guard, it only decides what is worth showing.
 *
 * Shape (Cache Components, `AGENTS.md`): a static shell around one `<Suspense>`
 * whose fallback keeps the real rhythm, and all request-time work — the cookie, the
 * id, the query string, the database — behind `await connection()`. One clock is
 * taken here and handed to the query, the countdown and every control that reasons
 * about "now", so the stage badge can never disagree with the roster.
 *
 * Two states change the whole screen and are handled by construction rather than by
 * hiding buttons one by one:
 *
 *  - a **canceled** session is a record: no payment select, no attendance buttons, no
 *    removal — the roster is read-only history (the server would refuse every write
 *    anyway, and offering a control that can only fail is worse than not offering it);
 *  - a session that **has not started** cannot take attendance (`NOT_STARTED` in the
 *    engine), so the marks are replaced by the chips plus the reason.
 */

export const metadata = { title: "مدیریت سانس" };

/**
 * The route renders per request instead of shipping a prerendered shell: the shared
 * chrome (`AppHeader`, `TabBar`) and the Eitaa bridge read `usePathname()`, and a
 * dynamic segment has no pathname while its shell is prerendered — the build fails
 * with `CLIENT_HOOK_DYNAMIC` otherwise. `instant = false` is Next's own remedy for
 * that one validation; `<Suspense>` + `await connection()` below still govern the
 * data, and the route still streams its skeleton.
 */
export const instant = false;

export default function AdminSessionManagePage(props: PageProps<"/admin/sessions/[id]">) {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<ManageSkeleton />}>
        <ManageSession params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

async function ManageSession({
  params,
  searchParams,
}: {
  params: PageProps<"/admin/sessions/[id]">["params"];
  searchParams: PageProps<"/admin/sessions/[id]">["searchParams"];
}) {
  // Everything below is request-time: the shell above stays prerenderable.
  await connection();

  const { id } = await params;
  const query = await searchParams;

  const viewer = await getCurrentUser();
  if (!viewer) return <ManageSkeleton />;

  if (viewer.role !== "ADMIN") {
    return (
      <Alert variant="destructive">
        <IconShieldLock aria-hidden="true" />
        <AlertTitle>این بخش برای مدیر سالن است</AlertTitle>
        <AlertDescription>حساب تو بازیکنه، پس مدیریت سانس برات باز نمی‌شه.</AlertDescription>
      </Alert>
    );
  }

  // One clock for the whole screen: the stage, the countdown and the
  // attendance gate all describe the same instant.
  const now = new Date();
  const detail = await getAdminSessionDetail(id, now);
  // An old link, a mistyped id, a deleted session — the same 404 for all three.
  if (!detail) notFound();

  // The two strings the share dialog hands out, built here so the wording stays in
  // `src/lib/share-message.ts` and the browser only ever carries text.
  const link = eitaaSessionLink(detail.id);
  const shareInput = {
    title: detail.title,
    venueName: detail.venueName,
    address: detail.address,
    startsAt: detail.startsAt,
    endsAt: detail.endsAt,
    capacity: detail.capacity,
    priceToman: detail.priceToman,
    paymentMode: detail.paymentMode,
    registrationOpensAt: detail.registrationOpensAt,
    registrationClosesAt: detail.registrationClosesAt,
    link,
  };

  const canceled = detail.status === "CANCELED";
  // The engine's own gate (`src/server/attendance-core.ts`): a published session
  // that has begun. Before that, a mark answers `NOT_STARTED`.
  const attendanceOpen = detail.status === "PUBLISHED" && now.getTime() >= detail.startsAt.getTime();

  return (
    <>
      {canceled ? (
        <Alert variant="destructive">
          <IconBan aria-hidden="true" />
          <AlertTitle>این سانس لغو شده</AlertTitle>
          <AlertDescription>
            همه بدون جریمه آزاد شدن. این صفحه فقط سابقه‌ست — ثبت‌نام، پرداخت و حضور روش
            تغییر نمی‌کنه.
          </AlertDescription>
        </Alert>
      ) : null}

      <SessionFactsCard
        detail={detail}
        serverNowIso={now.toISOString()}
        shareText={sessionShareText(shareInput)}
        shareMessage={buildSessionShareMessage(shareInput)}
        link={link}
        // Right after «سانس جدید» the manager expects the share dialog; `?share=1`
        // is the same door for a link somebody sent.
        autoOpen={query.created === "1" || query.share === "1"}
      />

      <SessionStatsCard detail={detail} attendanceOpen={attendanceOpen} />

      <RosterSection detail={detail} attendanceOpen={attendanceOpen} readOnly={canceled} />

      <EndOfSessionCard detail={detail} attendanceOpen={attendanceOpen} />
    </>
  );
}

/**
 * What this session *is*: the hall, the clock, the price, how full it is, the
 * countdown that matters right now, and the three session-level actions — publish
 * (or go back to a draft), edit the whole form, and the share message (§۱۳.۶).
 */
function SessionFactsCard({
  detail,
  serverNowIso,
  shareText,
  shareMessage,
  link,
  autoOpen,
}: {
  detail: AdminSessionDetail;
  serverNowIso: string;
  shareText: string;
  shareMessage: string;
  link: string | null;
  autoOpen: boolean;
}) {
  // The countdown is about the window the manager can still act on: the one that
  // has not opened yet, or the one that is about to close. Every other stage has
  // no deadline to count — the facts line already carries the clock.
  const countdown =
    detail.stage === "upcoming"
      ? { variant: "opens" as const, targetIso: detail.registrationOpensAt.toISOString() }
      : detail.stage === "open" || detail.stage === "full"
        ? { variant: "closes" as const, targetIso: detail.registrationClosesAt.toISOString() }
        : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-col gap-1">
            {/* The header of `/admin` owns the screen's only `h1`
                (`titleForPath` → «سانس‌ها»); every heading below it is an `h2`. */}
            <h2 className="text-h2 text-ink">{detail.title}</h2>
            <p className="text-caption text-ink-muted">{detail.venueName}</p>
          </div>
          {/* The staff's own label for where this session stands right now. It also
              carries the stored status: only a draft is «پیش‌نویس» and only a
              canceled row is «لغو شده». */}
          <StageBadge stage={detail.stage} />
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-ink-muted">{detail.address}</p>
          {/* Never a dead button: the manager's Neshan link wins, the venue's own
              link comes next, and the address becomes a search when both are empty. */}
          <Button asChild variant="link" size="sm" className="self-start px-0">
            <a href={detail.mapUrl ?? neshanSearchUrl(detail.address)} target="_blank" rel="noreferrer">
              <IconMapPin aria-hidden="true" />
              مسیریابی در نشان
            </a>
          </Button>
        </div>

        <Separator />

        <dl className="flex flex-col gap-3">
          <Fact label="زمان">
            <span className="text-body text-ink">
              {sessionFullTimeLabel(detail.startsAt, detail.endsAt)}
            </span>
          </Fact>

          <Fact label="مدت">
            <span className="text-body text-ink">
              {formatDuration(detail.endsAt.getTime() - detail.startsAt.getTime())}
            </span>
          </Fact>

          <Fact label="هزینه">
            <span className="text-numeral text-ink">{formatToman(detail.priceToman)}</span>
            <span className="text-caption text-ink-muted">
              {paymentModeLabel(detail.paymentMode)}
            </span>
          </Fact>

          <Fact label="بازه‌ی ثبت‌نام">
            <span className="text-body text-ink">
              از {formatJalaliDayMonth(detail.registrationOpensAt)} ساعت{" "}
              {formatTime(detail.registrationOpensAt)} تا{" "}
              {formatJalaliDayMonth(detail.registrationClosesAt)} ساعت{" "}
              {formatTime(detail.registrationClosesAt)}
            </span>
          </Fact>
        </dl>

        <CapacityRail
          confirmed={detail.occupiedCount}
          capacity={detail.capacity}
          waitlist={detail.waitlistCount}
          size="md"
        />

        {countdown ? (
          // Client island: ticks once a minute, re-syncs when Eitaa brings the mini
          // app back, and renders from the server's own instant on the first paint.
          <LiveCountdown
            variant={countdown.variant}
            targetIso={countdown.targetIso}
            initialNowIso={serverNowIso}
          />
        ) : null}

        <Separator />

        <SessionStatusControls
          sessionId={detail.id}
          status={detail.status}
          occupiedCount={detail.occupiedCount}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <Link href={`/admin/sessions/${detail.id}/edit`}>
              <IconPencil aria-hidden="true" />
              ویرایش سانس
            </Link>
          </Button>

          {/* Hidden on a canceled session on purpose: the link would open the board
              with «سانس مورد نظر پیدا نشد», and there is nothing left to fill. */}
          {detail.status === "CANCELED" ? null : (
            <ShareSessionButton
              text={shareText}
              message={shareMessage}
              link={link}
              draft={detail.status === "DRAFT"}
              autoOpen={autoOpen}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** One label/value pair of the facts list. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <dt className="text-caption text-ink-muted">{label}</dt>
      <dd className="flex flex-col gap-1">{children}</dd>
    </div>
  );
}

/**
 * «اوضاع سانس» — four numbers the manager acts on tonight: seats held, the queue
 * behind them, the money still owed, and the marks still missing.
 *
 * Every figure comes from the one query behind this screen, so a tile and the roster
 * below it can never be two different moments. The money line is the server's own
 * `unpaidToman` — a sum over the rows' **snapshots** (`amountToman` minus what each
 * balance covered), never `count × priceToman`: a seat taken before a price edit
 * keeps its own price, so one session rarely has one price any more.
 */
function SessionStatsCard({
  detail,
  attendanceOpen,
}: {
  detail: AdminSessionDetail;
  attendanceOpen: boolean;
}) {
  const tiles: { key: string; label: string; value: string; hint?: string; icon: typeof IconBallFootball; tone: string }[] = [
    {
      key: "seats",
      label: "صندلی پر",
      value: capacityLabel(detail.occupiedCount, detail.capacity),
      icon: IconBallFootball,
      tone: "text-ink",
    },
    {
      key: "waitlist",
      label: "لیست انتظار",
      value: waitlistLabel(detail.waitlistCount),
      icon: IconHourglassHigh,
      tone: "text-ink-muted",
    },
    {
      key: "unpaid",
      label: "دریافت‌نشده",
      value:
        detail.unpaidCount === 0
          ? "تسویه شده"
          : `${formatCount(detail.unpaidCount, "صندلی")}`,
      hint: detail.unpaidCount === 0 ? undefined : formatToman(detail.unpaidToman),
      icon: IconCoinOff,
      tone: detail.unpaidCount === 0 ? "text-success-strong" : "text-ink",
    },
    {
      key: "pending",
      label: "حضور ثبت نشده",
      value: formatCount(detail.pendingAttendanceCount, "نفر"),
      hint: attendanceOpen ? "با بستن حضور و غیاب، غایب حساب می‌شن" : undefined,
      icon: IconClipboardCheck,
      tone: "text-ink",
    },
  ];

  return (
    <Card>
      <CardHeader>
        <h2 className="text-h2 text-ink">اوضاع سانس</h2>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-3">
          {tiles.map((tile) => {
            const Icon = tile.icon;

            return (
              <div key={tile.key} className="flex flex-col gap-1 rounded-lg bg-sunken p-3">
                <dt className="flex items-center gap-1.5 text-caption text-ink-muted">
                  <Icon aria-hidden="true" className={`size-4 shrink-0 ${tile.tone}`} stroke={1.75} />
                  {tile.label}
                </dt>
                <dd className="text-numeral text-ink">{tile.value}</dd>
                {tile.hint ? (
                  <span className="text-caption text-ink-muted">{tile.hint}</span>
                ) : null}
              </div>
            );
          })}
        </dl>
      </CardContent>
    </Card>
  );
}

/**
 * The roster — the people in the hall, then the queue behind them, each row carrying
 * its own three decisions (money, presence, removal).
 *
 * `waitlistLabel`/`waitlistPosition` are the very functions the player's own screens
 * use, so «نوبت ۳» here and the promotion engine's next pick are the same fact.
 */
function RosterSection({
  detail,
  attendanceOpen,
  readOnly,
}: {
  detail: AdminSessionDetail;
  attendanceOpen: boolean;
  readOnly: boolean;
}) {
  // A hint about something the rows do not offer yet is noise: a draft's empty
  // roster already says what happens once it is published, and a canceled screen
  // says it in its own banner.
  const confirmedHint = readOnly
    ? null
    : attendanceOpen
      ? "پرداخت، حضور و غیاب و حذف ثبت‌نام هر کدوم از همین ردیف‌هاست."
      : detail.confirmed.length > 0
        ? "بعد از شروع سانس می‌تونی حضور و غیاب کنی."
        : null;

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="roster-confirmed" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2
            id="roster-confirmed"
            className="flex flex-wrap items-baseline gap-x-2 text-h2 text-ink"
          >
            ثبت‌نام‌شده‌ها
            <span className="text-caption text-ink-muted">
              {capacityLabel(detail.occupiedCount, detail.capacity)}
            </span>
          </h2>
          {confirmedHint ? <p className="text-caption text-ink-muted">{confirmedHint}</p> : null}
        </div>

        {detail.confirmed.length === 0 ? (
          <RosterEmpty detail={detail} />
        ) : (
          <ol className="list-none divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-card">
            {detail.confirmed.map((seat, index) => (
              <SeatRow
                key={seat.registrationId}
                seat={seat}
                place={index + 1}
                detail={detail}
                attendanceOpen={attendanceOpen}
                readOnly={readOnly}
              />
            ))}
          </ol>
        )}
      </section>

      {detail.waitlist.length > 0 ? (
        <section aria-labelledby="roster-waitlist" className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2
              id="roster-waitlist"
              className="flex flex-wrap items-baseline gap-x-2 text-h2 text-ink"
            >
              لیست انتظار
              <span className="text-caption text-ink-muted">
                {waitlistLabel(detail.waitlistCount)}
              </span>
            </h2>
            <p className="text-caption text-ink-muted">
              حضور و غیاب فقط برای کسانیه که صندلی دارن؛ اینها هنوز تو سالن نیستن.
            </p>
          </div>

          <ol className="list-none divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-card">
            {detail.waitlist.map((seat, index) => (
              <SeatRow
                key={seat.registrationId}
                seat={seat}
                place={index + 1}
                detail={detail}
                attendanceOpen={attendanceOpen}
                readOnly={readOnly}
              />
            ))}
          </ol>
        </section>
      ) : null}

      {detail.canceledCount > 0 ? (
        // History is a count, not a list: a manager reading tonight's board does not
        // need the rows, but must not silently see a smaller roster either.
        <p className="text-caption text-ink-muted">
          {formatCount(detail.canceledCount, "نفر")} این سانس رو لغو کردن — تو این فهرست نیستن.
        </p>
      ) : null}
    </div>
  );
}

/** One person on the board: who they are, what they owe, and what is left to decide. */
function SeatRow({
  seat,
  place,
  detail,
  attendanceOpen,
  readOnly,
}: {
  seat: AdminSeatRow;
  /** The 1-based place in its own list — the roster's reading order. */
  place: number;
  detail: AdminSessionDetail;
  attendanceOpen: boolean;
  readOnly: boolean;
}) {
  const name = seat.fullName ?? seat.name;
  const holdsSeat = seat.status === "CONFIRMED";
  // The seat's own money in one object: the split line, the payment cell and the
  // refund the removal dialog promises all read these three columns (never the
  // session's price today).
  const money: SeatMoney = {
    amountToman: seat.amountToman,
    paidFromBalance: seat.paidFromBalance,
    paymentStatus: seat.paymentStatus,
  };
  const splitLabel = seatBalanceSplitLabel(money);

  return (
    <li className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        {/* The circle carries the row's place, not an initial — a roster is read to
            find *who is where*. The `<ol>` above already announces the ordinal. */}
        <Avatar className="size-9" aria-hidden="true">
          <AvatarFallback className="bg-brand-soft text-numeral text-brand-ink">
            {toPersianDigits(place)}
          </AvatarFallback>
        </Avatar>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-body text-ink">{name}</span>
            {seat.waitlistPosition !== null ? (
              <Badge variant="outline">نوبت {toPersianDigits(seat.waitlistPosition)}</Badge>
            ) : null}
            {seat.promoted ? (
              <Badge variant="secondary">
                <IconHourglassHigh aria-hidden="true" />
                از لیست انتظار
              </Badge>
            ) : null}
          </span>

          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink-muted">
            {seat.phone ? (
              // Manager-only data, and a real action: one tap dials. The label
              // carries the name because a bare number is a poor link name.
              <a
                href={`tel:${seat.phone}`}
                aria-label={`تماس با ${name} — ${formatPhoneForDisplay(seat.phone)}`}
                className="inline-flex items-center gap-1 text-brand-ink underline-offset-4 hover:underline"
              >
                <IconPhone aria-hidden="true" className="size-4 shrink-0" stroke={1.75} />
                <span dir="ltr" className="whitespace-nowrap">
                  {formatPhoneForDisplay(seat.phone)}
                </span>
              </a>
            ) : (
              <span className="flex items-center gap-1">
                <IconPhoneOff aria-hidden="true" className="size-4 shrink-0" stroke={1.75} />
                شماره نداده
              </span>
            )}
            <span aria-hidden="true">·</span>
            <span>ثبت‌نام {formatJalaliDate(seat.createdAt)}</span>
            {seat.fullName !== null && seat.fullName !== seat.name ? (
              <>
                <span aria-hidden="true">·</span>
                <span>نام ایتا: {seat.name}</span>
              </>
            ) : null}
          </span>
        </div>
      </div>

      {readOnly ? (
        // What is left of a canceled session: whether the money had been settled
        // (only the paid half is said out loud — a canceled seat owes nothing, so
        // «پرداخت نشده» would be a lie), what the balance covered, and how the night
        // went for whoever showed up. The payment cell is not rendered here, so this
        // branch owns the split line.
        <div className="flex flex-wrap items-center gap-2">
          {seat.paid ? (
            <Badge variant="success">
              <IconCircleCheck aria-hidden="true" />
              پرداخت شده
            </Badge>
          ) : null}
          {splitLabel ? <span className="text-caption text-ink-muted">{splitLabel}</span> : null}
          {seat.attendance !== "PENDING" ? (
            <AttendanceChip status={seat.attendance} lateMinutes={seat.lateMinutes} />
          ) : null}
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <ControlGroup label="وضعیت پرداخت">
              {/* Keyed by the server's own value: after a write lands and the page
                  re-reads, the local state is rebuilt from the truth. The cell owns
                  the split line of the balance money on an editable row. */}
              <PaymentCell
                key={`pay:${seat.registrationId}:${seat.paymentStatus}`}
                registrationId={seat.registrationId}
                paymentStatus={seat.paymentStatus}
                amountToman={seat.amountToman}
                paidFromBalance={seat.paidFromBalance}
                paymentMode={detail.paymentMode}
                playerLabel={name}
              />
            </ControlGroup>

            {holdsSeat ? (
              <ControlGroup label="حضور و غیاب">
                {attendanceOpen ? (
                  <AttendanceCell
                    key={`att:${seat.registrationId}:${seat.attendance}:${seat.lateMinutes ?? ""}`}
                    registrationId={seat.registrationId}
                    attendance={seat.attendance}
                    lateMinutes={seat.lateMinutes}
                    lateThresholdMinutes={detail.rules.lateThresholdMinutes}
                    lateStrikeWindowDays={detail.rules.lateStrikeWindowDays}
                    playerLabel={name}
                  />
                ) : (
                  <AttendanceChip status={seat.attendance} lateMinutes={seat.lateMinutes} />
                )}
              </ControlGroup>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {holdsSeat ? null : (
              <PromoteWaiterButton registrationId={seat.registrationId} playerLabel={name} />
            )}
            <RemoveSeatButton
              registrationId={seat.registrationId}
              playerLabel={name}
              seatKind={seat.status}
              money={money}
            />
          </div>
        </>
      )}
    </li>
  );
}

/** One labelled control block inside a roster row. */
function ControlGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-sunken p-3">
      <span className="text-caption text-ink-muted">{label}</span>
      {children}
    </div>
  );
}

/** The three different nothings a roster can be: a draft, a cancel, or a fresh slot. */
function RosterEmpty({ detail }: { detail: AdminSessionDetail }) {
  const copy =
    detail.status === "CANCELED"
      ? detail.canceledCount > 0
        ? {
            // A canceled session whose seats were released: the count line below the
            // roster names them, so the empty state must not claim nobody existed.
            title: "کسی تو فهرست نمونده",
            description: "هر کی ثبت‌نام کرده بود لغو شده — چه خودش، چه با لغو کل سانس.",
          }
        : {
            title: "کسی تو این سانس ثبت‌نام نکرده بود",
            description: "قبل از اینکه کسی جاش بشه لغو شد؛ چیزی برای آزاد کردن نبود.",
          }
      : detail.status === "DRAFT"
        ? {
            title: "این سانس پیش‌نویسه",
            description: "تا منتشرش نکنی کسی نمی‌بینش؛ بعد از انتشار، ثبت‌نام‌ها همین‌جا می‌آن.",
          }
        : {
            title: "هنوز کسی ثبت‌نام نکرده",
            description: "بعد از فرستادن پیام اشتراک‌گذاری، هر نفر با شماره‌اش همین‌جا اضافه می‌شه.",
          };

  return (
    <Empty className="bg-surface py-8 shadow-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconUsers aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{copy.title}</EmptyTitle>
        <EmptyDescription>{copy.description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/**
 * «پایان سانس» — the two writes that end a night (PROMPT.md §۶.۴): «بستن حضور و
 * غیاب» and «لغو کل سانس».
 *
 * Both are confirmed (§۶.۵) and both state their consequence before the tap. The card
 * is skipped entirely when neither applies — a canceled session has nothing left to
 * end, and a draft has no attendance to close.
 */
function EndOfSessionCard({
  detail,
  attendanceOpen,
}: {
  detail: AdminSessionDetail;
  attendanceOpen: boolean;
}) {
  const cancelable = detail.status !== "CANCELED";
  if (!attendanceOpen && !cancelable) return null;

  // Everyone a cancel would release, and what the release hands back to their
  // balances — the same helper the cancel's own transaction runs, seat by seat
  // (never `count × price`: a paid seat returns its own snapshot).
  const refunds = [...detail.confirmed, ...detail.waitlist].map(cancelRefundToman);
  const refundTotal = refunds.reduce((sum, amount) => sum + amount, 0);
  const refundCount = refunds.filter((amount) => amount > 0).length;

  return (
    <Card>
      <CardHeader>
        <h2 className="text-h2 text-ink">پایان سانس</h2>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {attendanceOpen ? (
          <div className="flex flex-col gap-2">
            <span className="text-caption text-ink-muted">حضور و غیاب</span>
            <CloseAttendanceButton
              sessionId={detail.id}
              pendingCount={detail.pendingAttendanceCount}
              noShowEnabled={detail.rules.noShowEnabled}
              noShowPenaltyDays={detail.rules.noShowPenaltyDays}
            />
          </div>
        ) : null}

        {cancelable ? (
          <div className="flex flex-col gap-2">
            <span className="text-caption text-ink-muted">لغو سانس</span>
            <div className="flex flex-wrap items-center gap-2">
              <CancelSessionButton
                sessionId={detail.id}
                title={detail.title}
                liveCount={detail.occupiedCount + detail.waitlistCount}
                refundTotal={refundTotal}
                refundCount={refundCount}
              />
              <span className="text-caption text-ink-muted">
                همه بدون جریمه آزاد می‌شن و پیام هم براشون می‌ره.
              </span>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Same blocks and row rhythm as the real screen, so streaming never shifts it. */
function ManageSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden="true">
      <span className="sr-only">در حال بارگذاری سانس</span>

      <div className="flex flex-col gap-4 rounded-xl bg-surface p-4 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
        <Skeleton className="h-4 w-52" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-5 w-56" />
        </div>
        <Skeleton className="h-3.5 w-full rounded-[3px]" />
        <Skeleton className="h-11 w-40 rounded-lg" />
      </div>

      <div className="flex flex-col gap-4 rounded-xl bg-surface p-4 shadow-card">
        <Skeleton className="h-6 w-28" />
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((tile) => (
            <Skeleton key={tile} className="h-18 rounded-lg" />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <Skeleton className="h-6 w-36" />
        <div className="divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-card">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex flex-col gap-3 p-4">
              <div className="flex items-start gap-3">
                <Skeleton className="size-9 rounded-full" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-44" />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Skeleton className="h-24 rounded-lg" />
                <Skeleton className="h-24 rounded-lg" />
              </div>
              <Skeleton className="h-9 w-32 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
