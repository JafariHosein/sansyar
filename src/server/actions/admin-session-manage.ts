"use server";

/**
 * The manager's **per-session writes** — `/admin/sessions/[id]` (PROMPT.md §۶.۴):
 * «تغییر وضعیت پرداخت»، «حذف ثبت‌نام»، «ارتقای دستی از لیست انتظار» and «لغو کل
 * سانس».
 *
 * It is the sibling of `src/server/actions/attendance.ts` (the marks on the same
 * board) and owns exactly what a server action must own: the zod checks, the
 * `requireAdmin()` guard, the transactions, the revalidation and the
 * fire-and-forget Eitaa messages. The published/draft switch lives next door in
 * `./admin-sessions` — this module never touches `Session.status` except to
 * *refuse* a canceled session.
 *
 * Three rules shape every write below:
 *
 *  - **the session row is locked first** (`SELECT … FOR UPDATE`), before any plain
 *    read inside the transaction. `registerSeat`/`cancelSeat` lock the same row,
 *    so a manager's removal and a player's own registration serialize on it —
 *    and `updateMany`/`findMany` after the lock read the winner's state, not a
 *    stale snapshot;
 *  - **the lock order is session → registration**, exactly like the seat engine:
 *    the row's `sessionId` is therefore discovered with a read *outside* the
 *    transaction, and nothing here ever takes the two locks the other way round;
 *  - **one Eitaa message per event, after the commit, none of them blocking.**
 *    `notifyPlayer` swallows every refusal (no credit, closed program, API down)
 *    and logs it, so a message can never undo a write that already happened.
 *
 * Two honest limits, both deliberate:
 *
 *  - **removing a seat messages only the promoted waiter.** The player who lost
 *    the seat is the manager's own conversation (they are the one who decided),
 *    and there is no builder for that sentence — inventing one here would put the
 *    same event's wording in two homes;
 *  - **a manual promotion messages nobody.** `promotedMessage` is about a seat
 *    that *freed* and a queue that moved by itself; a manager pulling somebody up
 *    is a different event, and the app already tells the player on their own
 *    screen (`/my`, the session page). The dialog says out loud that the manager
 *    should tell them.
 *
 * The **balance round** (the owner's newest instruction) puts money on this board
 * too: a write that takes a seat back — «حذف ثبت‌نام» or «لغو کل سانس» — sends
 * the seat's money to the player's balance in the same transaction
 * (`refundSeatToBalance`), and a promotion — automatic here or by hand — charges
 * the promoted account exactly like a fresh registration
 * (`chargeSeatFromBalance`). A seat the balance settled entirely is
 * `PAID_BALANCE` and the payment select refuses to re-mark it: that money moved.
 */

import "server-only";

import { revalidatePath } from "next/cache";

import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";

import { requireAdmin } from "@/lib/auth";
import { cancelRefundToman, seatOutstanding } from "@/lib/balance";
import { prisma } from "@/lib/db";
import {
  notifyPlayer,
  notifySessionLabel,
  notifySessionLink,
  promotedMessage,
  sessionCanceledMessage,
} from "@/lib/eitaa-notify";
import { isPaidSeat, type PaymentStatus } from "@/lib/sessions";

import { chargeSeatFromBalance, lockBalances, refundSeatToBalance } from "@/server/balance-core";
import { findNextWaiter, promoteFromQueue } from "@/server/registration-core";

import type {
  CancelSessionOutcome,
  PromoteWaiterOutcome,
  RegistrationAdminFailureCode,
  RemoveRegistrationOutcome,
  SetPaymentOutcome,
} from "./admin-results";

/** Ids are cuids; anything longer did not come from this app. */
const RegistrationIdSchema = z.string().min(1).max(64);
const SessionIdSchema = z.string().min(1).max(64);

/** The four states the manager's payment select offers, shape-checked. */
const PaymentStatusSchema = z.enum(["UNPAID", "PAID_ONLINE", "PAID_IN_PERSON", "WAIVED"]);

/** Said for a bad payload and for a missing admin session alike — one refusal either way. */
const ADMIN_REQUIRED = "دسترسی مدیر لازمه.";

