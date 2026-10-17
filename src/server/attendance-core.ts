/**
 * The **attendance engine** (PROMPT.md §۵.۵) — the manager's mark on one seat
 * (`markAttendance`) and the sweep that closes a سانس (`closeAttendance`) — plus
 * the two penalty events §۵.۶ charges for them (غیبت، تکرار تاخیر).
 *
 * It is the sibling of `src/server/registration-core.ts` and follows the same
 * two rules, for the same reason (the attendance harness drives it directly):
 *
 *  - **the client is injected** (`client: PrismaClient`) — `src/lib/db.ts` is
 *    marked `server-only`, so a plain `tsx` script cannot import it; this module
 *    therefore carries no `server-only` marker itself, never touches the
 *    cookie/session layer and never imports `src/lib/eitaa-notify.ts` (whose
 *    texts are the action shell's business);
 *  - **the clock is injected** (`now?: Date`, one value per call) — the guards,
 *    the `markedAt` stamp, the strike window and the ban's `endsAt` all agree on
 *    what "now" means.
 *
 * Every transaction **locks first**: a mark serializes on the registration row
 * (`SELECT … FOR UPDATE`), a close on the session row. InnoDB holds that lock
 * until the transaction ends, so two taps — or a close racing a mark — read what
 * the winner committed; and every penalty write re-counts its own event under
 * that lock, which is what makes «برای یک رویداد، جریمه‌ی تکراری نساز» true
 * (§۵.۶). A re-mark can only ever confirm the row it already wrote.
 *
 * Occupancy is `CONFIRMED`. Attendance is a fact about a seat in the hall, so a
 * `WAITLIST` row (or a canceled one) is refused with `NOT_CONFIRMED`, and the
 * close sweep touches `CONFIRMED` + `PENDING` rows only — a queue that never
 * entered the hall is never charged (§۵.۵, §۵.۶).
 */

import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import { toPersianDigits } from "@/lib/format";
import { formatJalaliDayMonth } from "@/lib/jalali";
import { DEFAULT_CANCEL_RULES, resolveCancelRules } from "@/lib/sessions";

import type { AttendanceFailureCode } from "@/server/actions/admin-results";

/** One day in milliseconds — the unit every penalty window is expressed in. */
const DAY_MS = 86_400_000;

/** The late-minutes range a mark may carry: 1 minute to 12 hours. */
const MIN_LATE_MINUTES = 1;
const MAX_LATE_MINUTES = 720;

// ---------------------------------------------------------------------------
// The engine's refusal copy — one home, exactly like `registration-core.ts`.
//
// The action shell imports these instead of repeating the sentences, so the
// engine and the browser can never say the same refusal two different ways.
// ---------------------------------------------------------------------------

/** A valid viewer pointing at a row that is gone (also the shell's answer to a bad id). */
export const ATTENDANCE_NOT_FOUND = "این ثبت‌نام پیدا نشد — صفحه رو دوباره باز کن.";

/** The close twin of the sentence above: the *session* is the row that is gone. */
export const ATTENDANCE_SESSION_NOT_FOUND = "این سانس پیدا نشد — صفحه رو دوباره باز کن.";

/** A `WAITLIST` row (or a canceled one) never entered the hall, so it has no attendance. */
export const ATTENDANCE_NOT_CONFIRMED =
  "این ردیف تو لیست انتظاره؛ حضور و غیاب فقط برای ثبت‌نام‌شده‌های سالنه.";

/** A سانس takes attendance once it has begun — never before. */
export const ATTENDANCE_NOT_STARTED =
  "این سانس هنوز شروع نشده — بعد از شروعش حضور و غیاب رو ثبت کن.";

/** The manager released everyone: there is nobody left to mark. */
export const ATTENDANCE_SESSION_CANCELED = "این سانس لغو شده و حضور و غیاب نداره.";

/** A draft is not a session yet. */
export const ATTENDANCE_SESSION_NOT_PUBLISHED = "این سانس هنوز منتشر نشده — اول منتشرش کن.";

/** The one INVALID case: a late mark without a sane minute count. */
export const ATTENDANCE_INVALID_LATE_MINUTES = "دقیقه‌ی تاخیر باید بین ۱ تا ۷۲۰ باشه.";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The manager's three answers on one seat (§۵.۵). */
export type AttendanceMark =
  | { status: "PRESENT" }
  | { status: "LATE"; lateMinutes: number }
  | { status: "ABSENT" };

