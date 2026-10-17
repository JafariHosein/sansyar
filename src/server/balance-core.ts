/**
 * The **balance engine** — the one home of every movement of `User.balance`.
 *
 * The owner's rule gives the account a wallet: money paid for a seat that is
 * given up lands on the balance (never in cash), and the next seat spends it
 * automatically before asking for anything. Four writers exist and all four live
 * here, so the arithmetic and the ledger can never drift apart:
 *
 *  - `chargeSeatFromBalance` — a seat becomes the player's (fresh registration,
 *    revival, or a waitlist promotion): spend what the balance can cover;
 *  - `refundSeatToBalance` — a seat that carried money is given up (the player's
 *    cancel, the manager's removal, a whole canceled session): send it back;
 *  - `lockBalances` — the shared lock order, for a transaction that touches more
 *    than one account (a cancel that refunds one player and charges the one it
 *    promotes);
 *  - `adjustBalanceByAdmin` — the manager moves the number by hand.
 *
 * House rules, exactly like `registration-core.ts`:
 *
 *  - **no `server-only`, no cookies, no notifications** — the module is driven by
 *    `scripts/check-balance.ts` as well as by the action shells;
 *  - **the client is injected** and **the clock is injected** (`now?: Date`), one
 *    value per call, so the rows written and the ledger entries agree about time;
 *  - **the lock order is session → user**, and user rows are always taken in one
 *    global order (ascending id) when a transaction touches more than one — a
 *    cancel refunding one account while promoting another cannot deadlock with
 *    its mirror image;
 *  - **every movement writes exactly one `BalanceEntry`** carrying the balance
 *    after it, so the column and the ledger explain each other.
 */

import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import { cancelRefundToman, seatBalanceUsed } from "@/lib/balance";
import type { PaymentStatus } from "@/lib/sessions";

/** What a charge did: how much came off, and where the seat stands now. */
export type SeatCharge = {
  /** The amount that came off the balance this time (≥ 0). */
  applied: number;
  /** The balance right after the charge. */
  balance: number;
  /** The seat's payment state after the charge. */
  paymentStatus: PaymentStatus;
};

/** What a refund did. */
export type BalanceRefund = {
  /** The amount that landed back on the balance (0 when there was none). */
  refunded: number;
};

export type AdminAdjustResult =
  | { ok: true; balance: number }
  | { ok: false; code: "NOT_FOUND" | "INSUFFICIENT" };

type Tx = Prisma.TransactionClient;

/**
 * One account's balance row, locked (`SELECT … FOR UPDATE`). Returns `null` when
 * no such account exists — impossible through the app (every caller got the id
 * from a live session), but the engine answers instead of throwing.
 */
async function lockUserRow(tx: Tx, userId: string): Promise<number | null> {
  const rows = await tx.$queryRaw<Array<{ balance: number }>>`
    SELECT balance FROM \`User\` WHERE id = ${userId} FOR UPDATE`;
  return rows[0]?.balance ?? null;
}

/**
 * Lock several accounts' balance rows **in one global order** (ascending id),
 * before any of them is touched.
 *
 * A cancel is the reason this exists: it may refund the canceler and charge the
 * player it promotes, and two such cancels — each promoting the other's canceler
 * — would deadlock if every transaction took its two rows in its own order
 * (`cancel A→B` while `cancel B→A`). One order everywhere turns that into a
 * clean queue.
 */
export async function lockBalances(tx: Tx, userIds: readonly string[]): Promise<void> {
  const unique = [...new Set(userIds)].sort();
  for (const userId of unique) {
    await lockUserRow(tx, userId);
  }
}

export type ChargeSeatInput = {
  registrationId: string;
  userId: string;
  sessionId: string;
  /** The seat's price snapshot; a balance can never cover more than this. */
  amountToman: number;
  /** The seat's coverage before this charge (0 for a fresh seat). */
  paidFromBalance: number;
  /** The seat's state before this charge (the charge only ever moves it towards `PAID_BALANCE`). */
  paymentStatus: PaymentStatus;
  /** The event clock. Defaults to `new Date()`. */
  now?: Date;
};

/**
 * Spend the account's balance on a seat that just became the player's — a fresh
 * registration, a revival, or a promotion out of the waitlist.
 *
 * The amount applied is `min(balance, price − already covered)`; a seat the
 * balance covers entirely becomes **`PAID_BALANCE`** (and carries `paidAt`), a
 * partial one stays `UNPAID` and owes the remainder — the screens read both
 * facts, so a partially covered seat never looks settled. A zero balance is a
 * clean no-op: no row is rewritten, no ledger entry is invented.
 *
 * The caller may have locked this account already (every registration does, on
 * the membership read); locking a row the transaction holds is free.
 */
