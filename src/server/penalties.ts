/**
 * Bans and penalty history — the read side of the penalty engine (PROMPT.md §۵.۶).
 *
 * Phase ۳ only needed to *respect* a ban when a player registers. Phase ۴ added the
 * history read for «سابقهی من»; the rows themselves are written by the cancel
 * engine (`src/server/actions/cancel.ts`) and, later, by the attendance engine and
 * the admin panel.
 */

import "server-only";

import { prisma } from "@/lib/db";
import type { PenaltyType } from "@/lib/penalties";

/** An active ban: registration is refused until `until`. */
export type ActiveBan = { until: Date; reason: string };

/**
 * The user's currently active ban, or `null`.
 *
 * The predicate is PROMPT.md §۵.۶ verbatim: `endsAt > now`, `waivedAt = null`
 * and **`days > 0`**. The last part is not decoration — `days === 0` is how the
 * engine records an «اخطار» (a first late cancel, say: it shows up in the
 * player's history) and a warning must never close the door on registration for
 * anyone. A waived row (`waivedAt` set by the admin) is history too.
 *
 * `now` is a parameter because a caller that already resolved a clock hands its
 * own `Date` over, so two checks inside one request can never disagree by a few
 * milliseconds.
 */
export async function getActiveBan(
  userId: string,
  now: Date = new Date(),
): Promise<ActiveBan | null> {
  // The ban that ends last wins: it is the one that decides when the player is
  // free again, so it is also the date told to them.
  const ban = await prisma.penalty.findFirst({
    where: {
      userId,
      waivedAt: null,
      days: { gt: 0 },
      endsAt: { gt: now },
    },
    orderBy: { endsAt: "desc" },
    select: { endsAt: true, reason: true },
  });

  return ban ? { until: ban.endsAt, reason: ban.reason } : null;
}

/**
 * One row of «سابقهی من» on the profile (§۶.۳): the penalty itself plus the
 * session it came from (null for a manual ban). Ordered newest first.
 */
export type PenaltyHistoryRow = {
  id: string;
  type: PenaltyType;
  days: number;
  reason: string;
  startsAt: Date;
  endsAt: Date;
  waivedAt: Date | null;
  /** The session that triggered it; `null` for a manual ban. */
  sessionTitle: string | null;
};

/** A player's own history — warnings included (`days = 0` is a row, not a ban). */
export async function listMyPenalties(
  userId: string,
  take = 10,
): Promise<PenaltyHistoryRow[]> {
  const rows = await prisma.penalty.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      type: true,
      days: true,
      reason: true,
      startsAt: true,
      endsAt: true,
      waivedAt: true,
      session: { select: { title: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    days: row.days,
    reason: row.reason,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    waivedAt: row.waivedAt,
    sessionTitle: row.session?.title ?? null,
  }));
}