/**
 * The engine's answer to one mark. Richer than the browser's view on purpose:
 * after the commit the shell needs the session's name and start to build the
 * message label, and the player's id to find the address — and it strips every
 * one of those fields before the result reaches a client.
 */
export type MarkAttendanceEngineOutcome =
  | {
      ok: true;
      registrationId: string;
      sessionId: string;
      sessionTitle: string;
      startsAt: Date;
      userId: string;
      attendance: "PRESENT" | "LATE" | "ABSENT";
      lateMinutes: number | null;
      /** Strike-lates inside the window after this mark; `null` for non-late marks. */
      lateStrikes: number | null;
      /** The ban this very mark wrote (never a second one for the same event). */
      penalty: { type: "NO_SHOW" | "LATE_STRIKES"; days: number; until: Date } | null;
    }
  | { ok: false; code: AttendanceFailureCode; error: string };

/**
 * One player the sweep just charged — identity included, because the shell
 * messages exactly these people (and nobody else) after the commit.
 */
type ClosedNoShow = { userId: string; eitaaId: string; name: string; days: number; until: Date };

/**
 * The engine's answer to a close. `penalties` carries one entry per freshly
 * written `NO_SHOW` row — name and Eitaa id included, because the shell messages
 * exactly those players and nobody else.
 */
export type CloseAttendanceEngineOutcome =
  | {
      ok: true;
      sessionId: string;
      sessionTitle: string;
      startsAt: Date;
      /** How many PENDING confirmed seats were swept to ABSENT. */
      closed: number;
      /** One entry per freshly written NO_SHOW row (the action shell messages them). */
      penalties: ClosedNoShow[];
    }
  | { ok: false; code: Exclude<AttendanceFailureCode, "NOT_CONFIRMED" | "INVALID">; error: string };

// ---------------------------------------------------------------------------
// The no-show writer — one home for the «غیبت» event (§۵.۶)
// ---------------------------------------------------------------------------

/**
 * Write the `NO_SHOW` row for one event — or nothing, when the event already has
 * one.
 *
 * The rule is §۵.۶'s «برای یک رویداد، جریمه‌ی تکراری نساز», and the count is the
 * whole implementation: the caller already holds the lock that serializes this
 * `(userId, sessionId)` event, so a re-mark and a sweep-racing-re-mark both read
 * the winner's row here and write nothing the second time.
 *
 * The caller owns `noShowEnabled`; this helper is only reached when the rule is
 * on, so a disabled no-show charge never even costs a query.
 */
async function writeNoShowPenalty(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    sessionId: string;
    /** The session's start — the day the reason names, not the mark's day. */
    startsAt: Date;
    days: number;
    adminId: string;
    now: Date;
  },
): Promise<{ days: number; until: Date } | null> {
  const existing = await tx.penalty.count({
    where: { userId: input.userId, sessionId: input.sessionId, type: "NO_SHOW" },
  });
  if (existing > 0) return null;

  const until = new Date(input.now.getTime() + input.days * DAY_MS);

  await tx.penalty.create({
    data: {
      userId: input.userId,
      type: "NO_SHOW",
      days: input.days,
      reason: `غیبت بدون انصراف در ${formatJalaliDayMonth(input.startsAt)}`,
      startsAt: input.now,
      endsAt: until,
      // The سانس that triggered it, so «سابقه‌ی من» can name it.
      sessionId: input.sessionId,
      // The manager whose mark wrote it — the admin trail §۵.۶ asks for.
      issuedByAdminId: input.adminId,
    },
  });

  return { days: input.days, until };
}

// ---------------------------------------------------------------------------
// §۵.۵ — one mark
// ---------------------------------------------------------------------------

/**
 * ONE attendance mark, end to end — the transaction body behind «حاضر» /
 * «تاخیر (دقیقه)» / «غایب».
 *
 * Guard precedence (each refusal carries its own sentence, so the toast the
 * manager sees is the reason the engine actually applied):
 *
 *   1. the registration is gone → `NOT_FOUND`;
 *   2. the سانس is canceled → `SESSION_CANCELED`;
 *   3. the سانس is a draft → `SESSION_NOT_PUBLISHED`;
 *   4. the row is not a seat in the hall → `NOT_CONFIRMED`;
 *   5. the clock has not reached the start → `NOT_STARTED`;
 *   6. a late mark without a sane minute count → `INVALID`.
 *
 * Then the mark is written (`attendance`, `lateMinutes`, `markedAt`) and the two
 * §۵.۶ events it can trigger are charged — exactly once each:
 *
 *  - **`ABSENT`** → one `NO_SHOW` row when `noShowEnabled`;
 *  - **`LATE`** → the strike ladder: strike-lates inside the window counted, and
 *    one `LATE_STRIKES` row per completed multiple of `lateStrikeCount`.
 *
 * The strike count is returned for late marks so the toast can say «سومین
 * تاخیرت تو ۳۰ روز»; `null` for present/absent marks — and for a late mark on a
 * session where the strike rule is switched off, because there is no ladder to
 * count against.
 */
