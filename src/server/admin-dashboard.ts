/**
 * The manager dashboard's numbers (PROMPT.md §۶.۴) — «ثبت‌نام‌های امروز، سانس
 * بعدی (با ظرفیتش)، مبالغ دریافت‌نشده، محرومیت‌های فعال» — plus the single clock
 * they all share.
 *
 * One module, one round trip: the four tiles are one screen, so they are read in
 * one `Promise.all` and can never describe four different moments. "Today" is a
 * **Tehran calendar day** (`tehranWallClock` + `tehranWallClockToUtc`), not a
 * rolling 24 hours — a manager reading «ثبت‌نام امروز» at 00:30 means the day
 * that just started, not the shift they slept through.
 */

import "server-only";

import { seatOutstanding } from "@/lib/balance";
import { prisma } from "@/lib/db";
import { tehranWallClock, tehranWallClockToUtc } from "@/lib/jalali";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far back «دریافت‌نشده» looks: older debts are history, not a to-do. */
const UNPAID_LOOKBACK_DAYS = 30;

export type DashboardStats = {
  /** `CONFIRMED` seats on sessions that start inside today's Tehran day. */
  todayRegistrations: number;
  /** The next published session that has not started, with its live occupancy. */
  nextSession: {
    id: string;
    title: string;
    startsAt: Date;
    endsAt: Date;
    capacity: number;
    occupiedCount: number;
  } | null;
  /** Seats that still owe money on recent sessions, and what they owe (own snapshots). */
  unpaid: { count: number; totalToman: number };
  /** Bans in force right now (`endsAt > now`, not waived, `days > 0`). */
  activeBans: number;
};

export async function getDashboardStats(now: Date = new Date()): Promise<DashboardStats> {
  // The Tehran calendar day that contains `now`.
  const wall = tehranWallClock(now);
  const dayStart = tehranWallClockToUtc(wall.gy, wall.gm, wall.gd, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);

  const [todayRegistrations, nextSession, unpaidRows, activeBans] = await Promise.all([
    prisma.registration.count({
      where: {
        status: "CONFIRMED",
        session: { startsAt: { gte: dayStart, lt: dayEnd } },
      },
    }),

    prisma.session.findFirst({
      where: { status: "PUBLISHED", startsAt: { gte: now } },
      orderBy: { startsAt: "asc" },
      select: { id: true, title: true, startsAt: true, endsAt: true, capacity: true },
    }),

    // Money still owed: a held seat marked unpaid on a session that is recent
    // enough to still act on. Occupancy is `CONFIRMED` alone, so this is the
    // same set the roster shows — and both payment modes are included, because
    // «دریافت‌نشده» is about the books, not the collection route. Each row's
    // **own** snapshot travels: a seat taken before a price edit owes its own
    // price, and the part its balance covered is not owed at all.
    prisma.registration.findMany({
      where: {
        status: "CONFIRMED",
        paymentStatus: "UNPAID",
        session: {
          status: "PUBLISHED",
          endsAt: { gte: new Date(now.getTime() - UNPAID_LOOKBACK_DAYS * DAY_MS) },
        },
      },
      select: { amountToman: true, paidFromBalance: true, paymentStatus: true },
    }),

    prisma.penalty.count({
      where: { waivedAt: null, days: { gt: 0 }, endsAt: { gt: now } },
    }),
  ]);

  const occupiedCount = nextSession
    ? await prisma.registration.count({
        where: { sessionId: nextSession.id, status: "CONFIRMED" },
      })
    : 0;

  return {
    todayRegistrations,
    nextSession: nextSession ? { ...nextSession, occupiedCount } : null,
    unpaid: {
      count: unpaidRows.length,
      // Added seat by seat: each row owes its snapshot minus the part its
      // balance covered, so a price edit never re-prices an old seat.
      totalToman: unpaidRows.reduce((sum, row) => sum + seatOutstanding(row), 0),
    },
    activeBans,
  };
}
