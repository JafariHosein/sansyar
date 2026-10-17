/**
 * The two seat engines of §۵.۲ — **allocation** (`registerSeat`) and **release +
 * promotion** (`cancelSeat`).
 *
 * They live outside the `"use server"` modules so each transaction body has one
 * home and more than one caller: `registerForSession` / `cancelRegistration`
 * (thin shells that own auth, validation, revalidation, the toast copy and the
 * fire-and-forget Eitaa messages) and `scripts/check-registration-race.ts`, which
 * fires thirty concurrent registrations at one سانس and asserts the exact seat
 * counts.
 *
 * The **membership gate** (the owner's newest round) lives one layer up, on the
 * account: `src/server/membership-core.ts` owns the manager's one-time decision,
 * and `registerSeat` refuses anybody who has not passed it. There is no
 * per-seat approval left — a seat an approved member asks for is theirs.
 *
 * Two design rules, both there for that harness:
 *
 *  - **The client is injected** (`db: PrismaClient`). `src/lib/db.ts` is marked
 *    `server-only`, so a plain `tsx` script cannot import it; this module
 *    therefore carries no `server-only` marker itself, never touches the
 *    cookie/session layer and never imports `src/lib/eitaa-notify.ts` (whose
 *    texts are the action shells' business).
 *  - **The clock is injected** (`now?: Date`, one value per call). Every guard,
 *    the queue order and the rows written agree on what "now" means — a caller
 *    that already resolved a clock (the harness, a future test) hands its own
 *    `Date` in instead of the transaction reading a second one.
 *
 * Every transaction serializes on the session row (`SELECT … FOR UPDATE`)
 * **before** anything is counted: InnoDB holds that exclusive lock until the
 * transaction ends, so the loser of a race reads what the winner committed.
 * Counts are always `count()`s — `Session` carries no counter column, and the
 * unique index on `(sessionId, userId)` is the last line of defence.
 *
 * **Occupancy is `CONFIRMED`** — the seats people actually hold. A `WAITLIST`
 * row holds nothing, owes nothing, and the moment a seat frees it is promoted
 * **straight into `CONFIRMED`**: the membership gate already vetted the person,
 * so there is no second door.
 *
 * The **balance round** (the owner's newest instruction) moved money into both
 * transactions: every seat that becomes the player's spends the account's
 * balance first — a fresh registration, a revival and a waitlist promotion all
 * go through `chargeSeatFromBalance` — and every seat that carried money hands
 * it back to the balance when it is given up (`refundSeatToBalance`). Both live
 * in `src/server/balance-core.ts`, which also owns the one lock order for the
 * multi-account case (refund the canceler, charge the promoted waiter).
 *
 * The success results carry more than a screen needs (the promoted player's
 * Eitaa id, the session title and start) so the action shells can send their
 * notifications after the commit; the shells **strip those fields before
 * anything reaches a browser** — one player's Eitaa id must never travel to
 * another player's client.
 */

import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import { cancelRefundToman } from "@/lib/balance";
import { formatJalaliDayMonth } from "@/lib/jalali";
import {
  cancelVerdictNow,
  DEFAULT_CANCEL_RULES,
  resolveCancelRules,
  sessionStage,
  waitlistCancelVerdict,
  type CancelVerdictKind,
  type PaymentStatus,
} from "@/lib/sessions";

import { chargeSeatFromBalance, lockBalances, refundSeatToBalance } from "@/server/balance-core";
import type {
  CancelFailureCode,
  RegisterOutcome,
} from "@/server/actions/results";

/** One day in milliseconds — the unit every penalty window is expressed in. */
const DAY_MS = 86_400_000;

/** Said for a bad id, a missing session and a draft alike — a draft is not a session. */
export const SESSION_NOT_FOUND = "این سانس رو پیدا نکردیم.";

/** The friendly answer to a re-tap; also the fallback when the unique index fires. */
export const ALREADY_REGISTERED = "قبلاً برای این سانس ثبت‌نام کردی.";

