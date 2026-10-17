import { Suspense, type ReactNode } from "react";

import { connection } from "next/server";

import {
  IconBan,
  IconChevronLeft,
  IconCircleCheck,
  IconCircleX,
  IconFileText,
  IconHourglassHigh,
  IconPhone,
  IconPhoneOff,
  IconSearch,
  IconSearchOff,
  IconShieldLock,
  IconUsers,
} from "@tabler/icons-react";
import Link from "next/link";

import { MembershipButtons } from "@/components/admin/membership-buttons";
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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser } from "@/lib/auth";
import { formatCount, formatToman, toPersianDigits } from "@/lib/format";
import { formatJalaliDate } from "@/lib/jalali";
import { clampPage, parsePage } from "@/lib/pagination";
import { banSentence } from "@/lib/penalties";
import { formatPhoneForDisplay } from "@/lib/phone";
import type { MembershipStatus } from "@/lib/sessions";
import {
  listUsers,
  type AdminUserCounts,
  type AdminUserRow,
  type MembershipFilter,
} from "@/server/admin-users";

export const metadata = { title: "کاربران" };

/**
 * «کاربران» — the manager's whole user base (PROMPT.md §۵.۶ و §۶.۴): search, the
 * membership state of every account and the inline decision on the ones that are
 * waiting for one.
 *
 * Shape (Cache Components, `AGENTS.md`): a static lead sentence around one
 * `<Suspense>`; the search box, the chips, the list and the pager are all
 * request-time (they read `searchParams`), so they stream in together behind a
 * skeleton whose row rhythm matches the real rows.
 *
 * Everything the manager decides here — approve, reject, ban — is one server
 * call that re-checks `requireAdmin()`; this screen is never the guard. The list
 * is **paged in the database** (the owner's rule): twenty rows and twenty
 * thousand cost the same HTML, and a stale `?page=۹` lands on the last real page.
 *
 * The contact number and the Eitaa id are on these rows because the manager is
 * the only reader (PROMPT.md §۵.۷): no player screen, no shared link and no
 * player-facing query carries them.
 */