const SESSION_NOT_FOUND = "این سانس پیدا نشد — از فهرست سانس‌ها بازش کن.";
const SEAT_NOT_FOUND = "این ثبت‌نام پیدا نشد — صفحه رو دوباره باز کن.";
const SESSION_CANCELED = "این سانس لغو شده — ثبت‌نامش دیگه تغییر نمی‌کنه.";
const SESSION_ALREADY_CANCELED = "این سانس قبلاً لغو شده.";
const SEAT_ALREADY_CANCELED = "این ثبت‌نام قبلاً لغو شده.";
const PAYMENT_ALREADY = "وضعیت پرداخت همین حالا همینه.";
const PAYMENT_INVALID = "این وضعیت پرداخت شناخته‌شده نیست.";
const PROMOTE_ALREADY_SEAT = "این نفر همین حالا صاحب صندلیه.";
const PROMOTE_NOT_IN_LINE = "این ثبت‌نام تو لیست انتظار نیست — فقط ردیف‌های لیست انتظار بالا میاد.";
const PAYMENT_FROM_BALANCE =
  "این ثبت‌نام از موجودی حساب تسویه شده — دستی تغییرش نمی‌کنیم. اصلاحش از صفحهٔ خود کاربر انجام می‌شه.";

/**
 * The manager's session, or `null`.
 *
 * `requireAdmin` throws for a missing session *and* for a player, and both
 * answers are the same refusal: the caller is a browser that must learn nothing
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
 * Serialize on the session row — the whole trick of every write here.
 *
 * InnoDB holds this exclusive lock until the transaction ends, so two manager
 * taps (or a tap racing a player's own registration, which takes the very same
 * lock) can never read the same seats and both act on them. The table is
 * literally named `Session`, so it is backtick-quoted.
 */
async function lockSession(tx: Prisma.TransactionClient, sessionId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM \`Session\` WHERE id = ${sessionId} FOR UPDATE`;
}

/**
 * The paths one board write changes: the manager's own screens and every player
 * surface that shows the same seat — the board, the ledger, the session page and
 * the **profile**, where the balance card lives (a removal or a whole-session
 * cancel sends money back to a player's wallet, and the promoted seat spends it).
 */
function revalidateSessionBoard(sessionId: string): void {
  revalidatePath("/");
  revalidatePath("/my");
  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/profile");
  revalidatePath("/admin/sessions");
  revalidatePath(`/admin/sessions/${sessionId}`);
}

/** The seat's own session id, read *outside* the transaction (see the lock order above). */
async function sessionIdOfSeat(
  registrationId: string,
): Promise<{ sessionId: string } | { ok: false; code: RegistrationAdminFailureCode; error: string }> {
  const target = await prisma.registration.findUnique({
    where: { id: registrationId },
    select: { sessionId: true },
  });

  if (!target) return { ok: false, code: "NOT_FOUND", error: SEAT_NOT_FOUND };
  return { sessionId: target.sessionId };
}

// ---------------------------------------------------------------------------
// «تغییر وضعیت پرداخت»
// ---------------------------------------------------------------------------

type SetPaymentEngine =
  | { ok: true; sessionId: string }
  | { ok: false; code: RegistrationAdminFailureCode; error: string };

/**
 * Where one seat stands in the hall's books (§۵.۳).
 *
 * The write is the manager's whole ledger line, so it is a compare-and-set like
 * every other money write in this app: the state is only changed when it is
 * actually different (`ALREADY` otherwise), and the two paid states stamp
 * `paidAt` while `UNPAID`/`WAIVED` carry no stamp at all — the column records a
 * payment, not a decision. Nothing is messaged: money changes hands between two
 * people, and the app has no sentence for it.
 *
 * `PAID_BALANCE` is the one state this select refuses: the balance engine wrote
 * it because the money already moved off the account, and re-marking it by hand
 * would double-count a settlement the ledger has a row for. The refusal points
 * at the place a correction actually happens — the account's own page.
 */