export async function markAttendance(
  client: PrismaClient,
  input: { registrationId: string; mark: AttendanceMark; adminId: string; now?: Date },
): Promise<MarkAttendanceEngineOutcome> {
  const { registrationId, mark, adminId } = input;
  const now = input.now ?? new Date();

  return client.$transaction(async (tx): Promise<MarkAttendanceEngineOutcome> => {
    // 1. Serialize on the registration row — the whole trick of this action.
    //
    //    InnoDB keeps this exclusive lock until the transaction ends, so a second
    //    tap on the same seat blocks here and only then re-reads the row (and the
    //    penalty it may already carry). The lock must come *before* every read
    //    below: a locking read takes the latest committed row and does not open
    //    the transaction's snapshot, so the state that follows is the winner's,
    //    not a stale copy.
    await tx.$queryRaw`SELECT id FROM \`Registration\` WHERE id = ${registrationId} FOR UPDATE`;

    // 2. The seat, its سانس (the live state/time pair plus the twelve nullable
    //    override columns, so the row can be handed to `resolveCancelRules`
    //    as-is) and the player's identity for the caller's message.
    const registration = await tx.registration.findUnique({
      where: { id: registrationId },
      select: {
        id: true,
        status: true,
        userId: true,
        sessionId: true,
        session: {
          select: {
            status: true,
            title: true,
            startsAt: true,
            freeCancelHours: true,
            lateCancelEnabled: true,
            lateCancelPenaltyDays: true,
            lateCancelFirstWarning: true,
            lateCancelWarningWindowDays: true,
            noShowEnabled: true,
            noShowPenaltyDays: true,
            lateStrikesEnabled: true,
            lateThresholdMinutes: true,
            lateStrikeCount: true,
            lateStrikeWindowDays: true,
            lateStrikePenaltyDays: true,
          },
        },
        // The player is read with the seat so the transaction always knows whose
        // row it is marking. The close path hands that identity back in its own
        // answer; the mark path's answer carries the id only — the shell reads the
        // address when (and only when) a ban was really written.
        user: { select: { eitaaId: true, name: true } },
      },
    });

    if (!registration) {
      return { ok: false, code: "NOT_FOUND", error: ATTENDANCE_NOT_FOUND };
    }

    // 3. The guards, in the order the sentences are read out.
    const session = registration.session;

    if (session.status === "CANCELED") {
      return { ok: false, code: "SESSION_CANCELED", error: ATTENDANCE_SESSION_CANCELED };
    }
    if (session.status === "DRAFT") {
      return { ok: false, code: "SESSION_NOT_PUBLISHED", error: ATTENDANCE_SESSION_NOT_PUBLISHED };
    }
    if (registration.status !== "CONFIRMED") {
      return { ok: false, code: "NOT_CONFIRMED", error: ATTENDANCE_NOT_CONFIRMED };
    }
    if (now.getTime() < session.startsAt.getTime()) {
      return { ok: false, code: "NOT_STARTED", error: ATTENDANCE_NOT_STARTED };
    }

    // The late minutes, validated once so the stored figure and the strike count
    // below can never disagree. `AttendanceMark` types them as a number, but this
    // engine is also driven by a harness and by hand-made requests, so it checks.
    let lateMinutes: number | null = null;
    if (mark.status === "LATE") {
      const minutes: unknown = mark.lateMinutes;
      if (
        typeof minutes !== "number" ||
        !Number.isInteger(minutes) ||
        minutes < MIN_LATE_MINUTES ||
        minutes > MAX_LATE_MINUTES
      ) {
        return { ok: false, code: "INVALID", error: ATTENDANCE_INVALID_LATE_MINUTES };
      }
      lateMinutes = minutes;
    }

    // 4. The mark itself. `lateMinutes` is `null` for حاضر and غایب — a minute
    //    count nobody measured must not survive on the row.
    await tx.registration.update({
      where: { id: registration.id },
      data: { attendance: mark.status, lateMinutes, markedAt: now },
    });

    // 5. The rules in force for *this* session: the single settings row, then the
    //    session's overrides (a null column inherits).
    const setting = await tx.setting.findUnique({ where: { id: 1 } });
    const rules = resolveCancelRules(setting ?? DEFAULT_CANCEL_RULES, session);

    let penalty: { type: "NO_SHOW" | "LATE_STRIKES"; days: number; until: Date } | null = null;

    // 6. §۵.۶ — «غایب شدن»: one NO_SHOW row per event, when the manager's rule
    //    charges it. The writer re-counts under this transaction's lock, so a
    //    re-mark of the same event is a no-op. A mark is the newest word on the
    //    seat, so a later PRESENT/LATE mark does not delete the row — the penalty
    //    describes the event that happened, not the mark that followed it.
    if (mark.status === "ABSENT" && rules.noShowEnabled) {
      const written = await writeNoShowPenalty(tx, {
        userId: registration.userId,
        sessionId: registration.sessionId,
        startsAt: session.startsAt,
        days: rules.noShowPenaltyDays,
        adminId,
        now,
      });
      if (written) penalty = { type: "NO_SHOW", ...written };
    }

    // 7. §۵.۶ / §۵.۵ — «رسیدن به آستانه‌ی تاخیر». Only a LATE mark can move the
    //    ladder, and only when the rule is on with a sane threshold count.
    //
    //    The window is the mark's clock, not the session's: a late mark is an
    //    event at `now`, and the ladder counts the player's *qualifying* lates —
    //    «تاخیر بیشتر از lateThresholdMinutes» per §۵.۵, hence the strict `gt` —
    //    on sessions that started inside the window.
    let lateStrikes: number | null = null;
    if (mark.status === "LATE" && rules.lateStrikesEnabled && rules.lateStrikeCount >= 1) {
      const windowStart = new Date(now.getTime() - rules.lateStrikeWindowDays * DAY_MS);

      const strikesInWindow = await tx.registration.count({
        where: {
          userId: registration.userId,
          attendance: "LATE",
          lateMinutes: { gt: rules.lateThresholdMinutes },
          session: { is: { startsAt: { gte: windowStart } } },
        },
      });
      lateStrikes = strikesInWindow;

      // §۵.۶: one row per completed multiple, never one per late. `expected` is
      // the ladder's own answer (the 6th late with `lateStrikeCount = 3` writes
      // the second row), and `existing` counts **events**, waived or not — a
      // manager's pardon must not hand a strike back, exactly like the late-cancel
      // forgiveness in `cancelSeat`.
      const expected = Math.floor(strikesInWindow / rules.lateStrikeCount);
      const existing = await tx.penalty.count({
        where: { userId: registration.userId, type: "LATE_STRIKES", createdAt: { gte: windowStart } },
      });

      if (expected > existing) {
        const days = rules.lateStrikePenaltyDays;
        const until = new Date(now.getTime() + days * DAY_MS);

        await tx.penalty.create({
          data: {
            userId: registration.userId,
            type: "LATE_STRIKES",
            days,
            // The window and the count, so «سابقه‌ی من» can explain the ban
            // without re-deriving the ladder.
            reason: `تکرار تاخیر — ${toPersianDigits(strikesInWindow)} تاخیر در ${toPersianDigits(
              rules.lateStrikeWindowDays,
            )} روز`,
            startsAt: now,
            endsAt: until,
            sessionId: registration.sessionId,
            issuedByAdminId: adminId,
          },
        });

        penalty = { type: "LATE_STRIKES", days, until };
      }
    }

    return {
      ok: true,
      registrationId: registration.id,
      sessionId: registration.sessionId,
      sessionTitle: session.title,
      startsAt: session.startsAt,
      userId: registration.userId,
      attendance: mark.status,
      lateMinutes,
      lateStrikes,
      penalty,
    };
  });
}