/**
 * The membership gate, said as a refusal: a fresh account waits for the manager
 * before it can touch a سانس. This is the engine's half of the gate — the client
 * shows the waiting screen, but the rule is enforced here.
 */
export const MEMBER_PENDING = "عضویتت هنوز تأیید نشده — مدیر که تأییدت کنه می‌تونی سانس بگیری.";

/** The rejected half of the same gate. Rejection is not final: the manager can re-approve. */
export const MEMBER_REJECTED =
  "درخواست عضویتت تأیید نشده — اگه فکر می‌کنی اشتباهه با مدیر سالن هماهنگ کن.";

/** A valid cookie pointing at a row that is gone — reopen the app, as the shell says. */
const MEMBER_MISSING = "حسابت رو پیدا نکردیم — سانس‌یار رو ببند و از ایتا دوباره باز کن.";

/** Prisma unique-constraint violation, checked without depending on error classes. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

export type RegisterSeatInput = {
  sessionId: string;
  userId: string;
  /** The request clock. Defaults to `new Date()`. */
  now?: Date;
};

/**
 * ONE registration attempt, end to end — the transaction body of
 * «ثبت‌نام در سانس».
 *
 * Guard precedence is unchanged from the action that used to inline it: an
 * active ban outranks everything, then the **membership gate** (an account the
 * manager has not approved can do nothing here), then the session (`NOT_FOUND`
 * for a bad id or a draft, then the stage: `NOT_OPEN` / `CLOSED`), then "already
 * on the list", and only then capacity. `open` and `full` both accept the tap —
 * a full سانس answers with `WAITLIST` and the position in line, never with a
 * refusal.
 *
 * A free seat is **`CONFIRMED`** the moment it is asked for — the person passed
 * the membership gate, so no second approval exists. The waitlist is the answer
 * when the hall is full (`occupancy >= capacity`, occupancy being `CONFIRMED`).
 *
 * The P2002 fallback is here too: if two requests still raced the unique index
 * (the lock should already have turned a double tap into `ALREADY`), that is the
 * same answer, not a server error. Anything else is a real failure and is
 * rethrown.
 */