export default function AdminUsersPage({ searchParams }: PageProps<"/admin/users">) {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-body text-ink-muted">
        هر کی سانس‌یار رو باز کرده این‌جاست — با اسم، شماره و سابقه‌ش. اسم یا شماره‌ش رو
        بگرد، عضویتش رو تصمیم بگیر و اگه لازم شد از پرونده‌ش محرومش کن.
      </p>

      {/* `searchParams` is handed down as a promise and awaited *inside* the
          boundary, so the shell above stays prerenderable. */}
      <Suspense fallback={<UsersSkeleton />}>
        <Users searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

/** Request-time work: the URL state, the viewer's role, then one page of users. */
async function Users({ searchParams }: Pick<PageProps<"/admin/users">, "searchParams">) {
  await connection();

  const params = await searchParams;
  const q = readSearch(params.q);
  const membership = parseMembership(params.membership);
  const page = parsePage(params.page);

  const viewer = await getCurrentUser();
  if (!viewer) return <UsersSkeleton />;

  if (viewer.role !== "ADMIN") {
    return (
      <Alert variant="destructive">
        <IconShieldLock aria-hidden="true" />
        <AlertTitle>این بخش برای مدیر سالن است</AlertTitle>
        <AlertDescription>حساب تو بازیکنه، پس فهرست عضوها برات باز نمی‌شه.</AlertDescription>
      </Alert>
    );
  }

  // One clock for the page: every ban line is measured against the same instant,
  // so two rows can never disagree about how many days are left.
  const now = new Date();
  const { rows, total, counts } = await listUsers({ q, membership, page, now });

  // The query clamped the page before reading the rows (`clampPage`); the pager
  // needs that same number to point at the page it is actually showing.
  const servedPage = clampPage(page, total);

  return (
    <div className="flex flex-col gap-4">
      <UsersToolbar q={q} membership={membership} counts={counts} />

      {total > 0 ? (
        <p className="text-caption text-ink-muted">
          {q ? `${formatCount(total, "کاربر")} برای «${q}»` : formatCount(total, "کاربر")}
        </p>
      ) : null}

      {rows.length > 0 ? (
        // One group surface with hairline-separated rows (DESIGN_SYSTEM.md §5):
        // a directory is a list, not a stack of cards.
        <ul className="divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-card">
          {rows.map((row) => (
            <UserRow key={row.id} row={row} now={now} />
          ))}
        </ul>
      ) : (
        <UsersEmpty q={q} membership={membership} hasAnyAccount={counts.all > 0} />
      )}

      <Pagination
        page={servedPage}
        total={total}
        basePath="/admin/users"
        // The search and the chip survive paging; «همه» is the bare URL.
        query={{ q, membership: membership === "ALL" ? undefined : membership }}
        itemLabel="کاربر"
      />
    </div>
  );
}

/**
 * The two controls the URL carries: the search box and the membership chips.
 *
 * The form is a plain **GET** form — no client JS, the URL *is* the state, and a
 * result can be shared or bookmarked. The chip rides along as a hidden field, so
 * searching inside «در انتظار تأیید» never silently widens back to everyone. The
 * chip numbers are the whole user base on purpose (`listUsers`): they answer «چند
 * نفر منتظر تصمیمن؟», which a number narrowed by the current search could not.
 */
function UsersToolbar({
  q,
  membership,
  counts,
}: {
  q: string;
  membership: MembershipFilter;
  counts: AdminUserCounts;
}) {
  const chips: { key: MembershipFilter; label: string; count: number }[] = [
    { key: "ALL", label: "همه", count: counts.all },
    { key: "PENDING", label: STATUS_LABELS.PENDING, count: counts.pending },
    { key: "APPROVED", label: STATUS_LABELS.APPROVED, count: counts.approved },
    { key: "REJECTED", label: STATUS_LABELS.REJECTED, count: counts.rejected },
  ];

  return (
    <div className="flex flex-col gap-3">
      <form action="/admin/users" method="get" role="search" className="flex items-center gap-2">
        <label htmlFor="user-search" className="sr-only">
          جست‌وجوی کاربر
        </label>
        <Input
          id="user-search"
          name="q"
          type="search"
          defaultValue={q}
          placeholder="اسم، فامیل، شماره یا شناسه‌ی ایتا"
          autoComplete="off"
          enterKeyHint="search"
          maxLength={MAX_SEARCH_LENGTH}
          className="min-w-0 flex-1"
        />
        {membership !== "ALL" ? <input type="hidden" name="membership" value={membership} /> : null}
        <Button type="submit" variant="outline">
          <IconSearch aria-hidden="true" />
          بگرد
        </Button>
      </form>

      <nav aria-label="فیلتر عضویت" className="flex flex-wrap gap-2">
        {chips.map((chip) => {
          const active = chip.key === membership;

          return (
            <Button
              key={chip.key}
              asChild
              // The active chip is a filled state, never a colour-only cue: it
              // carries `aria-current` and the sunken fill.
              variant={active ? "secondary" : "outline"}
            >
              <Link
                href={usersHref({ q, membership: chip.key })}
                aria-current={active ? "page" : undefined}
              >
                {chip.label}
                <span className="text-caption text-ink-muted">{toPersianDigits(chip.count)}</span>
              </Link>
            </Button>
          );
        })}
      </nav>

      {q.length > 0 ? (
        <Link
          href={usersHref({ membership })}
          className="self-start text-caption text-brand-ink underline-offset-4 hover:underline"
        >
          پاک کردن جست‌وجو
        </Link>
      ) : null}
    </div>
  );
}

/**
 * One account: who it is, how to reach them, where it stands — and the decision
 * it is waiting for, if any.
 *
 * The name is the link to the full file (`/admin/users/<id>`) and carries the
 * real-name pair first, falling back to the display name while the first-run
 * sheet is unanswered — the same reading order as the dashboard queue, because
 * this is the list the manager checks against a face at the door. The Eitaa name
 * appears beside it only when the two differ, so a nickname cannot make a row
 * unrecognizable.
 *
 * The decisions sit in their own row **outside** the link: a button inside a row
 * anchor is invalid HTML and swallows taps. An approved account offers none —
 * there is nothing left to decide; a rejected one keeps its one tap back
 * (`allowReject={false}`), which is the whole point of «رد شدن پایان کار نیست».
 */
function UserRow({ row, now }: { row: AdminUserRow; now: Date }) {
  const name = row.fullName ?? row.name;
  const showsEitaaName = row.fullName !== null && row.fullName !== row.name;

  return (
    <li className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Link
            href={`/admin/users/${row.id}`}
            className="group inline-flex items-center gap-1 self-start text-h3 text-ink underline-offset-4 hover:underline"
          >
            {name}
            <span className="sr-only">— پرونده</span>
            <IconChevronLeft
              aria-hidden="true"
              className="size-4 shrink-0 text-ink-muted"
              stroke={1.75}
            />
          </Link>
          {showsEitaaName ? (
            <span className="text-caption text-ink-muted">نام ایتا: {row.name}</span>
          ) : null}
          {/* The wallet, only when there is one: a quiet line under the name, so the
              row keeps its rhythm and a zero balance is not a line of noise. The full
              story lives on the account's own page. */}
          {row.balance > 0 ? (
            <span className="text-caption text-ink-muted">موجودی: {formatToman(row.balance)}</span>
          ) : null}
        </div>

        <MembershipBadge status={row.membershipStatus} />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-muted">
        {row.phone ? (
          <a
            href={`tel:${row.phone}`}
            aria-label={`تماس با ${name} — ${formatPhoneForDisplay(row.phone)}`}
            className="inline-flex items-center gap-1 text-brand-ink underline-offset-4 hover:underline"
          >
            <IconPhone aria-hidden="true" className="size-4" stroke={1.75} />
            <span dir="ltr" className="whitespace-nowrap">
              {formatPhoneForDisplay(row.phone)}
            </span>
          </a>
        ) : (
          <span className="flex items-center gap-1">
            <IconPhoneOff aria-hidden="true" className="size-4" stroke={1.75} />
            شماره نداده
          </span>
        )}
        <span aria-hidden="true">·</span>
        <span>عضو از {formatJalaliDate(row.createdAt)}</span>
      </div>

      {row.banUntil ? (
        // A ban is a state with a consequence, so it gets its own line and the
        // danger tint — paired with the icon and the word, never colour alone.
        <p className="flex items-center gap-1.5 text-caption font-medium text-danger">
          <IconBan aria-hidden="true" className="size-4 shrink-0" stroke={1.75} />
          محروم {banSentence(row.banUntil, now)}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {row.membershipStatus === "PENDING" ? (
          <MembershipButtons userId={row.id} playerLabel={name} />
        ) : row.membershipStatus === "REJECTED" ? (
          <MembershipButtons userId={row.id} playerLabel={name} allowReject={false} />
        ) : null}

        {/* The file page is one tap away on **every** row, not only on the ones
            with a decision: banning, waiving and reading the record all live
            there, and a manager looking for them must not have to guess that the
            name is a link. */}
        <Button asChild variant="outline">
          <Link href={`/admin/users/${row.id}`}>
            <IconFileText aria-hidden="true" />
            پرونده
          </Link>
        </Button>
      </div>
    </li>
  );
}

/** The membership pill — word **and** icon, so the state is never colour alone. */
function MembershipBadge({ status }: { status: MembershipStatus }) {
  switch (status) {
    case "PENDING":
      return (
        <Badge variant="default">
          <IconHourglassHigh aria-hidden="true" />
          {STATUS_LABELS.PENDING}
        </Badge>
      );

    case "APPROVED":
      return (
        <Badge variant="success">
          <IconCircleCheck aria-hidden="true" />
          {STATUS_LABELS.APPROVED}
        </Badge>
      );

    case "REJECTED":
      return (
        <Badge variant="destructive">
          <IconCircleX aria-hidden="true" />
          {STATUS_LABELS.REJECTED}
        </Badge>
      );
  }
}

/**
 * Three different nothings, three different sentences — «جست‌وجو نتیجه نداد» is
 * not «کسی در این فیلتر نیست» and neither is «هنوز کسی عضو نشده». Each one offers
 * the way out instead of apologising.
 */
function UsersEmpty({
  q,
  membership,
  hasAnyAccount,
}: {
  q: string;
  membership: MembershipFilter;
  hasAnyAccount: boolean;
}) {
  if (q.length > 0) {
    return (
      <EmptyState
        icon={<IconSearchOff aria-hidden="true" className="size-6" stroke={1.75} />}
        title="کسی با این جست‌وجو پیدا نشد"
        description="اسم، فامیل، شماره یا شناسه رو یه‌بار دیگه چک کن — لازم نیست کامل باشه، همین که پیدا شه کافیه."
        action={
          <Button variant="outline" asChild>
            <Link href={usersHref({ membership })}>پاک کردن جست‌وجو</Link>
          </Button>
        }
      />
    );
  }

  if (membership !== "ALL") {
    return (
      <EmptyState
        icon={<IconUsers aria-hidden="true" className="size-6" stroke={1.75} />}
        title="تو این فیلتر کسی نیست"
        description={`فعلاً هیچ کسی تو «${STATUS_LABELS[membership]}» نیست.`}
        action={
          <Button variant="outline" asChild>
            <Link href="/admin/users">دیدن همه‌ی کاربران</Link>
          </Button>
        }
      />
    );
  }

  if (!hasAnyAccount) {
    return (
      <EmptyState
        icon={<IconUsers aria-hidden="true" className="size-6" stroke={1.75} />}
        title="هنوز کاربری نیومده"
        description="هر کی سانس‌یار رو از ایتا باز کنه، حسابش همین‌جا ساخته می‌شه — بعد تصمیم عضویتش با توئه."
      />
    );
  }

  // Unreachable with a valid filter, but an empty table must never render an
  // empty screen: the list says what to do next whatever it is handed.
  return (
    <EmptyState
      icon={<IconUsers aria-hidden="true" className="size-6" stroke={1.75} />}
      title="کاربری برای نشون دادن نیست"
      description="فیلتر رو عوض کن یا همه‌ی کاربران رو ببین."
      action={
        <Button variant="outline" asChild>
          <Link href="/admin/users">دیدن همه‌ی کاربران</Link>
        </Button>
      }
    />
  );
}

/** The `Empty` composition (the board's pattern), so every state reads alike. */
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
 * Same rhythm as the real screen — the search row, the chip row, the count line
 * and three rows with a name line, a contact line and the action buttons — so
 * streaming never moves what is already painted.
 */
function UsersSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <span className="sr-only">در حال بارگذاری کاربران</span>

      <div className="flex flex-col gap-4" aria-hidden="true">
        <div className="flex items-center gap-2">
          <Skeleton className="h-11 flex-1 rounded-lg" />
          <Skeleton className="h-11 w-24 rounded-lg" />
        </div>

        <div className="flex flex-wrap gap-2">
          {[0, 1, 2, 3].map((chip) => (
            <Skeleton key={chip} className="h-11 w-24 rounded-lg" />
          ))}
        </div>

        <Skeleton className="h-4 w-24" />

        <div className="flex flex-col divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-card">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-24" />
                </div>
                <Skeleton className="h-6 w-24 rounded-full" />
              </div>
              <Skeleton className="h-4 w-48" />
              <div className="flex flex-wrap gap-2">
                <Skeleton className="h-11 w-24 rounded-lg" />
                <Skeleton className="h-11 w-20 rounded-lg" />
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

/** What each membership state is called — the chips, the pill and the empties. */
const STATUS_LABELS: Record<MembershipStatus, string> = {
  PENDING: "در انتظار تأیید",
  APPROVED: "تأییدشده",
  REJECTED: "ردشده",
};

/** A search longer than this is a paste, not a search — the query caps it too. */
const MAX_SEARCH_LENGTH = 60;

/** `?q=` — trimmed and capped, so the URL and the SQL `contains` agree on one shape. */
function readSearch(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw ?? "").trim().slice(0, MAX_SEARCH_LENGTH);
}

/** `?membership=` → a real filter. Anything unknown falls back to «همه». */
function parseMembership(value: string | string[] | undefined): MembershipFilter {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "PENDING" || raw === "APPROVED" || raw === "REJECTED" ? raw : "ALL";
}

/** The URL for one filter + search combination; page 1 is the bare URL. */
function usersHref({ q, membership }: { q?: string; membership: MembershipFilter }): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (membership !== "ALL") params.set("membership", membership);

  const qs = params.toString();
  return qs ? `/admin/users?${qs}` : "/admin/users";
}
