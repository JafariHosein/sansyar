"use server";

/**
 * «تغییر موجودی» — the manager's hand on one account's balance (the balance round).
 *
 * The movement itself lives in `src/server/balance-core.ts` (`adjustBalanceByAdmin`),
 * inside a transaction that locks the account first and writes one ledger row
 * naming the manager. This shell keeps only what a server action must own: the
 * zod check, `requireAdmin()` (the proxy is never an auth boundary — a player must
 * not be able to move anybody's balance, their own included), the revalidation
 * and the **fire-and-forget Eitaa message**: money that changes without a word is
 * the one thing a wallet must never do.
 *
 * The amount is **signed**: positive credits the account, negative takes from it.
 * A subtraction larger than the balance is refused (`INSUFFICIENT`) rather than
 * floored at zero, so the number the manager typed is either applied exactly or
 * explained — never quietly replaced by a different one.
 */

import "server-only";

import { revalidatePath } from "next/cache";

import { z } from "zod";

import { requireAdmin, type SessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { balanceAdjustedMessage, notifyPlayer } from "@/lib/eitaa-notify";

import { adjustBalanceByAdmin } from "@/server/balance-core";

import type { AdjustBalanceOutcome } from "./admin-results";

/** The most one tap may carry — a typo protector, not a business rule. */
const MAX_ADJUST_TOMAN = 10_000_000;

/** The note is the manager's own words; it rides in the message and the ledger. */
const MAX_NOTE_LENGTH = 200;

/** Ids are cuids; anything longer did not come from this app. */
const UserIdSchema = z.string().min(1).max(64);

/** Said for a bad payload and for a missing admin session alike — one refusal either way. */
const ADMIN_REQUIRED = "دسترسی مدیر لازمه.";
const USER_NOT_FOUND = "این کاربر پیدا نشد — صفحه رو دوباره باز کن.";
const INVALID_AMOUNT = "مبلغ تغییر باید یه عدد درست باشه و صفر نشه.";
const INVALID_NOTE = `توضیح تغییر حداکثر ${MAX_NOTE_LENGTH} حرف می‌تونه باشه.`;
const INSUFFICIENT = "موجودی حساب از این مبلغ کم‌تره — موجودی منفی نمی‌شه.";

/**
 * `delta` is coerced because a form field hands over a string: the dialog builds
 * the sign from its own «افزودن/کسر» toggle, and this is the server saying the
 * same rule again — a whole, non-zero, bounded movement in Toman.
 */
const AdjustBalanceSchema = z.object({
  userId: UserIdSchema,
  delta: z
    .coerce.number()
    .int()
    .refine((value) => value !== 0 && Math.abs(value) <= MAX_ADJUST_TOMAN),
  note: z.string().trim().max(MAX_NOTE_LENGTH).optional(),
});

/**
 * «تغییر موجودی» — one signed movement on one account, then the player is told.
 *
 * The reason is passed through unchanged (it is what the player reads in the
 * message), and the returned balance is what the card shows without a reload.
 */
export async function adjustBalance(
  userId: string,
  input: { delta: number; note?: string },
): Promise<AdjustBalanceOutcome> {
  const parsed = AdjustBalanceSchema.safeParse({ userId, delta: input.delta, note: input.note });
  if (!parsed.success) {
    // A bad id is «not found», not «bad input» — the same split `banUser` makes:
    // the client learns nothing about which ids exist.
    if (parsed.error.issues[0]?.path[0] === "userId") {
      return { ok: false, code: "NOT_FOUND", error: USER_NOT_FOUND };
    }
    const noteFailed = parsed.error.issues.some((issue) => issue.path[0] === "note");
    return { ok: false, code: "INVALID", error: noteFailed ? INVALID_NOTE : INVALID_AMOUNT };
  }

  // `requireAdmin` throws for a missing session *and* for a player: both answers
  // are the same refusal, because the caller is a client that must learn nothing
  // about who is an admin.
  let admin: SessionUser;
  try {
    admin = await requireAdmin();
  } catch {
    return { ok: false, code: "AUTH", error: ADMIN_REQUIRED };
  }

  const target = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true, eitaaId: true },
  });
  if (!target) {
    return { ok: false, code: "NOT_FOUND", error: USER_NOT_FOUND };
  }

  // One clock for the movement: the `balanceAfter` the ledger records and the
  // stamp the player's message describes are the same instant.
  const now = new Date();
  const result = await adjustBalanceByAdmin(prisma, {
    userId: target.id,
    delta: parsed.data.delta,
    note: parsed.data.note ?? null,
    adminId: admin.id,
    now,
  });

  if (!result.ok) {
    return result.code === "INSUFFICIENT"
      ? { ok: false, code: "INSUFFICIENT", error: INSUFFICIENT }
      : { ok: false, code: "NOT_FOUND", error: USER_NOT_FOUND };
  }

  // The write is committed; tell every screen that shows the number: the card and
  // the ledger on the manager's page, and the player's own balance surfaces.
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${target.id}`);
  revalidatePath("/profile");
  revalidatePath("/");
  revalidatePath("/my");

  // After the commit, never part of it: `notifyPlayer` swallows every refusal
  // (Eitaa's daily credit, a player who never pressed «شروع») and logs it.
  void notifyPlayer(
    target.eitaaId,
    balanceAdjustedMessage({ delta: parsed.data.delta, note: parsed.data.note ?? null }),
  );

  return { ok: true, balance: result.balance };
}
