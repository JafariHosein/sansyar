import { Suspense, type ReactNode } from "react";

import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import {
  IconBallFootball,
  IconBan,
  IconChevronLeft,
  IconCircleCheck,
  IconCircleX,
  IconClock,
  IconHourglassHigh,
  IconPhone,
  IconPhoneOff,
  IconShieldCheck,
  IconShieldLock,
  IconWallet,
} from "@tabler/icons-react";

import { BalanceAdjust } from "@/components/admin/balance-adjust";
import { BanControls, WaiveBanButton } from "@/components/admin/ban-controls";
import { Pagination } from "@/components/admin/pagination";
import { CopyButton } from "@/components/common/copy-button";
import { AttendanceChip } from "@/components/sessions/attendance-chip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser } from "@/lib/auth";
import {
  BALANCE_ENTRY_LABELS,
  signedTomanLabel,
  type BalanceLedgerRow,
} from "@/lib/balance";
import { formatCount, formatToman, toPersianDigits } from "@/lib/format";
import { formatJalaliDate, formatJalaliDateTime } from "@/lib/jalali";
import { parsePage } from "@/lib/pagination";
import {
  banSentence,
  penaltyDaysLabel,
  penaltyState,
  penaltyStateLabel,
  penaltyTypeLabel,
  type PenaltyState,
} from "@/lib/penalties";
import { formatPhoneForDisplay } from "@/lib/phone";
import {
  fullNameOf,
  type MembershipStatus,
  type PaymentStatus,
  type RegistrationStatus,
} from "@/lib/sessions";
import { cn } from "@/lib/utils";
import {
  getUserDetail,
  USER_HISTORY_LIMIT,
  type AdminUserDetail,
  type AdminUserRegistration,
} from "@/server/admin-users";

export const metadata = { title: "کاربر" };

/**
 * The one route under the users section that renders per request instead of
 * shipping a prerendered shell.
 *
 * The shared chrome (`AppHeader`, `TabBar`) and the Eitaa bridge read
 * `usePathname()`, and a dynamic segment is the one case where the framework
 * cannot know that value while prerendering — instant-navigation validation
 * fails the build with `CLIENT_HOOK_DYNAMIC`. `/sessions/[id]` opts out for the
 * same reason; Next documents `instant = false` as the remedy, and it disables
 * that validation only: Cache Components still governs the data below
 * (`<Suspense>` + `await connection()`), and the route still reports `◐`.
 */
export const instant = false;

/**
 * «پروندهی کاربر» — one account, everything about it (PROMPT.md §۵.۶ و §۶.۴):
 * who the person is, whether they are banned right now, how their سانس‌ها went,
 * and the controls the engine understands — «محروم کردن (N روز + دلیل)»،
 * «لغو محرومیت» and «تغییر موجودی» with the account's own wallet ledger under it.
 *
 * Same shape as every other screen here: a static shell wrapping one
 * `<Suspense>` whose fallback matches the real rhythm, and all request-time work
 * (the cookie, the id, the reads and the wallet page) *inside* it after
 * `await connection()`.
 *
 * The record is **read-only history plus three deliberate writes**: nothing on this
 * screen edits a registration, a payment or an attendance mark (the session's own
 * management screen owns those). The two penalty writes re-check `requireAdmin()`
 * server-side and leave one `Penalty` row each — a ban is never a delete and a
 * pardon is `waivedAt`, because the penalty engine reads exactly those rows. The
 * balance write goes through `adjustBalance` (the wallet's own engine,
 * `src/server/balance-core.ts`) and lands one `BalanceEntry` row, because the
 * ledger must always add up to the column.
 */
export default function AdminUserPage(props: PageProps<"/admin/users/[id]">) {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<UserDetailSkeleton />}>
        <UserDetail params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

