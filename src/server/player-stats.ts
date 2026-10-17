/**
 * «آمار من» — the player's own numbers for the profile screen (PROMPT.md §۶.۳).
 *
 * Counts, never percentages: «۷ سانس رفتی» is a fact, «۷۰٪ حضور» is a report. The
 * four numbers come from two queries — one `groupBy` over the player's attendance
 * marks and one count of the seats they still hold.
 */

import "server-only";

import { prisma } from "@/lib/db";

export type PlayerStats = {
  /** Sessions the player showed up for. */
  attended: number;
  /** Showed up late (attendance `LATE`). */
  late: number;
  /** Never showed up (attendance `ABSENT`). */
  absent: number;
  /**
   * Seats held in sessions that have not started yet.
   *
   * Deliberately `CONFIRMED` only: a waitlisted row holds nothing — it is a place
   * in line — and counting it would tell the player they have a session to go to
   * before a seat is theirs.
   */
  upcoming: number;
};

export async function getPlayerStats(userId: string, now = new Date()): Promise<PlayerStats> {
  const [byAttendance, upcoming] = await Promise.all([
    // A mark is a fact about a session that happened: it is counted wherever it
    // sits, whatever happened to the row afterwards.
    prisma.registration.groupBy({
      by: ["attendance"],
      where: { userId },
      _count: { _all: true },
    }),
    prisma.registration.count({
      where: {
        userId,
        status: "CONFIRMED",
        session: { status: "PUBLISHED", startsAt: { gt: now } },
      },
    }),
  ]);

  const mark = (attendance: string) =>
    byAttendance.find((row) => row.attendance === attendance)?._count._all ?? 0;

  return {
    attended: mark("PRESENT"),
    late: mark("LATE"),
    absent: mark("ABSENT"),
    upcoming,
  };
}
