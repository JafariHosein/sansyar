/**
 * The **membership engine** — the manager's one-time decision on an account
 * (the owner's newest round: approval is about the *person*, not the seat).
 *
 * This module is the sibling of `src/server/registration-core.ts` and follows
 * the same two rules, for the same reason (the race harness drives it directly):
 *
 *  - **the client is injected** (`db: PrismaClient`) — no `server-only` marker,
 *    no cookie layer, no `eitaa-notify` import (the texts are the shell's
 *    business);
 *  - **the clock is injected** (`now?: Date`) — the decision stamp is the row's
 *    own fact, not whatever `new Date()` says at write time.
 *
 * The decision is a **locking read on the user row** (`SELECT … FOR UPDATE`) and
 * the status is re-read under the lock, so the three events that can race —
 * approve × reject, reject × re-approve, a decision × the account's own
 * registration — serialize on one row and the loser sees the winner's state.
 *
 * The rules of the gate:
 *
 *  - `PENDING` → `APPROVED` / `REJECTED`: the manager's first word.
 *  - `REJECTED` → `APPROVED`: allowed on purpose (the owner's instruction) — a
 *    rejection is **not final**, the manager reviews the rejected list and can
 *    take it back.
 *  - `APPROVED` → anything: refused. An approval is not re-decidable; revoking a
 *    member is a deliberate DB write, exactly like an admin role.
 */

import type { PrismaClient } from "@/generated/prisma/client";

export type MembershipDecision = "APPROVED" | "REJECTED";

/** Why a decision was refused — the engine's own union, mapped by its shell. */
export type MembershipEngineFailure = "NOT_FOUND" | "ALREADY_APPROVED" | "NOT_PENDING";

/** The account is gone (deleted, or the id never existed). */
export const MEMBER_NOT_FOUND = "این حساب رو پیدا نکردیم.";

/** Nothing to decide — the account is already a member. */
export const MEMBER_ALREADY_APPROVED = "این عضو قبلاً تأیید شده.";

/** The only decision a rejected account does not take is another rejection. */
export const MEMBER_NOT_PENDING = "این درخواست دیگه در انتظار تأیید نیست.";

export type DecideMembershipInput = {
  userId: string;
  decision: MembershipDecision;
  /** The decision clock. Defaults to `new Date()`. */
  now?: Date;
};

/**
 * The engine's answer. Richer than the browser's view on purpose: the shell needs
 * the player's Eitaa id to send the fire-and-forget «عضویتت تأیید شد» message
 * **after** the commit, and it never hands that field to a client.
 */
export type MembershipEngineResult =
  | {
      ok: true;
      decision: MembershipDecision;
      /** The player whose account was decided on — the message goes to them. */
      userEitaaId: string;
    }
  | { ok: false; code: MembershipEngineFailure; error: string };

/**
 * ONE manager decision, end to end — the transaction body behind «تأیید» / «رد»
 * on the membership queue.
 */
export async function decideMembership(
  db: PrismaClient,
  input: DecideMembershipInput,
): Promise<MembershipEngineResult> {
  const now = input.now ?? new Date();

  return db.$transaction(async (tx): Promise<MembershipEngineResult> => {
    // The lock is the transaction's **first** statement — a plain read before it
    // would open InnoDB's consistent snapshot, and a snapshot taken before the
    // lock is exactly what hides a racing decision. (Same contract as the seat
    // engines; here the locked row is the account, not the session.)
    //
    // The table is literally named `User`, so it is backtick-quoted here.
    await tx.$queryRaw`SELECT id FROM \`User\` WHERE id = ${input.userId} FOR UPDATE`;

    // The status as the winner left it. This is the read that matters: a straight
    // locking read of the row, so both racers cannot read `PENDING`.
    const user = await tx.user.findUnique({
      where: { id: input.userId },
      select: { eitaaId: true, membershipStatus: true },
    });
    if (!user) {
      return { ok: false, code: "NOT_FOUND", error: MEMBER_NOT_FOUND };
    }
    if (user.membershipStatus === "APPROVED") {
      return { ok: false, code: "ALREADY_APPROVED", error: MEMBER_ALREADY_APPROVED };
    }
    // A second rejection of an already-rejected account is not a decision — the
    // one button that means anything for it is «تأیید» (re-approval).
    if (input.decision === "REJECTED" && user.membershipStatus === "REJECTED") {
      return { ok: false, code: "NOT_PENDING", error: MEMBER_NOT_PENDING };
    }

    await tx.user.update({
      where: { id: input.userId },
      data: {
        membershipStatus: input.decision,
        // The stamp is overwritten by every decision — the last word is the one
        // the account carries.
        membershipDecidedAt: now,
      },
    });

    return { ok: true, decision: input.decision, userEitaaId: user.eitaaId };
  });
}
