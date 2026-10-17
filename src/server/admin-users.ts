/**
 * Reads for the manager's **users** surface — `/admin/users` and
 * `/admin/users/[id]` (PROMPT.md §۵.۶ و §۶.۴).
 *
 * Two rules shape everything here:
 *
 *  - **The list pages in the database** (the owner's rule). `listUsers` always
 *    reads one page with `skip`/`take` and hands the total back, so twenty rows
 *    and twenty thousand cost the same HTML — the pager is the screenshot.
 *  - **One batch query per page, not one per row.** The active ban of a row is
 *    resolved by a single `findMany` over the page's user ids (the exact
 *    predicate of §۵.۶: `endsAt > now`, `waivedAt = null`, `days > 0`), and the
 *    four chip counts are one `groupBy` — never a query inside a `map`.
 *  - **The balance is a column and a ledger.** Every row carries `User.balance`
 *    — the number «تغییر موجودی» moves — and the account page reads one database
 *    page of `BalanceEntry` at a time (`?balancePage=`), newest first with the
 *    total, exactly like every other growing list.
 *
 * Contact numbers and Eitaa ids ride along on these rows: the caller is the
 * admin screen and the query itself is the guard (`listMembershipQueue` next
 * door makes the same choice) — a player's payload must never contain them.
 *
 * `now` is a parameter on every call that reads a ban, exactly like
 * `getActiveBan`/`listMyRegistrations`: a screen's ban line and its penalty
 * states can then never disagree about what "now" is.
 */

import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import type { BalanceLedgerRow } from "@/lib/balance";
import { prisma } from "@/lib/db";
import { toLatinDigits } from "@/lib/format";
import { clampPage, pageRange } from "@/lib/pagination";
import {
  fullNameOf,
  type AttendanceStatus,
  type MembershipStatus,
  type PaymentStatus,
  type RegistrationStatus,
} from "@/lib/sessions";
import {
  getActiveBan,
  listMyPenalties,
  type ActiveBan,
  type PenaltyHistoryRow,
} from "@/server/penalties";

/**
 * How many rows of each history one user page shows. The **counts** travel too,
 * so the screen can say «آخرین ۲۰ از ۴۲» instead of quietly pretending the list
 * is everything.
 */
export const USER_HISTORY_LIMIT = 20;

/**
 * A search longer than this is not a search — it is a paste. Capped so a hostile
 * query string cannot make MySQL scan for a novel.
 */
const MAX_QUERY_LENGTH = 60;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** The list's filter: «همه» or one of the three real membership states. */
export type MembershipFilter = "ALL" | MembershipStatus;

/** One row of the manager's user list. */
export type AdminUserRow = {
  id: string;
  /** The display name (Eitaa, or the one the player set). */
  name: string;
  /** The real name pair, joined; `null` until the first-run sheet is answered. */
  fullName: string | null;
  eitaaId: string;
  /** The contact number — manager-only data. */
  phone: string | null;
  membershipStatus: MembershipStatus;
  /** The account's wallet, in Toman — never negative. */
  balance: number;
  createdAt: Date;
  /** The end of the active ban that lasts longest, or `null` when free. */
  banUntil: Date | null;
};

/** The four chip numbers — the whole user base, whatever the current search is. */
export type AdminUserCounts = {
  all: number;
  pending: number;
  approved: number;
  rejected: number;
};

export type AdminUserList = {
  rows: AdminUserRow[];
  /** Rows matching the current search + filter (not the whole table). */
  total: number;
  counts: AdminUserCounts;
};

/** One row of «ثبت‌نام‌ها» on a user page. */
export type AdminUserRegistration = {
  id: string;
  status: RegistrationStatus;
  paymentStatus: PaymentStatus;
  attendance: AttendanceStatus;
  lateMinutes: number | null;
  createdAt: Date;
  session: { id: string; title: string; startsAt: Date };
};

/**
 * One row of the account's **balance ledger** — the story behind the number on
 * the card. The shape itself is shared (`BalanceLedgerRow` in `src/lib/balance.ts`),
 * so the player's own history and the manager's view of it can never drift.
 */
export type BalanceHistoryRow = BalanceLedgerRow;