async function UserDetail({
  params,
  searchParams,
}: {
  params: PageProps<"/admin/users/[id]">["params"];
  searchParams: PageProps<"/admin/users/[id]">["searchParams"];
}) {
  await connection();

  const { id } = await params;
  // The balance ledger's own page key: `?balancePage=` rides next to the list's
  // other state (the same contract every growing list in the app uses), so the
  // ledger pages in the database instead of rendering its whole history.
  const query = await searchParams;

  const viewer = await getCurrentUser();
  if (!viewer) return <UserDetailSkeleton />;

  if (viewer.role !== "ADMIN") {
    return (
      <Alert variant="destructive">
        <IconShieldLock aria-hidden="true" />
        <AlertTitle>این بخش برای مدیر سالن است</AlertTitle>
        <AlertDescription>حساب تو بازیکنه، پس پرونده‌ی عضوها برات باز نمی‌شه.</AlertDescription>
      </Alert>
    );
  }

  // One clock for the whole file: the ban sentence, the «در جریان» state of every
  // penalty row and the «لغو محرومیت» button all read the same instant, so the
  // screen can never contradict itself about what "now" is.
  const now = new Date();
  const detail = await getUserDetail(id, now, parsePage(query.balancePage));
  // An old link, a mistyped id, a deleted account — the same 404 for all three.
  if (!detail) notFound();

  const {
    user,
    activeBan,
    penalties,
    registrations,
    balance,
    registrationCount,
    penaltyCount,
    stats,
  } = detail;
  const name = fullNameOf(user.firstName, user.lastName) ?? user.name;

  return (
    <>
      <IdentityCard user={user} />

      <BalanceSection
        userId={user.id}
        playerLabel={name}
        balance={user.balance}
        ledger={balance}
      />

      <BanSection
        userId={user.id}
        playerLabel={name}
        activeBan={activeBan}
        now={now}
      />

      <StatsCard registrationCount={registrationCount} stats={stats} />

      <RegistrationsSection registrations={registrations} total={registrationCount} />

      <PenaltiesSection
        penalties={penalties}
        total={penaltyCount}
        playerLabel={name}
        now={now}
      />
    </>
  );
}

/**
 * Who this is — the reading order the manager checks a face at the door with:
 * the real name first, the Eitaa name beside it only when the two differ.
 *
 * The contact number is shown as the manager's own `tel:` link (manager-only
 * data, PROMPT.md §۵.۷) and the Eitaa id is copyable, because it is the value
 * that makes an account a manager (`ADMIN_EITAA_ID`) — the profile screen offers
 * the same copy for the same reason.
 */