export async function registerSeat(
  db: PrismaClient,
  input: RegisterSeatInput,
): Promise<RegisterOutcome> {
  const { sessionId: id, userId } = input;
  const now = input.now ?? new Date();

  try {
    return await db.$transaction(async (tx): Promise<RegisterOutcome> => {
      // 1. Serialize on the session row — the whole trick of this action.
      //
      //    InnoDB keeps this exclusive lock until the transaction ends, so a
      //    second tap on the same سانس blocks here and only then counts the seats
      //    the winner has already committed: the last seat cannot be taken twice.
      //    The lock must come *before* the reads below — a locking read takes the
      //    latest committed row and does not open the transaction's snapshot, so
      //    the counts that follow see the winner's insert instead of a stale copy.
      //
      //    The table is literally named `Session`, so it is backtick-quoted here.
      await tx.$queryRaw`SELECT id FROM \`Session\` WHERE id = ${id} FOR UPDATE`;

      // 2. An active ban closes every سانس for this player. Read *first* so the
      //    refusal outranks the session guards (as it did before the extraction)
      //    and inside the transaction so it is the same committed state the
      //    insert below will see. The predicate is `getActiveBan`
      //    (`src/server/penalties.ts`) verbatim: `endsAt > now`, `waivedAt = null`
      //    and `days > 0` — `days = 0` is an «اخطار» and never bans.
      const ban = await tx.penalty.findFirst({
        where: { userId, waivedAt: null, days: { gt: 0 }, endsAt: { gt: now } },
        orderBy: { endsAt: "desc" },
        select: { endsAt: true },
      });
      if (ban) {
        return {
          ok: false,
          code: "BANNED",
          error: `تا ${formatJalaliDayMonth(ban.endsAt)} محروم هستی و فعلاً نمی‌تونی ثبت‌نام کنی.`,
          bannedUntil: ban.endsAt.toISOString(),
        };
      }

      // 3. The membership gate (the owner's newest round): only an account the
      //    manager has approved can hold a seat. The row is **locked** — not for
      //    the snapshot but to serialize with the manager's own approve/reject
      //    (`decideMembership` locks this very row), so a request arriving while
      //    a rejection commits either sees `REJECTED` or joins after an approval,
      //    never a stale `APPROVED`.
      //
      //    This is the gate's server half: the client shows the waiting screen,
      //    and this is what makes it true even for a hand-made request. (It comes
      //    after the session lock on purpose — the engine's one lock order is
      //    session → user, and nothing takes them the other way round.)
      const memberRows = await tx.$queryRaw<Array<{ membershipStatus: string }>>`
        SELECT membershipStatus FROM \`User\` WHERE id = ${userId} FOR UPDATE`;
      const membershipStatus = memberRows[0]?.membershipStatus ?? null;
      if (membershipStatus === null) {
        return { ok: false, code: "AUTH", error: MEMBER_MISSING };
      }
      if (membershipStatus !== "APPROVED") {
        return {
          ok: false,
          code: "NOT_APPROVED",
          error: membershipStatus === "REJECTED" ? MEMBER_REJECTED : MEMBER_PENDING,
        };
      }

      // 4. The slot itself.
      const session = await tx.session.findUnique({
        where: { id },
        select: {
          status: true,
          startsAt: true,
          endsAt: true,
          registrationOpensAt: true,
          registrationClosesAt: true,
          capacity: true,
          priceToman: true,
          paymentMode: true,
        },
      });

      if (!session || session.status === "DRAFT") {
        return { ok: false, code: "NOT_FOUND", error: SESSION_NOT_FOUND };
      }
      if (session.status === "CANCELED") {
        return { ok: false, code: "CLOSED", error: "این سانس رو مدیر لغو کرده — ثبت‌نامی نمی‌گیره." };
      }

      // 5. Already on the list? The friendly answer — and it keeps a re-tap from
      //    touching a row at all. `CANCELED` is the one status that may be
      //    revived; a `CONFIRMED` seat or a place in the queue is already the
      //    answer the player is looking for.
      const existing = await tx.registration.findUnique({
        where: { sessionId_userId: { sessionId: id, userId } },
        select: { status: true },
      });
      if (existing && existing.status !== "CANCELED") {
        return { ok: false, code: "ALREADY", error: ALREADY_REGISTERED };
      }

      // 6. The seats, counted after the lock. Occupancy is **`CONFIRMED`** — the
      //    seats people hold. The counts come before the stage because «در حال
      //    ثبت‌نام» vs «ظرفیت پر» is a capacity question.
      const confirmedCount = await tx.registration.count({
        where: { sessionId: id, status: "CONFIRMED" },
      });
      const waitlistCount = await tx.registration.count({
        where: { sessionId: id, status: "WAITLIST" },
      });
      const occupiedCount = confirmedCount;

      const stage = sessionStage(
        {
          status: session.status,
          startsAt: session.startsAt,
          endsAt: session.endsAt,
          registrationOpensAt: session.registrationOpensAt,
          registrationClosesAt: session.registrationClosesAt,
          capacity: session.capacity,
          occupiedCount,
        },
        now,
      );

      if (stage === "upcoming") {
        return { ok: false, code: "NOT_OPEN", error: "ثبت‌نام این سانس هنوز باز نشده." };
      }
      // "open" and "full" are the two stages that accept a tap; a full session
      // still accepts it — the extra player just waits in line.
      if (stage !== "open" && stage !== "full") {
        return { ok: false, code: "CLOSED", error: "ثبت‌نام این سانس بسته شده." };
      }

      // 7. Hold a seat if one is free — a seat an approved member asks for is
      //    theirs — otherwise queue up behind the current line.
      const status = occupiedCount >= session.capacity ? "WAITLIST" : "CONFIRMED";
      const waitlistPosition = status === "WAITLIST" ? waitlistCount + 1 : null;

      // Each attempt starts from a clean seat: unpaid, unmarked, not canceled,
      // and not promoted — a promotion is a fact about *that* event, so a player
      // who left and came back must not inherit the old chip. The price is
      // **snapshotted** here: a later edit to the session's price never
      // re-prices a seat that was already taken.
      const seat = {
        status,
        paymentStatus: "UNPAID",
        amountToman: session.priceToman,
        paidFromBalance: 0,
        attendance: "PENDING",
        canceledAt: null,
        cancelType: null,
        paidAt: null,
        promotedAt: null,
        lateMinutes: null,
        markedAt: null,
      } as const;

      let registrationId: string;
      if (existing) {
        // Revive the canceled row rather than inserting a second one — the
        // unique index allows exactly one registration per session and player.
        const row = await tx.registration.update({
          where: { sessionId_userId: { sessionId: id, userId } },
          data: {
            ...seat,
            // Waitlist order is `createdAt`, so a player who left and came back
            // belongs at the *back* of the queue, not in their old spot.
            createdAt: now,
          },
          select: { id: true },
        });
        registrationId = row.id;
      } else {
        const row = await tx.registration.create({
          data: { sessionId: id, userId, createdAt: now, ...seat },
          select: { id: true },
        });
        registrationId = row.id;
      }

      // 8. The balance pays first (the owner's rule): the account's money is
      //    spent on the seat before anybody is asked for cash. A waitlisted row
      //    spends nothing — a place in line holds no seat — and pays the moment
      //    its promotion lands it in the hall.
      //
      //    The account row is already locked above (the membership read), so the
      //    charge simply reads the balance this transaction holds.
      const charge =
        status === "CONFIRMED"
          ? await chargeSeatFromBalance(tx, {
              registrationId,
              userId,
              sessionId: id,
              amountToman: session.priceToman,
              paidFromBalance: 0,
              paymentStatus: "UNPAID",
              now,
            })
          : null;

      return {
        ok: true,
        status,
        waitlistPosition,
        amountToman: session.priceToman,
        fromBalance: charge?.applied ?? 0,
        paymentStatus: charge?.paymentStatus ?? "UNPAID",
      };
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return { ok: false, code: "ALREADY", error: ALREADY_REGISTERED };
  }
}

export type CancelSeatInput = {
  sessionId: string;
  userId: string;
  /** The request clock. Defaults to `new Date()`. */
  now?: Date;
};

/**
 * §۵.۲: the waiter a freed seat goes to — found, not yet promoted.
 *
 * The queue order is `createdAt`, and the id breaks the tie between rows that
 * share a millisecond (thirty taps arriving together is the normal case here),
 * so "first in line" is reproducible.
 *
 * The money columns travel with the identity: the caller locks every account
 * this cancel will touch (the canceler's refund and the waiter's charge) in one
 * global order *before* either write, then hands the waiter over to
 * `promoteFromQueue`.
 */
type NextWaiter = {
  id: string;
  userId: string;
  eitaaId: string;
  amountToman: number;
  paidFromBalance: number;
  paymentStatus: PaymentStatus;
};

/**
 * The waiter a freed seat goes to — found, not yet promoted. Shared with the
 * manager's own removal (`admin-session-manage.ts`), because "first in line"
 * must mean one thing: the same query, the same `createdAt`-then-`id` order.
 */
export async function findNextWaiter(
  tx: Prisma.TransactionClient,
  sessionId: string,
): Promise<NextWaiter | null> {
  const waiter = await tx.registration.findFirst({
    where: { sessionId, status: "WAITLIST" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      userId: true,
      amountToman: true,
      paidFromBalance: true,
      paymentStatus: true,
      user: { select: { eitaaId: true } },
    },
  });

  if (!waiter) return null;

  return {
    id: waiter.id,
    userId: waiter.userId,
    eitaaId: waiter.user.eitaaId,
    amountToman: waiter.amountToman,
    paidFromBalance: waiter.paidFromBalance,
    paymentStatus: waiter.paymentStatus,
  };
}

/**
 * The promoted row lands **straight in `CONFIRMED`** — the membership gate
 * already vetted the person, so the seat is theirs the moment it frees (the
 * owner's flow) — and the seat's money is settled in the same breath: whatever
 * the account's balance covers comes off, exactly like a fresh registration.
 * Usually the waiter is `UNPAID` with a zero balance part, but the charge is the
 * same rule every seat goes through, never a special case.
 *
 * Returns the promoted player's identity for the caller's notification.
 *
 * Exported too: the manager's «حذف ثبتنام» frees the same seat and must land
 * its promotion the same way.
 */
export async function promoteFromQueue(
  tx: Prisma.TransactionClient,
  sessionId: string,
  waiter: NextWaiter,
  now: Date,
): Promise<{ userId: string; eitaaId: string }> {
  await tx.registration.update({
    where: { id: waiter.id },
    data: { status: "CONFIRMED", promotedAt: now },
  });

  await chargeSeatFromBalance(tx, {
    registrationId: waiter.id,
    userId: waiter.userId,
    sessionId,
    amountToman: waiter.amountToman,
    paidFromBalance: waiter.paidFromBalance,
    paymentStatus: waiter.paymentStatus,
    now,
  });

  return { userId: waiter.userId, eitaaId: waiter.eitaaId };
}

/**
 * The engine's answer to «لغو ثبت‌نام». Richer than the `CancelOutcome` a screen
 * receives: the shell (`cancelRegistration`) needs the session's name and start —
 * and the promoted player's Eitaa id — to send its fire-and-forget Eitaa message
 * **after** the commit, and it strips every one of those fields before the result
 * goes back to the browser.
 */
export type CancelEngineResult =
  | {
      ok: true;
      kind: CancelVerdictKind;
      penaltyDays: number;
      promoted: boolean;
      /** The promoted waiter's Eitaa id; `null` when nobody moved up. */
      promotedEitaaId: string | null;
      /** What this cancel sent back to the balance (0 when nothing moved). */
      refundedToman: number;
      sessionTitle: string;
      startsAt: Date;
    }
  | { ok: false; code: CancelFailureCode; error: string };

/**
 * ONE cancel, end to end — the transaction body of «لغو ثبت‌نام» (§۵.۴).
 *
 * Giving up a seat has three consequences and they must all happen or none of
 * them: the seat is released, the first person in line is promoted, and the
 * event may write one `Penalty` row. The verdict is recomputed here with the
 * **same helper the dialog used** (`cancelVerdictNow`) from the same two facts —
 * the resolved rules of this session and the player's late cancels inside the
 * warning window — so the engine can never write something the dialog did not
 * say. If the clock moved between opening the dialog and confirming, the engine
 * is right and the toast reports what actually happened.
 *
 * A **`WAITLIST`** row takes the other branch: the dialog used
 * `waitlistCancelVerdict()` and the engine returns exactly that, writing **no**
 * `Penalty` row whatever the clock says. The player was in line, never in the
 * hall — leaving frees a place in the queue, not a seat — so the settings and
 * penalty reads are skipped for them entirely.
 */
export async function cancelSeat(
  db: PrismaClient,
  input: CancelSeatInput,
): Promise<CancelEngineResult> {
  const { sessionId: id, userId } = input;
  const now = input.now ?? new Date();

  return db.$transaction(async (tx): Promise<CancelEngineResult> => {
    // 1. Serialize on the session row — the same trick as `registerSeat`, for a
    //    stronger reason: this request is about to promote the first waiter and
    //    possibly write a ban, and neither may happen twice.
    //
    //    InnoDB holds this exclusive lock until the transaction ends, so the
    //    loser of a race reads the rows the winner has already committed — it
    //    sees the seat as `CANCELED` and answers `ALREADY_CANCELED` (and, when
    //    two different seats are freed together, each cancel promotes exactly
    //    one waiter: the second one sees the queue the first one left behind).
    //
    //    The lock comes *before* every read below: a locking read sees the latest
    //    committed row and does not open the transaction's snapshot, so the state
    //    that follows is the winner's, not a stale copy.
    //
    //    The table is literally named `Session`, so it is backtick-quoted here.
    await tx.$queryRaw`SELECT id FROM \`Session\` WHERE id = ${id} FOR UPDATE`;

    // 2. The slot itself: the state/time columns the guards use and the twelve
    //    nullable override columns, so the row can be handed to
    //    `resolveCancelRules` as-is (money columns travel with it because a
    //    session row in this codebase always carries them).
    const session = await tx.session.findUnique({
      where: { id },
      select: {
        status: true,
        title: true,
        startsAt: true,
        endsAt: true,
        priceToman: true,
        paymentMode: true,
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

    if (!session || session.status === "DRAFT") {
      return { ok: false, code: "NOT_FOUND", error: SESSION_NOT_FOUND };
    }
    // The manager already released every seat of this session — and nobody left
    // early, so there is nothing to record against the player either.
    if (session.status === "CANCELED") {
      return {
        ok: false,
        code: "CLOSED",
        error: "این سانس رو مدیر لغو کرده — ثبت‌نامی برای لغو نمونده.",
      };
    }
    // From here on the session is PUBLISHED. Once it starts, giving up a seat is
    // over: attendance (§۵.۵) decides what a missing player means.
    if (now.getTime() >= session.startsAt.getTime()) {
      return {
        ok: false,
        code: "STARTED",
        error: "سانس شروع شده — لغو ثبت‌نام فقط تا قبل از شروع ممکنه.",
      };
    }

    // 3. The viewer's own seat — `@@unique([sessionId, userId])` allows one row.
    //    The pre-cancel status is kept because it decides whether a seat is
    //    actually freed: only a `CONFIRMED` seat holds a place in the hall, so
    //    only its release lets somebody in from the queue.
    const registration = await tx.registration.findUnique({
      where: { sessionId_userId: { sessionId: id, userId } },
      select: {
        id: true,
        status: true,
        amountToman: true,
        paidFromBalance: true,
        paymentStatus: true,
      },
    });
    if (!registration) {
      return { ok: false, code: "NOT_REGISTERED", error: "برای این سانس ثبت‌نامی نداری." };
    }
    if (registration.status === "CANCELED") {
      return { ok: false, code: "ALREADY_CANCELED", error: "این ثبت‌نام قبلاً لغو شده." };
    }

    const waitlistSeat = registration.status === "WAITLIST";
    const freedSeat = registration.status === "CONFIRMED";

    // 4. The rules in force for *this* session: the single settings row, then the
    //    session's overrides (a null column inherits). Skipped for a waitlisted
    //    row — no rule in this codebase can make leaving a queue cost anything.
    const setting = waitlistSeat ? null : await tx.setting.findUnique({ where: { id: 1 } });
    const rules = resolveCancelRules(setting ?? DEFAULT_CANCEL_RULES, session);

    // 5. The player's late cancels inside the warning window — the fact behind
    //    «اخطار اول».
    //
    //    Count the **events**, waived or not: §۵.۴ forgives the player's *first*
    //    late cancel, and a manager who later lifts that ban must not resurrect
    //    the forgiveness for the second one. Warning rows (`days = 0`) are events
    //    too, which is why this count filters on neither `days` nor `waivedAt`.
    const lateCancelsInWindow = waitlistSeat
      ? 0
      : await tx.penalty.count({
          where: {
            userId,
            type: "LATE_CANCEL",
            createdAt: { gte: new Date(now.getTime() - rules.lateCancelWarningWindowDays * DAY_MS) },
          },
        });

    // 6. The verdict — the very helper the confirm dialog used, from the same two
    //    facts, so what the player agreed to is exactly what gets written. A
    //    waitlisted row has exactly one verdict, and it is the dialog's.
    const verdict = waitlistSeat
      ? waitlistCancelVerdict()
      : cancelVerdictNow({
          startsAt: session.startsAt,
          rules,
          now,
          lateCancelsInWindow,
        });

    // 7. The money plan for this cancel (the owner's balance rule): a seat that
    //    carried money sends it back to the account's balance, and the player
    //    the freed seat promotes has their own balance charged. Find the waiter
    //    and lock every account this transaction will touch **here, in one
    //    global order** (ascending id) — a cancel that refunds one player while
    //    promoting another can then never deadlock with the mirrored cancel.
    //
    //    A waitlisted row leaving frees nothing, so no waiter is looked up and
    //    the refund is naturally zero (it never spent anything).
    const refundToman = cancelRefundToman(registration);
    const waiter = freedSeat ? await findNextWaiter(tx, id) : null;
    await lockBalances(tx, [
      ...(refundToman > 0 ? [userId] : []),
      ...(waiter ? [waiter.userId] : []),
    ]);

    // 8. Release the seat. `cancelType` records *why* the row ended: FREE inside
    //    the free window, LATE otherwise — including a pardoned late cancel,
    //    because the cancel *was* late and what it cost is the `Penalty` row's
    //    business.
    await tx.registration.update({
      where: { sessionId_userId: { sessionId: id, userId } },
      data: {
        status: "CANCELED",
        canceledAt: now,
        cancelType: verdict.kind === "FREE" ? "FREE" : "LATE",
      },
    });

    // 9. The money goes home: whatever the seat carried lands back on the
    //    balance in this same transaction — a released seat and its refund can
    //    never exist without each other. The row keeps its history
    //    (`paidFromBalance` stays as the record of what it once held); the
    //    ledger is what tells the player and the manager where the money went.
    const refund = await refundSeatToBalance(tx, {
      registrationId: registration.id,
      userId,
      sessionId: id,
      amountToman: registration.amountToman,
      paidFromBalance: registration.paidFromBalance,
      paymentStatus: registration.paymentStatus,
      now,
    });

    // 10. §۵.۲: a freed `CONFIRMED` seat goes to the first person in line, in
    //    the same transaction, so the queue and the seat count can never
    //    disagree. The promotion lands **straight in `CONFIRMED`** — the
    //    membership gate already vetted the person, so the seat is theirs the
    //    moment it frees — and its money is settled by `promoteWaiter`. A
    //    waitlisted row leaving frees nothing — the hall was already full.
    //
    //    `promotedAt` is what makes the promotion visible: `/my` chips it and the
    //    session page announces it. It is cleared by every fresh registration, so
    //    it only ever describes *this* promotion.
    const promoted = waiter ? await promoteFromQueue(tx, id, waiter, now) : null;

    // 11. §۵.۶: one `Penalty` row per event — and only when the event is real. A
    //    free cancel is not an event (and a waitlisted row never reaches this
    //    branch). Neither is a late cancel with the rule switched off
    //    (`LATE_PARDONED`): when the manager turned late-cancel penalties off,
    //    nothing is recorded against the player for leaving late.
    if (verdict.kind === "LATE_WARNING" || verdict.kind === "LATE_PENALTY") {
      // A warning has `days = 0` by definition — that is what keeps it out of
      // `getActiveBan` while still showing it in «سابقه‌ی من».
      const days = verdict.kind === "LATE_WARNING" ? 0 : verdict.penaltyDays;
      const reason =
        verdict.kind === "LATE_WARNING"
          ? "انصراف دیرهنگام — اخطار اول (بدون محرومیت)"
          : `انصراف دیرهنگام در ${formatJalaliDayMonth(session.startsAt)}`;

      await tx.penalty.create({
        data: {
          userId,
          type: "LATE_CANCEL",
          days,
          reason,
          startsAt: now,
          // A warning has no window: `endsAt` equals `startsAt`.
          endsAt: new Date(now.getTime() + days * DAY_MS),
          // The session that triggered it, so the history can name it.
          sessionId: id,
        },
      });
    }

    return {
      ok: true,
      kind: verdict.kind,
      penaltyDays: verdict.penaltyDays,
      promoted: promoted !== null,
      promotedEitaaId: promoted?.eitaaId ?? null,
      refundedToman: refund.refunded,
      sessionTitle: session.title,
      startsAt: session.startsAt,
    };
  });
}