export async function setPaymentStatus(
  registrationId: string,
  paymentStatus: PaymentStatus,
): Promise<SetPaymentOutcome> {
  const parsedId = RegistrationIdSchema.safeParse(registrationId);
  if (!parsedId.success) return { ok: false, code: "NOT_FOUND", error: SEAT_NOT_FOUND };

  const adminId = await adminIdOrNull();
  if (!adminId) return { ok: false, code: "AUTH", error: ADMIN_REQUIRED };

  const parsedStatus = PaymentStatusSchema.safeParse(paymentStatus);
  if (!parsedStatus.success) return { ok: false, code: "INVALID", error: PAYMENT_INVALID };

  const target = await sessionIdOfSeat(parsedId.data);
  if ("ok" in target) return target;

  // One clock for the whole request: the `paidAt` stamp and the guards agree.
  const now = new Date();
  const outcome = await prisma.$transaction(async (tx): Promise<SetPaymentEngine> => {
    await lockSession(tx, target.sessionId);

    const session = await tx.session.findUnique({
      where: { id: target.sessionId },
      select: { status: true },
    });
    if (!session) return { ok: false, code: "NOT_FOUND", error: SESSION_NOT_FOUND };
    if (session.status === "CANCELED") return { ok: false, code: "CLOSED", error: SESSION_CANCELED };

    const seat = await tx.registration.findUnique({
      where: { id: parsedId.data },
      select: { status: true, paymentStatus: true },
    });
    if (!seat) return { ok: false, code: "NOT_FOUND", error: SEAT_NOT_FOUND };
    // A canceled row owes nothing and can be given nothing: the seat is gone.
    if (seat.status === "CANCELED") {
      return { ok: false, code: "ALREADY", error: SEAT_ALREADY_CANCELED };
    }
    // The balance settled this seat; the money is already off the account. A
    // manual re-mark would invent a second settlement.
    if (seat.paymentStatus === "PAID_BALANCE") {
      return { ok: false, code: "FROM_BALANCE", error: PAYMENT_FROM_BALANCE };
    }
    if (seat.paymentStatus === parsedStatus.data) {
      return { ok: false, code: "ALREADY", error: PAYMENT_ALREADY };
    }

    await tx.registration.update({
      where: { id: parsedId.data },
      data: {
        paymentStatus: parsedStatus.data,
        paidAt: isPaidSeat(parsedStatus.data) ? now : null,
      },
    });

    return { ok: true, sessionId: target.sessionId };
  });

  if (!outcome.ok) return outcome;

  revalidateSessionBoard(outcome.sessionId);

  return { ok: true };
}

// ---------------------------------------------------------------------------
// «حذف ثبت‌نام»
// ---------------------------------------------------------------------------

type RemoveEngine =
  | {
      ok: true;
      sessionId: string;
      promoted: boolean;
      /** The promoted waiter's Eitaa id — the shell's message, never the browser's. */
      promotedEitaaId: string | null;
      /** What the removed seat sent back to its player's balance (0 when none). */
      refundedToman: number;
      sessionTitle: string;
      startsAt: Date;
    }
  | { ok: false; code: RegistrationAdminFailureCode; error: string };

/**
 * «حذف ثبت‌نام» — the manager takes a row off the board (§۶.۴, `cancelType =
 * ADMIN`).
 *
 * The row is canceled, never deleted: the seat's history (a payment, a mark) stays
 * where it is, and the player's own ledger keeps the trace. **No `Penalty` row is
 * written** — this is not a late cancel — and the seat's money goes back to the
 * player's balance in the same transaction (`refundSeatToBalance`): a manager
 * taking a seat back is not a reason for the hall to keep the money.
 *
 * A removed **held seat** frees the hall, and the first person in line is promoted
 * in the same transaction (exactly like `cancelSeat`, through the same
 * `findNextWaiter`/`promoteFromQueue`) — released and re-filled are one fact, so
 * the capacity the screen shows can never be wrong for a moment. The promoted
 * account's balance is charged right there, like any fresh seat. A removed
 * `WAITLIST` row frees nothing: the hall was already full.
 *
 * `promoted` and `refundedToman` are the browser's whole answer; the promoted
 * player's identity, the session's name and its start travel back to this shell
 * only, for the message.
 */