function IdentityCard({ user }: { user: AdminUserDetail["user"] }) {
  const fullName = fullNameOf(user.firstName, user.lastName);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-h2 text-ink">{fullName ?? user.name}</h2>
            {fullName !== null && fullName !== user.name ? (
              <p className="text-caption text-ink-muted">نام ایتا: {user.name}</p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {user.role === "ADMIN" ? <Badge variant="success">مدیر سالن</Badge> : null}
            <MembershipBadge status={user.membershipStatus} />
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <dl className="flex flex-col gap-4">
          <Fact label="نام و نام خانوادگی">
            <span className={fullName ? "text-body text-ink" : "text-body text-ink-muted"}>
              {fullName ?? "ثبت نشده"}
            </span>
          </Fact>

          <Fact label="شماره‌ی همراه">
            {user.phone ? (
              <a
                href={`tel:${user.phone}`}
                aria-label={`تماس با ${fullName ?? user.name} — ${formatPhoneForDisplay(user.phone)}`}
                className="inline-flex items-center gap-1.5 self-start text-brand-ink underline-offset-4 hover:underline"
              >
                <IconPhone aria-hidden="true" className="size-4 shrink-0" stroke={1.75} />
                {/* The figure set is proportional (never `tabular-nums`). */}
                <span dir="ltr" className="text-numeral whitespace-nowrap">
                  {formatPhoneForDisplay(user.phone)}
                </span>
              </a>
            ) : (
              <span className="flex items-center gap-1.5 text-body text-ink-muted">
                <IconPhoneOff aria-hidden="true" className="size-4 shrink-0" stroke={1.75} />
                شماره نداده
              </span>
            )}
            <span className="text-caption text-ink-muted">
              شماره یک‌بار از خود ایتا گرفته شده و خودش نمی‌تونه عوضش کنه.
            </span>
          </Fact>

          <Fact label="شناسه‌ی ایتا">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-numeral text-ink">{toPersianDigits(user.eitaaId)}</span>
              <CopyButton value={user.eitaaId} label="کپی شناسه" successMessage="شناسه کپی شد" />
            </div>
          </Fact>

          <Fact label="عضویت از">
            <span className="text-body text-ink">{formatJalaliDateTime(user.createdAt)}</span>
          </Fact>
        </dl>
      </CardContent>
    </Card>
  );
}

/** One label/value pair of the identity list. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <dt className="text-caption text-ink-muted">{label}</dt>
      <dd className="flex flex-col gap-1">{children}</dd>
    </div>
  );
}

/**
 * «موجودی حساب» — the wallet of one account and the story behind it (the balance
 * round).
 *
 * The number is `User.balance`, the column «تغییر موجودی» moves by hand; under it
 * sits one **database page** of `BalanceEntry` rows, newest first, with the shared
 * pager riding `?balancePage=` — its own query key, so this ledger can never
 * overwrite another list's page. Every row is a sentence the manager can check a
 * payment against: what the movement was (`BALANCE_ENTRY_LABELS`), its signed
 * amount, the session it belongs to, the manager who moved it by hand, and where
 * the account stood right after it (`balanceAfter`).
 *
 * Every write stays in the dialog next door (`BalanceAdjust` → `adjustBalance`):
 * this component only reads, and the `?balancePage=` value was already clamped by
 * the query, so a stale link can never land on an empty screen.
 */
function BalanceSection({
  userId,
  playerLabel,
  balance,
  ledger,
}: {
  userId: string;
  /** The name the dialog's title and aria labels read. */
  playerLabel: string;
  /** The account's wallet right now, in Toman — never negative. */
  balance: number;
  /** One page of movements, newest first, plus the clamped page and the total. */
  ledger: AdminUserDetail["balance"];
}) {
  return (
    <section aria-labelledby="user-balance" className="flex flex-col gap-3">
      <h2
        id="user-balance"
        className="flex flex-wrap items-baseline gap-x-2 text-h2 text-ink"
      >
        موجودی حساب
        {ledger.total > 0 ? (
          <span className="text-caption text-ink-muted">{formatCount(ledger.total, "حرکت")}</span>
        ) : null}
      </h2>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-numeral text-ink">{formatToman(balance)}</span>
            <span className="text-caption text-ink-muted">
              پول ثبت‌نامی که لغو بشه خودکار به همین موجودی برمی‌گرده و ثبت‌نام بعدی ازش کم می‌شه.
            </span>
          </div>

          <BalanceAdjust userId={userId} playerLabel={playerLabel} balance={balance} />
        </CardContent>
      </Card>

      {ledger.entries.length === 0 ? (
        <EmptyState
          icon={<IconWallet aria-hidden="true" className="size-6" stroke={1.75} />}
          title="هنوز حرکتی توی موجودی این حساب ثبت نشده"
          description="هر ثبت‌نام، لغو یا تغییر دستی، همین‌جا با مبلغ و تاریخش میاد."
        />
      ) : (
        <>
          <ul className="divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-card">
            {ledger.entries.map((entry) => (
              <BalanceRow key={entry.id} entry={entry} />
            ))}
          </ul>

          <Pagination
            page={ledger.page}
            total={ledger.total}
            basePath={`/admin/users/${userId}`}
            itemLabel="حرکت"
            // The ledger's own key: the account page is the first screen with two
            // lists, and a shared `page` would move both at once.
            pageParam="balancePage"
          />
        </>
      )}
    </section>
  );
}

/**
 * One movement of the account's money: the kind, the signed amount, when it
 * happened, where it came from and where the account stood after it.
 *
 * The sign carries the direction on its own (`signedTomanLabel`); the tint only
 * agrees with it, so the row never leans on colour alone. A session row is a link
 * to the سانس's own manage screen — that is where the manager checks a payment —
 * and naming the manager on a hand-made adjustment is what makes the row
 * auditable.
 */
function BalanceRow({ entry }: { entry: BalanceLedgerRow }) {
  return (
    <li className="flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-h3 text-ink">{BALANCE_ENTRY_LABELS[entry.type]}</h3>
        <span
          className={cn("text-numeral", entry.amount > 0 ? "text-success-strong" : "text-ink")}
        >
          {signedTomanLabel(entry.amount)}
        </span>
      </div>

      {entry.note ? <p className="text-sm text-ink-muted">{entry.note}</p> : null}

      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink-muted">
        <span>{formatJalaliDateTime(entry.createdAt)}</span>
        {entry.sessionId && entry.sessionTitle ? (
          <>
            <span aria-hidden="true">·</span>
            <Link
              href={`/admin/sessions/${entry.sessionId}`}
              className="text-brand-ink underline-offset-4 hover:underline"
            >
              {entry.sessionTitle}
            </Link>
          </>
        ) : null}
        {entry.byAdminName ? (
          <>
            <span aria-hidden="true">·</span>
            <span>تنظیم‌کننده: {entry.byAdminName}</span>
          </>
        ) : null}
      </p>

      <p className="text-caption text-ink-muted">موجودی: {formatToman(entry.balanceAfter)}</p>
    </li>
  );
}

/**
 * «محرومیت» — the ban that is in force right now (the §۵.۶ predicate, read by the
 * very query the engine uses), the reason in the manager's own words, and the
 * action: ban for N days with a reason, or lift a live ban.
 *
 * The ban button is offered even while a ban is active — extending one is a
 * legitimate decision, and the engine takes the row that ends last.
 */
function BanSection({
  userId,
  playerLabel,
  activeBan,
  now,
}: {
  userId: string;
  playerLabel: string;
  activeBan: AdminUserDetail["activeBan"];
  now: Date;
}) {
  return (
    <section aria-labelledby="user-ban" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="user-ban" className="text-h2 text-ink">
          محرومیت
        </h2>
        <p className="text-caption text-ink-muted">
          محرومیت دستی با دلیل ثبت می‌شه و از تو ایتا به خودش می‌رسه.
        </p>
      </div>

      {activeBan ? (
        <Alert variant="destructive">
          <IconBan aria-hidden="true" />
          <AlertTitle>محروم از ثبت‌نام</AlertTitle>
          <AlertDescription className="flex flex-col gap-1">
            <span>
              {banSentence(activeBan.until, now)} محرومه — دلیل: {activeBan.reason}
            </span>
            <span>تا پایان این مدت تو هیچ سانسی نمی‌تونه ثبت‌نام کنه.</span>
          </AlertDescription>
        </Alert>
      ) : (
        <EmptyState
          icon={<IconShieldCheck aria-hidden="true" className="size-6" stroke={1.75} />}
          title="محرومیتی در جریان نیست"
          description="می‌تونه تو هر سانسی که جا داره ثبت‌نام کنه."
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <BanControls userId={userId} playerLabel={playerLabel} />
      </div>
    </section>
  );
}

/**
 * «آمار» — four counts, no percentages: how many سانس‌ها the account ever asked
 * for, and how the ones it held actually went. Each tile pairs its colour with an
 * icon *and* a word, and the numbers carry the numeral scale.
 */
function StatsCard({
  registrationCount,
  stats,
}: {
  registrationCount: number;
  stats: AdminUserDetail["stats"];
}) {
  const tiles: {
    key: "registrations" | "present" | "late" | "absent";
    label: string;
    value: number;
    icon: typeof IconCircleCheck;
    tone: string;
  }[] = [
    {
      key: "registrations",
      label: "ثبت‌نام",
      value: registrationCount,
      icon: IconBallFootball,
      tone: "text-ink",
    },
    { key: "present", label: "حاضر", value: stats.present, icon: IconCircleCheck, tone: "text-success-strong" },
    { key: "late", label: "با تاخیر", value: stats.late, icon: IconClock, tone: "text-brand-ink" },
    { key: "absent", label: "غایب", value: stats.absent, icon: IconCircleX, tone: "text-destructive" },
  ];

  return (
    <Card>
      <CardHeader>
        <h2 className="text-h2 text-ink">آمار</h2>
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
                <dd className="text-numeral text-ink">{toPersianDigits(tile.value)}</dd>
              </div>
            );
          })}
        </dl>
      </CardContent>
    </Card>
  );
}