export type AdminUserDetail = {
  user: {
    id: string;
    name: string;
    firstName: string | null;
    lastName: string | null;
    eitaaId: string;
    phone: string | null;
    role: "USER" | "ADMIN";
    membershipStatus: MembershipStatus;
    /** The account's wallet, in Toman — the number «تغییر موجودی» moves. */
    balance: number;
    createdAt: Date;
  };
  /** The ban in force right now (`getActiveBan` — the same predicate as §۵.۶). */
  activeBan: ActiveBan | null;
  /** The latest penalties and warnings — the same shape as «سابقه‌ی من». */
  penalties: PenaltyHistoryRow[];
  /** The latest registrations, newest session first. */
  registrations: AdminUserRegistration[];
  /**
   * One page of the balance ledger, newest first, with its total — the same
   * `PAGE_SIZE` pager every growing list in the app carries, so the history can
   * be read back without the screen ever rendering it whole.
   */
  balance: { entries: BalanceHistoryRow[]; total: number; page: number };
  /** Every registration the account ever made (the captions read it). */
  registrationCount: number;
  /** Every penalty row, warnings included. */
  penaltyCount: number;
  /** Attendance marks: «حاضر» · «تاخیر» · «غایب». */
  stats: { present: number; late: number; absent: number };
};

// ---------------------------------------------------------------------------
// Where-clause builders
// ---------------------------------------------------------------------------

/**
 * The search predicate: a contains over the three name columns plus the Eitaa id
 * and the contact number. MySQL's default collation (`utf8mb4_0900_ai_ci`) is
 * already case-insensitive, so Prisma's `mode: "insensitive"` is neither needed
 * nor supported here.
 *
 * The identifier columns are searched in their **stored** shape — Latin digits —
 * while the name columns are searched verbatim: every number the app draws is in
 * Persian digits, so a manager who reads a number off the screen and types it
 * back would otherwise find nothing. Names are never digit-rewritten, so a real
 * name that happens to contain a Persian digit still matches itself.
 */
function searchWhere(q: string): Prisma.UserWhereInput | null {
  if (q.length === 0) return null;
  const latin = toLatinDigits(q);

  return {
    OR: [
      { name: { contains: q } },
      { firstName: { contains: q } },
      { lastName: { contains: q } },
      { eitaaId: { contains: latin } },
      { phone: { contains: latin } },
    ],
  };
}

/** The rows of one chip: the filter narrows, the search narrows. */
function listWhere(q: string, membership: MembershipFilter): Prisma.UserWhereInput {
  const search = searchWhere(q);

  return {
    ...(membership === "ALL" ? {} : { membershipStatus: membership }),
    ...(search ?? {}),
  };
}

/**
 * The active ban of every user in `userIds` — **one** query for a whole page,
 * with the §۵.۶ predicate spelled out (a warning's `days = 0` never bans, a
 * waived row is history). The ban that ends last wins, because it is the one
 * that decides when the player is free again — exactly what `getActiveBan`
 * answers for a single account.
 */
async function activeBanByUser(userIds: string[], now: Date): Promise<Map<string, Date>> {
  const bans = new Map<string, Date>();
  if (userIds.length === 0) return bans;

  // `endsAt desc` makes the first row of a user the winner without a second pass;
  // the explicit compare below keeps that true even if the ordering is ever lost.
  const rows = await prisma.penalty.findMany({
    where: {
      userId: { in: userIds },
      waivedAt: null,
      days: { gt: 0 },
      endsAt: { gt: now },
    },
    orderBy: { endsAt: "desc" },
    select: { userId: true, endsAt: true },
  });

  for (const row of rows) {
    const current = bans.get(row.userId);
    if (!current || row.endsAt.getTime() > current.getTime()) {
      bans.set(row.userId, row.endsAt);
    }
  }

  return bans;
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

/**
 * One page of the manager's user list, newest account first — plus the four chip
 * counts.
 *
 * The chip counts are **global on purpose**: they describe the whole user base
 * (how many people are waiting for a decision?), not the current search — a chip
 * that changes while you type is a filter you cannot aim at.
 *
 * The order is `createdAt desc` (the newest account is the one the manager has
 * not seen yet), with the id as the tie-breaker so two accounts created in the
 * same millisecond cannot swap places between two pages and be shown twice.
 */
export async function listUsers(input: {
  q?: string;
  membership?: MembershipFilter;
  page?: number;
  /** The screen's clock — one instant decides every ban line on the page. */
  now?: Date;
}): Promise<AdminUserList> {
  const now = input.now ?? new Date();
  const q = (input.q ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  const membership = input.membership ?? "ALL";
  const page = input.page ?? 1;

  const where = listWhere(q, membership);

  // The two cheap aggregates first, so the page can be clamped **before** the
  // rows are read: a stale `?page=۹` after a filter narrowed the list lands on the
  // last real page instead of an empty screen that looks broken (`clampPage`).
  const [total, byStatus] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.groupBy({ by: ["membershipStatus"], _count: { _all: true } }),
  ]);

  const rows = await prisma.user.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...pageRange(clampPage(page, total)),
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      eitaaId: true,
      phone: true,
      membershipStatus: true,
      balance: true,
      createdAt: true,
    },
  });

  const bans = await activeBanByUser(
    rows.map((row) => row.id),
    now,
  );

  const countOf = (status: MembershipStatus) =>
    byStatus.find((row) => row.membershipStatus === status)?._count._all ?? 0;

  const pending = countOf("PENDING");
  const approved = countOf("APPROVED");
  const rejected = countOf("REJECTED");

  return {
    rows: rows.map((row) => ({
      id: row.id,
      name: row.name,
      fullName: fullNameOf(row.firstName, row.lastName),
      eitaaId: row.eitaaId,
      phone: row.phone,
      membershipStatus: row.membershipStatus,
      balance: row.balance,
      createdAt: row.createdAt,
      banUntil: bans.get(row.id) ?? null,
    })),
    total,
    // Every account has exactly one of the three states, so the sum is the
    // population — no fourth query for a number this one already knows.
    counts: { all: pending + approved + rejected, pending, approved, rejected },
  };
}