export async function removeRegistration(
  registrationId: string,
): Promise<RemoveRegistrationOutcome> {
  const parsedId = RegistrationIdSchema.safeParse(registrationId);
  if (!parsedId.success) return { ok: false, code: "NOT_FOUND", error: SEAT_NOT_FOUND };

  const adminId = await adminIdOrNull();
  if (!adminId) return { ok: false, code: "AUTH", error: ADMIN_REQUIRED };

  const target = await sessionIdOfSeat(parsedId.data);
  if ("ok" in target) return target;

  const now = new Date();
  const outcome = await prisma.$transaction(async (tx): Promise<RemoveEngine> => {
    await lockSession(tx, target.sessionId);

    const session = await tx.session.findUnique({
      where: { id: target.sessionId },
      select: { status: true, title: true, startsAt: true },
    });
    if (!session) return { ok: false, code: "NOT_FOUND", error: SESSION_NOT_FOUND };
    if (session.status === "CANCELED") return { ok: false, code: "CLOSED", error: SESSION_CANCELED };

    const seat = await tx.registration.findUnique({
      where: { id: parsedId.data },
      select: {
        status: true,
        userId: true,
        amountToman: true,
        paidFromBalance: true,
        paymentStatus: true,
      },
    });
    if (!seat) return { ok: false, code: "NOT_FOUND", error: SEAT_NOT_FOUND };
    if (seat.status === "CANCELED") {
      return { ok: false, code: "ALREADY", error: SEAT_ALREADY_CANCELED };
    }

    // The money plan, before either write: the removed seat may send money back
    // to its player, and the freed hall may charge the player it promotes. Both
    // accounts are locked here, in one global order (ascending id) — the same
    // rule every multi-account transaction in the app follows.
    const freedSeat = seat.status === "CONFIRMED";
    const refundToman = cancelRefundToman(seat);
    const waiter = freedSeat ? await findNextWaiter(tx, target.sessionId) : null;
    await lockBalances(tx, [
      ...(refundToman > 0 ? [seat.userId] : []),
      ...(waiter ? [waiter.userId] : []),
    ]);

    await tx.registration.update({
      where: { id: parsedId.data },
      data: {
        status: "CANCELED",
        canceledAt: now,
        // The manager's own cancel — never a late one, so the player's penalty
        // history is untouched by a seat being taken back.
        cancelType: "ADMIN",
        // The promotion stamp describes one event; this row is no longer the seat
        // that came off the queue.
        promotedAt: null,
      },
    });

    // The seat's money goes home to the balance — never out as cash — with the
    // manager named as the reason.
    const refund = await refundSeatToBalance(tx, {
      registrationId: parsedId.data,
      userId: seat.userId,
      sessionId: target.sessionId,
      amountToman: seat.amountToman,
      paidFromBalance: seat.paidFromBalance,
      paymentStatus: seat.paymentStatus,
      note: "حذف ثبت‌نام توسط مدیر",
      now,
    });

    const promotedEitaaId = waiter
      ? (await promoteFromQueue(tx, target.sessionId, waiter, now)).eitaaId
      : null;

    return {
      ok: true,
      sessionId: target.sessionId,
      promoted: promotedEitaaId !== null,
      promotedEitaaId,
      refundedToman: refund.refunded,
      sessionTitle: session.title,
      startsAt: session.startsAt,
    };
  });

  if (!outcome.ok) return outcome;

  revalidateSessionBoard(outcome.sessionId);

  // Only the person who just got a seat hears about it — and the free seat is news
  // they could not have known, because nobody told them they were first in line.
  if (outcome.promotedEitaaId) {
    void notifyPlayer(
      outcome.promotedEitaaId,
      promotedMessage({
        label: notifySessionLabel(outcome.sessionTitle, outcome.startsAt),
        link: notifySessionLink(outcome.sessionId),
      }),
    );
  }

  // The promoted player's address stays on this side of the wire.
  return { ok: true, promoted: outcome.promoted, refundedToman: outcome.refundedToman };
}

// ---------------------------------------------------------------------------
// «ارتقای دستی از لیست انتظار»
// ---------------------------------------------------------------------------