export async function chargeSeatFromBalance(
  tx: Tx,
  input: ChargeSeatInput,
): Promise<SeatCharge> {
  const now = input.now ?? new Date();

  const coveredBefore = seatBalanceUsed({
    amountToman: input.amountToman,
    paidFromBalance: input.paidFromBalance,
    paymentStatus: input.paymentStatus,
  });
  const due = Math.max(0, input.amountToman - coveredBefore);

  const balance = await lockUserRow(tx, input.userId);
  if (balance === null) {
    return { applied: 0, balance: 0, paymentStatus: input.paymentStatus };
  }

  const applied = Math.min(balance, due);
  if (applied <= 0) {
    return { applied: 0, balance, paymentStatus: input.paymentStatus };
  }

  const nextBalance = balance - applied;
  await tx.user.update({ where: { id: input.userId }, data: { balance: nextBalance } });

  const nextCovered = coveredBefore + applied;
  const covered = nextCovered >= input.amountToman;
  const paymentStatus: PaymentStatus = covered ? "PAID_BALANCE" : input.paymentStatus;

  await tx.registration.update({
    where: { id: input.registrationId },
    data: {
      paidFromBalance: nextCovered,
      paymentStatus,
      // Settling a seat from the balance *is* a payment, and `paidAt` is the
      // stamp every paid row carries — set it only on the call that settled.
      ...(covered ? { paidAt: now } : {}),
    },
  });

  await tx.balanceEntry.create({
    data: {
      userId: input.userId,
      amount: -applied,
      balanceAfter: nextBalance,
      type: "REGISTRATION_DEDUCT",
      registrationId: input.registrationId,
      sessionId: input.sessionId,
      createdAt: now,
    },
  });

  return { applied, balance: nextBalance, paymentStatus };
}

export type RefundSeatInput = {
  registrationId: string;
  userId: string;
  sessionId: string;
  /** The seat's price snapshot. */
  amountToman: number;
  /** How much of it came off the balance at registration time. */
  paidFromBalance: number;
  /** The seat's state when it was given up — decides what is returned. */
  paymentStatus: PaymentStatus;
  /** Why the seat was given up, when the manager should read a reason. */
  note?: string | null;
  /** The event clock. Defaults to `new Date()`. */
  now?: Date;
};

/**
 * Send a given-up seat's money back to the balance.
 *
 * The amount is `cancelRefundToman` — the **same helper the confirm dialog and
 * every money line use**, so the sentence a player agreed to is the amount the
 * transaction pays: a paid seat returns its whole snapshotted price, a seat that
 * only ever spent part of the balance returns that part, and a seat with no
 * money involved (a place in line, a waived row) returns nothing and touches no
 * row. The seat row itself keeps its history; the returned money is the ledger's
 * story.
 */
export async function refundSeatToBalance(
  tx: Tx,
  input: RefundSeatInput,
): Promise<BalanceRefund> {
  const now = input.now ?? new Date();

  const refund = cancelRefundToman({
    amountToman: input.amountToman,
    paidFromBalance: input.paidFromBalance,
    paymentStatus: input.paymentStatus,
  });
  if (refund <= 0) return { refunded: 0 };

  const balance = await lockUserRow(tx, input.userId);
  if (balance === null) return { refunded: 0 };

  const nextBalance = balance + refund;
  await tx.user.update({ where: { id: input.userId }, data: { balance: nextBalance } });

  await tx.balanceEntry.create({
    data: {
      userId: input.userId,
      amount: refund,
      balanceAfter: nextBalance,
      type: "CANCEL_REFUND",
      note: input.note ?? null,
      registrationId: input.registrationId,
      sessionId: input.sessionId,
      createdAt: now,
    },
  });

  return { refunded: refund };
}

export type AdminAdjustInput = {
  userId: string;
  /** Signed: positive credits the account, negative takes from it. Never lands below zero. */
  delta: number;
  /** The manager's own words, if they wrote any. */
  note?: string | null;
  /** The manager's account — named on the ledger row. */
  adminId: string;
  now?: Date;
};

/**
 * The manager's hand on the balance: one signed movement, one ledger row naming
 * the manager, both inside a transaction that locks the account first.
 *
 * A subtract larger than the balance is refused (`INSUFFICIENT`) instead of
 * flooring at zero: the number the manager typed and the number the account
 * holds are both facts, and quietly writing a different one helps nobody. The
 * action shell renders that refusal as a sentence.
 */
export async function adjustBalanceByAdmin(
  db: PrismaClient,
  input: AdminAdjustInput,
): Promise<AdminAdjustResult> {
  const now = input.now ?? new Date();

  return db.$transaction(async (tx): Promise<AdminAdjustResult> => {
    const balance = await lockUserRow(tx, input.userId);
    if (balance === null) return { ok: false, code: "NOT_FOUND" };

    if (input.delta === 0) return { ok: true, balance };

    const nextBalance = balance + input.delta;
    if (nextBalance < 0) return { ok: false, code: "INSUFFICIENT" };

    await tx.user.update({ where: { id: input.userId }, data: { balance: nextBalance } });

    await tx.balanceEntry.create({
      data: {
        userId: input.userId,
        amount: input.delta,
        balanceAfter: nextBalance,
        type: "ADMIN_ADJUST",
        note: input.note ?? null,
        byAdminId: input.adminId,
        createdAt: now,
      },
    });

    return { ok: true, balance: nextBalance };
  });
}
