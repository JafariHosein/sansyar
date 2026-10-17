import { Suspense } from "react";

import { connection } from "next/server";

import {
  IconBan,
  IconCalendarEvent,
  IconCircleCheck,
  IconCircleX,
  IconClock,
  IconShieldCheck,
  IconWallet,
} from "@tabler/icons-react";

import { Pagination } from "@/components/admin/pagination";
import { CopyButton } from "@/components/common/copy-button";
import { CloseAppButton } from "@/components/eitaa/close-app-button";
import { RenameDialog } from "@/components/profile/rename-dialog";
import { DevPanelSlot } from "@/components/dev/dev-panel-slot";
import { RulesCard } from "@/components/sessions/rules-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser } from "@/lib/auth";
import { BALANCE_ENTRY_LABELS, signedTomanLabel, type BalanceLedgerRow } from "@/lib/balance";
import { ADMIN_EITAA_IDS, EITAA_DEV_LOGIN } from "@/lib/env";
import { formatToman, toPersianDigits } from "@/lib/format";
import { formatJalaliDate } from "@/lib/jalali";
import { parsePage } from "@/lib/pagination";
import {
  banSentence,
  penaltyDaysLabel,
  penaltyState,
  penaltyStateLabel,
  penaltyTypeLabel,
} from "@/lib/penalties";
import { formatPhoneForDisplay } from "@/lib/phone";
import { cancelRuleSentences, fullNameOf } from "@/lib/sessions";
import { cn } from "@/lib/utils";
import { getActiveBan, listMyPenalties, type ActiveBan, type PenaltyHistoryRow } from "@/server/penalties";
import { getMyBalance, type MyBalance } from "@/server/player-balance";
import { getPlayerStats, type PlayerStats } from "@/server/player-stats";
import { getDefaultCancelRules } from "@/server/sessions/queries";

export const metadata = { title: "پروفایل" };

/**
 * Player profile: who you are, what your record looks like, and the rules you
 * agreed to (PROMPT.md §۶.۳). Same shape as the other screens — static chrome,
 * one `<Suspense>`, request-time work only after `await connection()`.
 *
 * The two identity fields are **read-only on purpose** (the owner's first-run
 * flow): the contact number is collected once through Eitaa's own
 * `requestContact` and the real-name pair once through the second sheet, and both
 * are immutable afterwards — a wrong value is fixed by the manager, not by
 * re-typing it. This screen states them and says exactly that; the only editable
 * name here is the **display** name («تغییر نام»), which is what a roster shows
 * while the real name is still unset.
 *
 * The «شناسهی من» block is a **bootstrap affordance**, not a profile field: it is
 * shown while no manager id is configured (so the manager can copy it into
 * `ADMIN_EITAA_ID`) and afterwards only to the manager themself. A normal player
 * has no use for a number they cannot change, and §۵.۷ keeps the app's data story
 * as small as possible.
 *
 * The **«موجودی من»** card (the balance round) sits right under the identity:
 * the wallet's number plus one database page of its ledger, read by
 * `getMyBalance` under `?balancePage=`. The owner's rule — no unbounded history —
 * applies to a wallet as much as to a list, and the shared `Pagination` carries
 * its own `pageParam` so two pagers can never overwrite each other. The rows are
 * the **same shape** the manager reads on `/admin/users/[id]`, so one movement
 * can never be worded two ways.
 */