/**
 * «ارتقا» — the manager pulls one row out of the queue by hand (§۶.۴).
 *
 * Capacity is deliberately **not** checked: this control exists exactly for the
 * cases the automatic promotion cannot cover («این نفر رو خودم می‌شناسم»), and the
 * roster row that lands `CONFIRMED` immediately owes the money like every other
 * held seat — its balance pays first, through the same
 * `chargeSeatFromBalance` a fresh registration uses. The player is not messaged
 * (see the file header) — the manager's dialog says out loud that they should be
 * told.
 */
export async function promoteWaiter(registrationId: string): Promise<PromoteWaiterOutcome> {
  const parsedId = RegistrationIdSchema.safeParse(registrationId);
  if (!parsedId.success) return { ok: false, code: "NOT_FOUND", error: SEAT_NOT_FOUND };

  const adminId = await adminIdOrNull();
  if (!adminId) return { ok: false, code: "AUTH", error: ADMIN_REQUIRED };

  const target = await sessionIdOfSeat(parsedId.data);
  if ("ok" in target) return target;

  const now = new Date();
  const outcome = await prisma.$transaction(
    async (
      tx,
    ): Promise<
      | { ok: true; sessionId: string; chargedToman: number; outstandingToman: number }
      | { ok: false; code: RegistrationAdminFailureCode; error: string }
    > => {
      await lockSession(tx, target.sessionId);

      const session = await tx.session.findUnique({
        where: { id: target.sessionId },
        select: { status: true },
      });
      if (!session) return { ok: false, code: "NOT_FOUND", error: SESSION_NOT_FOUND };
      if (session.status === "CANCELED") return { ok: false, code: "CLOSED", error: SESSION_CANCELED };

      const seat = await tx.registration.findUnique({
        where: { id: parsedId.data },
        select: {
          status: true,
          userId: true,
          amountToman: true,
          paidFromBalance: true,
          paymentStatus: true,
        },
      });
      if (!seat) return { ok: false, code: "NOT_FOUND", error: SEAT_NOT_FOUND };
      if (seat.status === "CONFIRMED") {
        return { ok: false, code: "ALREADY", error: PROMOTE_ALREADY_SEAT };
      }
      // A canceled row is not in line: it cannot be promoted back into the hall.
      if (seat.status !== "WAITLIST") {
        return { ok: false, code: "NOT_WAITLIST", error: PROMOTE_NOT_IN_LINE };
      }

      await tx.registration.update({
        where: { id: parsedId.data },
        data: { status: "CONFIRMED", promotedAt: now },
      });

      // The seat owes the moment it is theirs: the account's balance pays first,
      // exactly like a fresh registration or an automatic promotion.
      const charge = await chargeSeatFromBalance(tx, {
        registrationId: parsedId.data,
        userId: seat.userId,
        sessionId: target.sessionId,
        amountToman: seat.amountToman,
        paidFromBalance: seat.paidFromBalance,
        paymentStatus: seat.paymentStatus,
        now,
      });

      // What the balance paid here and what is left, from the same helper every
      // money line uses — the button's toast repeats exactly this, never a guess.
      return {
        ok: true,
        sessionId: target.sessionId,
        chargedToman: charge.applied,
        outstandingToman: seatOutstanding({
          amountToman: seat.amountToman,
          paidFromBalance: seat.paidFromBalance + charge.applied,
          paymentStatus: charge.paymentStatus,
        }),
      };
    },
  );

  if (!outcome.ok) return outcome;

  revalidateSessionBoard(outcome.sessionId);

  return {
    ok: true,
    chargedToman: outcome.chargedToman,
    outstandingToman: outcome.outstandingToman,
  };
}

// ---------------------------------------------------------------------------
// «لغو کل سانس»
// ---------------------------------------------------------------------------

type CancelSessionEngine =
  | {
      ok: true;
      sessionId: string;
      canceled: number;
      sessionTitle: string;
      startsAt: Date;
      /** Who to tell, and what the release sent back to each one's balance. */
      players: { eitaaId: string; refundedToman: number }[];
    }
  | { ok: false; code: "AUTH" | "NOT_FOUND" | "CLOSED"; error: string };