/**
 * «ثبت‌نام‌ها» — the seat history, newest session first, bounded at
 * `USER_HISTORY_LIMIT` rows with the whole count in the heading: a manager who
 * needs the rest opens the سانس itself.
 *
 * The seat state, the payment and the attendance mark are three different facts
 * and read as three chips. The attendance mark is only shown once it exists — a
 * «ثبت نشده» chip on an upcoming سانس would read like a fault — and the payment
 * chip is skipped while a row owes nothing (a waitlisted seat and a canceled
 * `UNPAID` one owe nothing, so «پرداخت نشده» there would be a lie).
 */
function RegistrationsSection({
  registrations,
  total,
}: {
  registrations: AdminUserDetail["registrations"];
  total: number;
}) {
  return (
    <section aria-labelledby="user-registrations" className="flex flex-col gap-3">
      <h2
        id="user-registrations"
        className="flex flex-wrap items-baseline gap-x-2 text-h2 text-ink"
      >
        ثبت‌نام‌ها
        {total > 0 ? <span className="text-caption text-ink-muted">{formatCount(total, "ثبت‌نام")}</span> : null}
      </h2>

      {registrations.length === 0 ? (
        <EmptyState
          icon={<IconBallFootball aria-hidden="true" className="size-6" stroke={1.75} />}
          title="هنوز تو هیچ سانسی ثبت‌نام نکرده"
          description="هر سانسی که بگیره — قطعی یا لیست انتظار — همین‌جا میاد."
        />
      ) : (
        <>
          {registrations.length < total ? (
            <p className="text-caption text-ink-muted">
              آخرین {toPersianDigits(USER_HISTORY_LIMIT)} ثبت‌نام این‌جاست.
            </p>
          ) : null}

          <ul className="divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-card">
            {registrations.map((registration) => (
              <RegistrationRow key={registration.id} registration={registration} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** One سانس the account registered for: the slot, the seat state, money and presence. */
function RegistrationRow({ registration }: { registration: AdminUserRegistration }) {
  const showsPayment =
    registration.status === "CONFIRMED" || registration.paymentStatus !== "UNPAID";

  return (
    <li className="flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 text-h3 text-ink">
          <Link
            href={`/admin/sessions/${registration.session.id}`}
            className="group inline-flex items-center gap-1 text-h3 text-ink underline-offset-4 hover:underline"
          >
            {registration.session.title}
            <span className="sr-only">— مدیریت سانس</span>
            <IconChevronLeft
              aria-hidden="true"
              className="size-4 shrink-0 text-ink-muted"
              stroke={1.75}
            />
          </Link>
        </h3>
        <SeatBadge status={registration.status} />
      </div>

      <p className="text-caption text-ink-muted">
        سانس {formatJalaliDate(registration.session.startsAt)} · ثبت‌نام{" "}
        {formatJalaliDate(registration.createdAt)}
      </p>

      {showsPayment || registration.attendance !== "PENDING" ? (
        <div className="flex flex-wrap items-center gap-2">
          {showsPayment ? (
            <PaymentChip status={registration.paymentStatus} />
          ) : null}
          {registration.attendance !== "PENDING" ? (
            <AttendanceChip
              status={registration.attendance}
              lateMinutes={registration.lateMinutes}
            />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * «سابقه» — every penalty and warning, newest first, with «لغو محرومیت» on the
 * rows that are in force right now. A warning (`days = 0`) is a row like any
 * other: it is the app telling the record «این یکی رو بخشیدیم», and it is why the
 * count in the heading may be larger than the number of bans.
 */
function PenaltiesSection({
  penalties,
  total,
  playerLabel,
  now,
}: {
  penalties: AdminUserDetail["penalties"];
  total: number;
  playerLabel: string;
  now: Date;
}) {
  return (
    <section aria-labelledby="user-penalties" className="flex flex-col gap-3">
      <h2 id="user-penalties" className="flex flex-wrap items-baseline gap-x-2 text-h2 text-ink">
        جریمه‌ها
        {total > 0 ? (
          <span className="text-caption text-ink-muted">{formatCount(total, "جریمه")}</span>
        ) : null}
      </h2>

      {penalties.length === 0 ? (
        <EmptyState
          icon={<IconShieldCheck aria-hidden="true" className="size-6" stroke={1.75} />}
          title="تخلفی ثبت نشده"
          description="انصراف دیرهنگام، غیبت، تکرار تاخیر و محرومیت دستی این‌جا میاد."
        />
      ) : (
        <>
          {penalties.length < total ? (
            <p className="text-caption text-ink-muted">
              آخرین {toPersianDigits(USER_HISTORY_LIMIT)} ردیف این‌جاست.
            </p>
          ) : null}

          <ul className="divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-card">
            {penalties.map((row) => {
              const state = penaltyState(row, now);

              return (
                <li key={row.id} className="flex flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-h3 text-ink">{penaltyTypeLabel(row.type)}</h3>
                    <PenaltyStateBadge state={state} />
                  </div>

                  <p className="text-sm text-ink-muted">{row.reason}</p>

                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink-muted">
                    <span className="text-ink">{penaltyDaysLabel(row.days)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatJalaliDate(row.startsAt)}</span>
                    {row.sessionTitle ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{row.sessionTitle}</span>
                      </>
                    ) : null}
                    {row.waivedAt ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>لغو شده {formatJalaliDate(row.waivedAt)}</span>
                      </>
                    ) : null}
                  </p>

                  {/* Only a live ban can be lifted: a warning was never a ban and a
                      waived row is history (`penaltyState` is the single verdict). */}
                  {state === "ACTIVE" ? (
                    <WaiveBanButton penaltyId={row.id} playerLabel={playerLabel} />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

/** The membership pill — word **and** icon, so the state is never colour alone. */
function MembershipBadge({ status }: { status: MembershipStatus }) {
  switch (status) {
    case "PENDING":
      return (
        <Badge variant="default">
          <IconHourglassHigh aria-hidden="true" />
          در انتظار تأیید
        </Badge>
      );

    case "APPROVED":
      return (
        <Badge variant="success">
          <IconCircleCheck aria-hidden="true" />
          تأییدشده
        </Badge>
      );

    case "REJECTED":
      return (
        <Badge variant="destructive">
          <IconCircleX aria-hidden="true" />
          ردشده
        </Badge>
      );
  }
}

/** The seat state of one registration: «قطعی شده» · «در لیست انتظار» · «لغو شده». */
function SeatBadge({ status }: { status: RegistrationStatus }) {
  switch (status) {
    case "CONFIRMED":
      return (
        <Badge variant="success">
          <IconCircleCheck aria-hidden="true" />
          قطعی شده
        </Badge>
      );

    case "WAITLIST":
      return (
        <Badge variant="secondary">
          <IconHourglassHigh aria-hidden="true" />
          در لیست انتظار
        </Badge>
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

/**
 * Where the money stands, read from `paymentStatus` alone (the query does not
 * carry a price): the words are the manager's ledger, not the player's sentence.
 * `PAID_BALANCE` reads like the other settled states — the money is with the hall
 * either way — and this page shows no split line, because the account's own
 * registrations read does not carry the seat's snapshot.
 */
const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  UNPAID: "پرداخت نشده",
  PAID_ONLINE: "آنلاین پرداخت شده",
  PAID_IN_PERSON: "حضوری دریافت شده",
  PAID_BALANCE: "از موجودی پرداخت شده",
  WAIVED: "پرداخت لازم نیست",
};

function PaymentChip({ status }: { status: PaymentStatus }) {
  if (
    status === "PAID_ONLINE" ||
    status === "PAID_IN_PERSON" ||
    status === "PAID_BALANCE"
  ) {
    return (
      <Badge variant="success">
        <IconCircleCheck aria-hidden="true" />
        {PAYMENT_LABELS[status]}
      </Badge>
    );
  }

  if (status === "WAIVED") {
    return <Badge variant="secondary">{PAYMENT_LABELS.WAIVED}</Badge>;
  }

  return <Badge variant="outline">{PAYMENT_LABELS.UNPAID}</Badge>;
}

/** How one penalty reads today — the same four words «سابقه‌ی من» uses. */
function PenaltyStateBadge({ state }: { state: PenaltyState }) {
  return (
    <Badge
      variant={
        state === "ACTIVE"
          ? "destructive"
          : state === "WARNING" || state === "SERVED"
            ? "secondary"
            : "outline"
      }
    >
      {penaltyStateLabel(state)}
    </Badge>
  );
}

/** The `Empty` composition (the board's pattern), so every state reads alike. */
function EmptyState({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Empty className="rounded-xl bg-surface shadow-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/**
 * Same rhythm as the real file — the identity card, the balance block, the ban
 * block, the four tiles, then two history rows — so streaming the record never
 * moves what is already painted.
 */
function UserDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <span className="sr-only">در حال بارگذاری پرونده‌ی کاربر</span>

      <div className="flex flex-col gap-4 rounded-xl bg-surface p-4 shadow-card" aria-hidden="true">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="flex flex-col gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-40" />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3" aria-hidden="true">
        <Skeleton className="h-7 w-32" />
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface p-4 shadow-card">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-4 w-52" />
          </div>
          <Skeleton className="h-11 w-32 rounded-lg" />
        </div>
        <div className="divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-card">
          {[0, 1].map((row) => (
            <div key={row} className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-5 w-24" />
              </div>
              <Skeleton className="h-4 w-44" />
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3" aria-hidden="true">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-11 w-32 rounded-lg" />
      </div>

      <div className="flex flex-col gap-4 rounded-xl bg-surface p-4 shadow-card" aria-hidden="true">
        <Skeleton className="h-6 w-16" />
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((tile) => (
            <Skeleton key={tile} className="h-18 rounded-lg" />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3" aria-hidden="true">
        <Skeleton className="h-7 w-28" />
        <div className="divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-card">
          {[0, 1].map((row) => (
            <div key={row} className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-6 w-24 rounded-full" />
              </div>
              <Skeleton className="h-4 w-44" />
              <Skeleton className="h-6 w-32 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