export default function ProfilePage({ searchParams }: PageProps<"/profile">) {
  return (
    <div className="flex flex-col gap-6">
      {/* `searchParams` is a promise and is awaited *inside* the boundary (the
          `/my` pattern), so the shell stays prerenderable while the wallet
          streams in. */}
      <Suspense fallback={<ProfileSkeleton />}>
        <Profile searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Profile({ searchParams }: Pick<PageProps<"/profile">, "searchParams">) {
  await connection();

  const { balancePage } = await searchParams;

  const user = await getCurrentUser();
  if (!user) return <ProfileSkeleton />;

  // One clock for the whole screen, so the ban sentence and the history chips
  // can never disagree about "now".
  const now = new Date();

  // One round trip for the whole screen: the four record reads and the wallet
  // (its number and the newest page of its ledger) land together.
  const [stats, penalties, ban, rules, balance] = await Promise.all([
    getPlayerStats(user.id, now),
    listMyPenalties(user.id, 10),
    getActiveBan(user.id, now),
    getDefaultCancelRules(),
    getMyBalance(user.id, parsePage(balancePage)),
  ]);

  const showEitaaId = user.role === "ADMIN" || ADMIN_EITAA_IDS.length === 0;
  const phoneLabel = formatPhoneForDisplay(user.phone);
  const fullName = fullNameOf(user.firstName, user.lastName);

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <CardTitle className="text-h2">{user.name}</CardTitle>
              <CardDescription>حساب تو همون حساب ایتاست — ورود جداگانه‌ای نداریم.</CardDescription>
            </div>
            <RenameDialog currentName={user.name} />
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {user.role === "ADMIN" ? (
            <div>
              <Badge variant="success">مدیر سالن</Badge>
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <span className="text-caption text-ink-muted">نام و نام خانوادگی</span>
            <span className={cn(fullName ? "text-body text-ink" : "text-body text-ink-muted")}>
              {fullName ?? "ثبت نشده"}
            </span>
            <p className="text-caption text-ink-muted">
              {fullName
                ? "یک‌بار ثبت شده و قابل تغییر نیست — اسم نمایشیت جداست."
                : "هنوز ثبت نشده؛ دفعه‌ی بعد که سانس‌یار رو از ایتا باز کنی ازت می‌پرسیم."}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-caption text-ink-muted">شماره‌ی همراه</span>
            {/* The figure set is proportional (never `tabular-nums`), and the
                empty state is a word, so it drops the numeral scale. */}
            <span className={cn(user.phone ? "text-numeral text-ink" : "text-body text-ink-muted")}>
              {phoneLabel}
            </span>
            <p className="text-caption text-ink-muted">
              شماره یک‌بار ثبت می‌شه و خودت نمی‌تونی تغییرش بدی — برای اصلاح با مدیر هماهنگ کن.
              فقط خودِ مدیر این شماره رو می‌بینه.
            </p>
          </div>

          {showEitaaId ? (
            <div className="flex flex-col gap-2">
              <span className="text-caption text-ink-muted">شناسه‌ی من</span>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-numeral text-ink">
                  {toPersianDigits(user.eitaaId)}
                </span>
                <CopyButton value={user.eitaaId} label="کپی شناسه" successMessage="شناسه کپی شد" />
              </div>
              <p className="text-caption text-ink-muted">
                {user.role === "ADMIN"
                  ? "همین شناسه‌ست که تو رو مدیر سالن می‌کنه."
                  : "هنوز مدیری تنظیم نشده: اگه مدیر سالنی، همین شناسه رو در تنظیمات سرور به‌عنوان شناسه‌ی مدیر بذار تا پنل مدیریت باز بشه."}
              </p>
            </div>
          ) : null}

          <Separator />
          <CloseAppButton />
        </CardContent>
      </Card>

      <BalanceCard balance={balance} />

      <StatsCard stats={stats} />

      <PenaltyHistory penalties={penalties} ban={ban} now={now} />

      <RulesCard title="خلاصه‌ی قوانین" rulesSentences={cancelRuleSentences(rules)} />

      {/* Dev-only sign-out. Two independent guards: the server decided `EITAA_DEV_LOGIN`
          (handed to the slot as `enabled`), and the slot's compile-time
          `process.env.NODE_ENV` guard keeps the simulator out of a release bundle. */}
      <DevPanelSlot enabled={EITAA_DEV_LOGIN} allowSignOut />
    </>
  );
}

/**
 * «آمار من» — four counts, no percentages. Numbers are the point here, so they
 * carry the numeral scale, and each tile pairs its colour with an icon *and* a
 * word (never colour alone).
 */
function StatsCard({ stats }: { stats: PlayerStats }) {
  const tiles: { key: keyof PlayerStats; label: string; icon: typeof IconCircleCheck; tone: string }[] = [
    { key: "attended", label: "سانس رفتی", icon: IconCircleCheck, tone: "text-success-strong" },
    { key: "upcoming", label: "سانس پیش رو", icon: IconCalendarEvent, tone: "text-ink" },
    { key: "late", label: "با تاخیر رسیدی", icon: IconClock, tone: "text-brand-ink" },
    { key: "absent", label: "غیبت", icon: IconCircleX, tone: "text-destructive" },
  ];

  return (
    <Card>
      <CardHeader>
        <h2 className="text-h2 text-ink">آمار من</h2>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-3">
          {tiles.map((tile) => {
            const Icon = tile.icon;

            return (
              <div key={tile.key} className="flex flex-col gap-1 rounded-lg bg-sunken p-3">
                <dt className="flex items-center gap-1.5 text-caption text-ink-muted">
                  <Icon aria-hidden="true" className={cn("size-4 shrink-0", tile.tone)} stroke={1.75} />
                  {tile.label}
                </dt>
                <dd className="text-numeral text-ink">{toPersianDigits(stats[tile.key])}</dd>
              </div>
            );
          })}
        </dl>
      </CardContent>
    </Card>
  );
}

/**
 * «سابقه‌ی من» — warnings, bans and their reasons. A warning is a row like any
 * other (`days = 0`), which is exactly why it must be visible: it is the app
 * telling the player «این یکی رو بخشیدیم».
 */
function PenaltyHistory({
  penalties,
  ban,
  now,
}: {
  penalties: PenaltyHistoryRow[];
  ban: ActiveBan | null;
  now: Date;
}) {
  return (
    <section aria-labelledby="profile-history" className="flex flex-col gap-3">
      <h2 id="profile-history" className="text-h2 text-ink">
        سابقه‌ی من
      </h2>

      {ban ? (
        <Alert variant="destructive">
          <IconBan aria-hidden="true" />
          <AlertTitle>محروم از ثبت‌نام</AlertTitle>
          <AlertDescription>
            {banSentence(ban.until, now)} محروم هستی — دلیل: {ban.reason}
          </AlertDescription>
        </Alert>
      ) : null}

      {penalties.length === 0 ? (
        <Empty className="rounded-xl bg-surface shadow-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconShieldCheck aria-hidden="true" className="size-6" stroke={1.75} />
            </EmptyMedia>
            <EmptyTitle>هنوز تخلفی ثبت نشده</EmptyTitle>
            <EmptyDescription>
              همین‌طور ادامه بده — اگر تاخیر یا غیبتی ثبت شود، همین‌جا با وضعیتش می‌آید.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-card">
          {penalties.map((row) => {
            const state = penaltyState(row, now);

            return (
              <li key={row.id} className="flex flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-h3 text-ink">{penaltyTypeLabel(row.type)}</h3>
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
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * «موجودی من» — the wallet's number and the newest page of its ledger.
 *
 * The owner's rule: money paid for a seat that is given up lands here (never in
 * cash) and the next registration spends it automatically. The card states the
 * number, then the movements that produced it — label, signed amount, date, the
 * session or the manager behind it, and the standing right after — so the number
 * is never a mystery. Only one page of rows is rendered; the shared `Pagination`
 * owns the rest.
 *
 * Direction lives in the amount's **sign** and its colour, never in colour alone,
 * and an untouched wallet gets a written invitation instead of a blank space.
 */
function BalanceCard({ balance }: { balance: MyBalance }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-h2 text-ink">موجودی من</h2>
            <CardDescription>
              هنگام ثبت‌نام خودکار ازش کم می‌شه — لغو هم به همین موجودی برمی‌گرده.
            </CardDescription>
          </div>
          <span className="text-numeral text-ink">{formatToman(balance.balance)}</span>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        <h3 className="text-h3 text-ink">گردش موجودی</h3>

        {balance.entries.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconWallet aria-hidden="true" className="size-6" stroke={1.75} />
              </EmptyMedia>
              <EmptyTitle>هنوز حرکتی ثبت نشده</EmptyTitle>
              <EmptyDescription>
                بعد از اولین ثبت‌نام یا لغو، گردش موجودی این‌جا می‌آید.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-line border-t border-line">
            {balance.entries.map((entry) => (
              <BalanceRow key={entry.id} entry={entry} />
            ))}
          </ul>
        )}

        <Pagination
          page={balance.page}
          total={balance.total}
          basePath="/profile"
          itemLabel="حرکت"
          pageParam="balancePage"
        />
      </CardContent>
    </Card>
  );
}

/**
 * One movement: what happened and how much it moved, then when and where, then
 * where the wallet stood right after it. A credit is green with a `+`; a spend is
 * ink with a `−` — the sign is the cue, the colour only agrees with it.
 */
function BalanceRow({ entry }: { entry: BalanceLedgerRow }) {
  const credit = entry.amount >= 0;

  return (
    <li className="flex flex-col gap-1.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm text-ink">{BALANCE_ENTRY_LABELS[entry.type]}</span>
        <span className={credit ? "text-numeral text-success-strong" : "text-numeral text-ink"}>
          {signedTomanLabel(entry.amount)}
        </span>
      </div>

      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink-muted">
        <span>{formatJalaliDate(entry.createdAt)}</span>
        {entry.sessionTitle ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{entry.sessionTitle}</span>
          </>
        ) : null}
        {entry.byAdminName ? (
          <>
            <span aria-hidden="true">·</span>
            <span>توسط {entry.byAdminName}</span>
          </>
        ) : null}
      </p>

      {/* The manager's own words, when they wrote any. */}
      {entry.note ? <p className="text-sm text-ink-muted">{entry.note}</p> : null}

      <p className="text-caption text-ink-muted">موجودی: {formatToman(entry.balanceAfter)}</p>
    </li>
  );
}

/** Same rhythm as the real screen: identity, the wallet, four tiles, two rows. */
function ProfileSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden="true">
      <span className="sr-only">در حال بارگذاری پروفایل</span>

      <div className="flex flex-col gap-4 rounded-xl bg-surface p-4 shadow-card">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-5 w-full max-w-sm" />
        <Skeleton className="h-10 w-40" />
      </div>

      {/* The wallet: a heading with its number, then two movements. */}
      <div className="flex flex-col gap-4 rounded-xl bg-surface p-4 shadow-card">
        <div className="flex items-start justify-between gap-3">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-5 w-24" />
        </div>
        <Skeleton className="h-5 w-24" />
        <div className="flex flex-col gap-3">
          {[0, 1].map((movement) => (
            <div key={movement} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-5 w-24" />
              </div>
              <Skeleton className="h-4 w-36" />
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-xl bg-surface p-4 shadow-card">
        <Skeleton className="h-6 w-24" />
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((tile) => (
            <Skeleton key={tile} className="h-18 rounded-lg" />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <Skeleton className="h-6 w-28" />
        <div className="divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-card">
          {[0, 1].map((row) => (
            <div key={row} className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-40" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