/**
 * «لغو کل سانس» (§۶.۴) — the manager releases everyone: «همه بدون جریمه لغو
 * می‌شوند».
 *
 * Every live row (`CONFIRMED` and `WAITLIST` alike) becomes `CANCELED` with
 * `cancelType = ADMIN`, in one transaction that locked the session first, and
 * **not one `Penalty` row is written**: a canceled session is not the players'
 * fault. A row the player had already canceled is left exactly as it was — that
 * event is theirs, and it is not re-dated or re-labeled by this one.
 *
 * A `DRAFT` is cancelable too (it releases nothing and messages nobody): a draft
 * that will never happen must not have to be published first to be dropped.
 * Canceling a session twice answers `CLOSED`.
 *
 * After the commit every affected player gets one message — and a player whose
 * seat carried money is told where it went: the cancel's own transaction sends it
 * to the balance (`refundSeatToBalance`, in one global lock order across all the
 * session's players), and `sessionCanceledMessage` states the amount.
 */
export async function cancelSession(sessionId: string): Promise<CancelSessionOutcome> {
  const parsedId = SessionIdSchema.safeParse(sessionId);
  if (!parsedId.success) return { ok: false, code: "NOT_FOUND", error: SESSION_NOT_FOUND };

  const adminId = await adminIdOrNull();
  if (!adminId) return { ok: false, code: "AUTH", error: ADMIN_REQUIRED };

  const now = new Date();
  const outcome = await prisma.$transaction(async (tx): Promise<CancelSessionEngine> => {
    await lockSession(tx, parsedId.data);

    const session = await tx.session.findUnique({
      where: { id: parsedId.data },
      select: { status: true, title: true, startsAt: true },
    });
    if (!session) return { ok: false, code: "NOT_FOUND", error: SESSION_NOT_FOUND };
    if (session.status === "CANCELED") {
      return { ok: false, code: "CLOSED", error: SESSION_ALREADY_CANCELED };
    }

    // The rows this cancel really releases — the same set the roster shows. Read
    // under the lock, so the count, the update and the messages are one fact.
    const affected = await tx.registration.findMany({
      where: { sessionId: parsedId.data, status: { in: ["CONFIRMED", "WAITLIST"] } },
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

    if (affected.length > 0) {
      await tx.registration.updateMany({
        where: { id: { in: affected.map((row) => row.id) } },
        data: {
          status: "CANCELED",
          canceledAt: now,
          cancelType: "ADMIN",
          promotedAt: null,
        },
      });
    }

    // The owner's balance rule: every row that carried money sends it back to
    // its player's balance in this same transaction. Accounts are locked in one
    // global order (ascending id) before any refund moves, so two bulk cancels
    // can never deadlock on each other's players.
    const orderedRows = [...affected].sort((a, b) => (a.userId < b.userId ? -1 : 1));
    await lockBalances(
      tx,
      orderedRows.filter((row) => cancelRefundToman(row) > 0).map((row) => row.userId),
    );

    const refunds = new Map<string, number>();
    for (const row of orderedRows) {
      const refund = await refundSeatToBalance(tx, {
        registrationId: row.id,
        userId: row.userId,
        sessionId: parsedId.data,
        amountToman: row.amountToman,
        paidFromBalance: row.paidFromBalance,
        paymentStatus: row.paymentStatus,
        note: "لغو سانس توسط مدیر",
        now,
      });
      refunds.set(row.id, refund.refunded);
    }

    return {
      ok: true,
      sessionId: parsedId.data,
      canceled: affected.length,
      sessionTitle: session.title,
      startsAt: session.startsAt,
      players: affected.map((row) => ({
        eitaaId: row.user.eitaaId,
        refundedToman: refunds.get(row.id) ?? 0,
      })),
    };
  });

  if (!outcome.ok) return outcome;

  revalidateSessionBoard(outcome.sessionId);

  // One message per player, after the commit, none of them blocking and none of
  // them aware of the others.
  const label = notifySessionLabel(outcome.sessionTitle, outcome.startsAt);
  for (const player of outcome.players) {
    void notifyPlayer(
      player.eitaaId,
      sessionCanceledMessage({ label, refundedToman: player.refundedToman }),
    );
  }

  // The players' addresses stay here; the browser gets the one number the toast needs.
  return { ok: true, canceled: outcome.canceled };
}
