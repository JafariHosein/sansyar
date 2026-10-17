"use server";

/**
 * «حضور و غیاب» (PROMPT.md §۵.۵ + §۵.۶) — the shell around the attendance
 * engine.
 *
 * The transactions themselves live in `src/server/attendance-core.ts`
 * (`markAttendance`, `closeAttendance`): a mark serializes on the registration
 * row, a close on the session row, and the two §۵.۶ events they can write
 * (`NO_SHOW`, `LATE_STRIKES`) are charged exactly once per event. This module
 * keeps only what a server action must own: the zod checks, the **admin** guard,
 * the revalidation, the fire-and-forget Eitaa messages and the mapping down to
 * the shape a browser gets.
 *
 * The guard is `requireAdmin()` and nothing else — `proxy.ts` shapes requests and
 * is never the auth boundary, so a player who calls this by hand is refused here
 * (and, if they somehow got past it, again by the engine, whose own copy of every
 * refusal lives next to the rules it comes from).
 *
 * Two honest limits of this shell:
 *
 *  - `markAttendance` re-reads the player's Eitaa id **only when a ban was really
 *    written** — the engine's answer carries the row, not the address, and a
 *    message nobody needs must not cost a query;
 *  - a message may fail (no credit, closed program, API down) and that is fine:
 *    `notifyPlayer` swallows every refusal, so the toast the manager sees
 *    reports the *write*, which is committed, and never the chat line.
 */

import "server-only";

import { revalidatePath } from "next/cache";

import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  lateStrikesMessage,
  noShowMessage,
  notifyPlayer,
  notifySessionLabel,
} from "@/lib/eitaa-notify";
import {
  ATTENDANCE_INVALID_LATE_MINUTES,
  ATTENDANCE_NOT_FOUND,
  ATTENDANCE_SESSION_NOT_FOUND,
  closeAttendance as closeAttendanceEngine,
  markAttendance as markAttendanceEngine,
  type AttendanceMark,
} from "@/server/attendance-core";

import type { CloseAttendanceOutcome, MarkAttendanceOutcome } from "./admin-results";

/** Ids are cuids; anything longer did not come from this app. */
const RegistrationIdSchema = z.string().min(1).max(64);
const SessionIdSchema = z.string().min(1).max(64);

/**
 * The manager's three answers, shape-checked.
 *
 * The minute range is checked here too, but the engine is the authority: a
 * direct caller (the harness, a hand-made request) is refused with the very
 * same sentence from `ATTENDANCE_INVALID_LATE_MINUTES`.
 */
const MarkSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("PRESENT") }),
  z.object({ status: z.literal("LATE"), lateMinutes: z.number().int().min(1).max(720) }),
  z.object({ status: z.literal("ABSENT") }),
]);

/** Said for a bad id and for a missing admin session alike — one refusal either way. */
const ADMIN_REQUIRED = "دسترسی مدیر لازمه.";

/**
 * The revalidation every attendance write shares: the manager's session screen,
 * the player's own surfaces (the roster, «سابقه‌ی من» and the ban card all just
 * changed) and the home board's stage.
 */
function revalidateAttendance(sessionId: string): void {
  revalidatePath("/");
  revalidatePath("/my");
  revalidatePath("/profile");
  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/admin/sessions");
  revalidatePath(`/admin/sessions/${sessionId}`);
}

/**
 * The manager's session, or `null`.
 *
 * `requireAdmin` throws for a missing session *and* for a player: both answers
 * are the same refusal, because the caller is a client that must learn nothing
 * about who is an admin.
 */
async function adminIdOrNull(): Promise<string | null> {
  try {
    const admin = await requireAdmin();
    return admin.id;
  } catch {
    return null;
  }
}

/**
 * «حاضر» / «تاخیر (دقیقه)» / «غایب» on one seat.
 *
 * On success the row is committed, the screens that show it are revalidated, and
 * the player hears about it — but only when this mark actually charged something:
 * a no-show ban or a strike ban. A present mark and a late mark that did not
 * reach the threshold write nothing to the player's record, so there is nothing
 * to announce.
 */
export async function markAttendance(
  registrationId: string,
  mark: AttendanceMark,
): Promise<MarkAttendanceOutcome> {
  const parsedId = RegistrationIdSchema.safeParse(registrationId);
  if (!parsedId.success) {
    return { ok: false, code: "NOT_FOUND", error: ATTENDANCE_NOT_FOUND };
  }

  const adminId = await adminIdOrNull();
  if (!adminId) {
    return { ok: false, code: "AUTH", error: ADMIN_REQUIRED };
  }

  const parsedMark = MarkSchema.safeParse(mark);
  if (!parsedMark.success) {
    return { ok: false, code: "INVALID", error: ATTENDANCE_INVALID_LATE_MINUTES };
  }

  // One clock for the whole request, handed to the engine: the guards, the
  // `markedAt` stamp, the strike window and the ban's end all agree on "now".
  const now = new Date();
  const outcome = await markAttendanceEngine(prisma, {
    registrationId: parsedId.data,
    mark: parsedMark.data,
    adminId,
    now,
  });

  if (!outcome.ok) return outcome;

  // The write is committed; tell the screens that show it.
  revalidateAttendance(outcome.sessionId);

  if (outcome.penalty) {
    const label = notifySessionLabel(outcome.sessionTitle, outcome.startsAt);
    const player = await prisma.user.findUnique({
      where: { id: outcome.userId },
      select: { eitaaId: true },
    });

    if (player) {
      void notifyPlayer(
        player.eitaaId,
        outcome.penalty.type === "NO_SHOW"
          ? noShowMessage({ label, days: outcome.penalty.days })
          : lateStrikesMessage({ days: outcome.penalty.days }),
      );
    }
  }

  // The engine's extra fields (the session's name and start, the player's id)
  // stay on this side of the wire.
  return {
    ok: true,
    attendance: outcome.attendance,
    lateMinutes: outcome.lateMinutes,
    lateStrikes: outcome.lateStrikes,
    penalty: outcome.penalty ? { type: outcome.penalty.type, days: outcome.penalty.days } : null,
  };
}

/**
 * «بستن حضور و غیاب» — the seats the manager never touched become غایب, and each
 * one is charged once.
 *
 * Idempotent (the engine sweeps only `PENDING` seats), so the confirm dialog's
 * one tap is safe however many times it lands: the second call answers
 * `closed: 0` and messages nobody.
 */
export async function closeAttendance(sessionId: string): Promise<CloseAttendanceOutcome> {
  const parsedId = SessionIdSchema.safeParse(sessionId);
  if (!parsedId.success) {
    return { ok: false, code: "NOT_FOUND", error: ATTENDANCE_SESSION_NOT_FOUND };
  }

  const adminId = await adminIdOrNull();
  if (!adminId) {
    return { ok: false, code: "AUTH", error: ADMIN_REQUIRED };
  }

  const now = new Date();
  const outcome = await closeAttendanceEngine(prisma, { sessionId: parsedId.data, adminId, now });

  if (!outcome.ok) return outcome;

  revalidateAttendance(outcome.sessionId);

  // One message per freshly-charged player, after the commit, none of them
  // blocking — the sweep already happened and a dead API cannot undo it.
  const label = notifySessionLabel(outcome.sessionTitle, outcome.startsAt);
  for (const player of outcome.penalties) {
    void notifyPlayer(player.eitaaId, noShowMessage({ label, days: player.days }));
  }

  // The identity of every penalized player stays here; the browser gets the two
  // counts the dialog's closing toast needs.
  return { ok: true, closed: outcome.closed, penalized: outcome.penalties.length };
}