// ---------------------------------------------------------------------------
// One account
// ---------------------------------------------------------------------------

/**
 * Everything `/admin/users/[id]` shows, or `null` when the id matches nobody
 * (the page answers with `notFound()`).
 *
 * The independent reads go out together: identity, the active ban, the latest
 * penalties, the latest registrations, the attendance split, the two totals and
 * the ledger's own count. The histories are bounded (`USER_HISTORY_LIMIT`, or one
 * database page for the balance ledger) while the counts are the whole truth — a
 * manager who needs more opens the session's own roster or the next ledger page.
 */
export async function getUserDetail(
  id: string,
  now: Date = new Date(),
  balancePage = 1,
): Promise<AdminUserDetail | null> {
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      eitaaId: true,
      phone: true,
      role: true,
      membershipStatus: true,
      balance: true,
      createdAt: true,
    },
  });

  if (!user) return null;

  const [
    activeBan,
    penalties,
    registrations,
    byAttendance,
    registrationCount,
    penaltyCount,
    balanceTotal,
  ] = await Promise.all([
    getActiveBan(user.id, now),
    // The player's own «سابقه‌ی من», one size larger: the same select, so a row
    // can never read differently on the two screens.
    listMyPenalties(user.id, USER_HISTORY_LIMIT),
    prisma.registration.findMany({
      where: { userId: user.id },
      // Newest session first — the order every other ledger in the app uses.
      orderBy: { session: { startsAt: "desc" } },
      take: USER_HISTORY_LIMIT,
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        attendance: true,
        lateMinutes: true,
        createdAt: true,
        // `id` carries the link to the session's own manage screen.
        session: { select: { id: true, title: true, startsAt: true } },
      },
    }),
    prisma.registration.groupBy({
      by: ["attendance"],
      where: { userId: user.id },
      _count: { _all: true },
    }),
    prisma.registration.count({ where: { userId: user.id } }),
    prisma.penalty.count({ where: { userId: user.id } }),
    prisma.balanceEntry.count({ where: { userId: user.id } }),
  ]);

  // The ledger pages **in the database** like every other growing list: one page,
  // newest first, with the total travelling so the captions can say «۲۰ از ۴۲».
  // The clamp runs after the count, so a stale `?balancePage=۹` lands on the last
  // real page instead of an empty one.
  const ledgerPage = clampPage(balancePage, balanceTotal);
  const balanceRows = await prisma.balanceEntry.findMany({
    where: { userId: user.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...pageRange(ledgerPage),
    select: {
      id: true,
      amount: true,
      balanceAfter: true,
      type: true,
      note: true,
      createdAt: true,
      sessionId: true,
      // The session's name is what makes a row readable («ثبت‌نام سانس …»); the
      // manager who moved the number is named on a manual row.
      session: { select: { title: true } },
      byAdmin: { select: { name: true } },
    },
  });

  const mark = (attendance: AttendanceStatus) =>
    byAttendance.find((row) => row.attendance === attendance)?._count._all ?? 0;

  return {
    user,
    activeBan,
    penalties,
    registrations,
    balance: {
      entries: balanceRows.map((row) => ({
        id: row.id,
        amount: row.amount,
        balanceAfter: row.balanceAfter,
        type: row.type,
        note: row.note,
        createdAt: row.createdAt,
        sessionId: row.sessionId,
        sessionTitle: row.session?.title ?? null,
        byAdminName: row.byAdmin?.name ?? null,
      })),
      total: balanceTotal,
      page: ledgerPage,
    },
    registrationCount,
    penaltyCount,
    stats: {
      present: mark("PRESENT"),
      late: mark("LATE"),
      absent: mark("ABSENT"),
    },
  };
}