// ---------------------------------------------------------------------------
// §۵.۵ — «بستن حضور و غیاب»
// ---------------------------------------------------------------------------

/**
 * End the attendance of one سانس: every seat still `PENDING` becomes `ABSENT`
 * and is charged as a no-show, in one transaction that locks the session row
 * first (so a double tap on «بستن حضور و غیاب» cannot sweep twice).
 *
 * The sweep is exactly §۵.۵'s sentence: «باقی‌مانده‌های PENDING را غایب می‌کند» —
 * so it is scoped to `CONFIRMED` seats and nothing else. A `WAITLIST` row never
 * entered the hall (occupancy is `CONFIRMED`), a `CANCELED` row is someone else's
 * story, and a seat the manager already marked is the manager's word.
 *
 * Idempotent by construction: a second close finds no `PENDING` seat, sweeps
 * nothing, writes nothing and answers `closed: 0` — and the `NO_SHOW` writer
 * re-counts each event anyway, so a mark that raced the close can never produce
 * a second row for the same no-show.
 *
 * The guards are the session's own (the registration sub-guards do not exist
 * here — there is no single row to judge).
 */
export async function closeAttendance(
  client: PrismaClient,
  input: { sessionId: string; adminId: string; now?: Date },
): Promise<CloseAttendanceEngineOutcome> {
  const { sessionId, adminId } = input;
  const now = input.now ?? new Date();

  return client.$transaction(async (tx): Promise<CloseAttendanceEngineOutcome> => {
    // 1. Serialize on the session row — the same trick as the seat engines, for
    //    the same reason: two closes must not both see the same `PENDING` seats,
    //    and a close must not race the mark that is about to write the same ban.
    //
    //    The table is literally named `Session`, so it is backtick-quoted here.
    await tx.$queryRaw`SELECT id FROM \`Session\` WHERE id = ${sessionId} FOR UPDATE`;

    // 2. The slot: the live state/time pair plus the twelve nullable override
    //    columns, so the row can be handed to `resolveCancelRules` as-is.
    const session = await tx.session.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        status: true,
        title: true,
        startsAt: true,
        freeCancelHours: true,
        lateCancelEnabled: true,
        lateCancelPenaltyDays: true,
        lateCancelFirstWarning: true,
        lateCancelWarningWindowDays: true,
        noShowEnabled: true,
        noShowPenaltyDays: true,
        lateStrikesEnabled: true,
        lateThresholdMinutes: true,
        lateStrikeCount: true,
        lateStrikeWindowDays: true,
        lateStrikePenaltyDays: true,
      },
    });

    if (!session) {
      return { ok: false, code: "NOT_FOUND", error: ATTENDANCE_SESSION_NOT_FOUND };
    }
    if (session.status === "CANCELED") {
      return { ok: false, code: "SESSION_CANCELED", error: ATTENDANCE_SESSION_CANCELED };
    }
    if (session.status === "DRAFT") {
      return { ok: false, code: "SESSION_NOT_PUBLISHED", error: ATTENDANCE_SESSION_NOT_PUBLISHED };
    }
    // A first whistle decides: the sweep only exists after the سانس has begun.
    if (now.getTime() < session.startsAt.getTime()) {
      return { ok: false, code: "NOT_STARTED", error: ATTENDANCE_NOT_STARTED };
    }

    const setting = await tx.setting.findUnique({ where: { id: 1 } });
    const rules = resolveCancelRules(setting ?? DEFAULT_CANCEL_RULES, session);

    // 3. The seats the manager never touched, oldest first — the sweep order is
    //    the roster's order, so the notices that follow read the way the roster
    //    does. The player joins in: the shell messages exactly these rows.
    const pendingSeats = await tx.registration.findMany({
      where: { sessionId, status: "CONFIRMED", attendance: "PENDING" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        userId: true,
        user: { select: { eitaaId: true, name: true } },
      },
    });

    const penalties: ClosedNoShow[] = [];

    for (const seat of pendingSeats) {
      await tx.registration.update({
        where: { id: seat.id },
        data: { attendance: "ABSENT", lateMinutes: null, markedAt: now },
      });

      if (!rules.noShowEnabled) continue;

      const written = await writeNoShowPenalty(tx, {
        userId: seat.userId,
        sessionId,
        startsAt: session.startsAt,
        days: rules.noShowPenaltyDays,
        adminId,
        now,
      });

      if (written) {
        penalties.push({
          userId: seat.userId,
          eitaaId: seat.user.eitaaId,
          name: seat.user.name,
          days: written.days,
          until: written.until,
        });
      }
    }

    return {
      ok: true,
      sessionId: session.id,
      sessionTitle: session.title,
      startsAt: session.startsAt,
      closed: pendingSeats.length,
      penalties,
    };
  });
}

