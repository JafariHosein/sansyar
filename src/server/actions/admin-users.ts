"use server";

/**
 * The manager's writes on an **account** — «محروم کردن (N روز + دلیل)» and
 * «لغو محرومیت» (PROMPT.md §۵.۶ و §۶.۴).
 *
 * Both are one `Penalty` row and nothing else, which is what keeps the penalty
 * engine honest: a ban is a row with `days > 0` and a window, a warning is a row
 * with `days = 0`, and lifting a ban is `waivedAt` — never a delete. The
 * registration engine reads the very same predicate (`src/server/penalties.ts`),
 * so nothing has to be told twice that a player is barred.
 *
 * The shell owns what only a server action can: the zod check, `requireAdmin()`
 * (the proxy is never the auth boundary — a player must not be able to ban
 * anyone, themself included), the revalidation, and the **fire-and-forget Eitaa
 * message** that tells the player what happened.
 *
 * `waiveBan` is a compare-and-set, not a read-then-write: the `updateMany` carries
 * the whole condition in its `WHERE`, so two taps can never both "lift" a ban and
 * a pardon that landed meanwhile cannot be written over.
 */

import "server-only";

import { revalidatePath } from "next/cache";

import { z } from "zod";

import { requireAdmin, type SessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { banWaivedMessage, manualBanMessage, notifyPlayer } from "@/lib/eitaa-notify";

import type { BanUserOutcome, WaiveBanOutcome } from "./admin-results";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The window the manager may hand out by hand — one day to three months. */
const MIN_BAN_DAYS = 1;
const MAX_BAN_DAYS = 90;

/** A reason shorter than this is not a reason the player can act on. */
const MIN_REASON_LENGTH = 3;
const MAX_REASON_LENGTH = 200;

/** Ids are cuids; anything longer did not come from this app. */
const UserIdSchema = z.string().min(1).max(64);

/** Said for a bad input and a missing admin session alike — one refusal either way. */
const ADMIN_REQUIRED = "دسترسی مدیر لازمه.";
const USER_NOT_FOUND = "این کاربر پیدا نشد — صفحه رو دوباره باز کن.";
const PENALTY_NOT_FOUND = "این محرومیت پیدا نشد — صفحه رو دوباره باز کن.";

/**
 * `days` is coerced because a form field hands over a string: the dialog's
 * numeric input is normalized client-side, and this is the server saying the same
 * rule again — no request may store a `days` the engine's window cannot explain.
 */
const BanUserSchema = z.object({
  userId: UserIdSchema,
  days: z.coerce.number().int().min(MIN_BAN_DAYS).max(MAX_BAN_DAYS),
  reason: z.string().trim().min(MIN_REASON_LENGTH).max(MAX_REASON_LENGTH),
});

const INVALID_DAYS = `مدت محرومیت باید بین ${MIN_BAN_DAYS} تا ${MAX_BAN_DAYS} روز باشه.`;
const INVALID_REASON = `دلیل محرومیت باید حداقل ${MIN_REASON_LENGTH} حرف باشه.`;

/**
 * «محروم کردن» — a manual ban: one `MANUAL` penalty row whose window starts now
 * and ends `days` later, stamped with the manager who issued it (the audit trail
 * the schema keeps for exactly this), then the player is told in Eitaa.
 *
 * The reason is the manager's own words and is passed through unchanged: it is
 * what the player reads in the ban card and in the message, so paraphrasing it
 * here would only create a second version of the same fact.
 */
export async function banUser(
  userId: string,
  input: { days: number; reason: string },
): Promise<BanUserOutcome> {
  const parsed = BanUserSchema.safeParse({ userId, days: input.days, reason: input.reason });
  if (!parsed.success) {
    // A bad id is «not found», not «bad input» — the same split `membership.ts`
    // makes: the client learns nothing about which ids exist.
    if (parsed.error.issues[0]?.path[0] === "userId") {
      return { ok: false, code: "NOT_FOUND", error: USER_NOT_FOUND };
    }
    const daysFailed = parsed.error.issues.some((issue) => issue.path[0] === "days");
    return { ok: false, code: "INVALID", error: daysFailed ? INVALID_DAYS : INVALID_REASON };
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

  // One clock for the row: the window the screen's toast names and the window the
  // engine will read are the same instant.
  const now = new Date();
  const until = new Date(now.getTime() + parsed.data.days * DAY_MS);

  await prisma.penalty.create({
    data: {
      userId: target.id,
      type: "MANUAL",
      days: parsed.data.days,
      reason: parsed.data.reason,
      startsAt: now,
      endsAt: until,
      // A manual ban belongs to no سانس — that is what `sessionId: null` says.
      sessionId: null,
      issuedByAdminId: admin.id,
    },
  });

  // The write is committed; tell every screen that shows it. `/profile` carries
  // the player's «سابقه‌ی من», the board and the session page carry the ban card
  // that refuses the next tap, and `/admin/users` is this very list.
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${target.id}`);
  revalidatePath("/");
  revalidatePath("/my");
  revalidatePath("/profile");

  // After the commit, never part of it: `notifyPlayer` swallows every refusal
  // (Eitaa's daily credit, a player who never pressed «شروع») and logs it.
  void notifyPlayer(
    target.eitaaId,
    manualBanMessage({ days: parsed.data.days, reason: parsed.data.reason }),
  );

  // The engine's extra fields (which player, which manager) stay on this side of
  // the wire; the screen needs the date the ban ends, and that is all.
  return { ok: true, until };
}

/**
 * «لغو محرومیت» — lift one penalty row early.
 *
 * Only a live ban can be lifted: a row with `days = 0` was never a ban (it is an
 * «اخطار» and lifting it would rewrite history), and a row already waived is
 * done. The state is read first for the honest sentence, and then re-checked
 * inside the `updateMany`'s own `WHERE` — so the two tabs cannot both win.
 */
export async function waiveBan(penaltyId: string): Promise<WaiveBanOutcome> {
  const parsed = UserIdSchema.safeParse(penaltyId);
  if (!parsed.success) {
    return { ok: false, code: "NOT_FOUND", error: PENALTY_NOT_FOUND };
  }

  // Same guard as `banUser`: a player must not be able to lift a ban — their own
  // or anybody else's.
  try {
    await requireAdmin();
  } catch {
    return { ok: false, code: "AUTH", error: ADMIN_REQUIRED };
  }

  const row = await prisma.penalty.findUnique({
    where: { id: parsed.data },
    select: {
      id: true,
      userId: true,
      days: true,
      waivedAt: true,
      user: { select: { eitaaId: true } },
    },
  });
  if (!row) {
    return { ok: false, code: "NOT_FOUND", error: PENALTY_NOT_FOUND };
  }
  if (row.days <= 0) {
    return { ok: false, code: "ALREADY", error: "این ردیف اخطاره — محرومیتی برای لغو کردن نداره." };
  }
  if (row.waivedAt !== null) {
    return { ok: false, code: "ALREADY", error: "این محرومیت قبلاً لغو شده." };
  }

  const now = new Date();
  // The whole condition is in the `WHERE`: whoever writes second finds `count = 0`
  // and is told the truth instead of overwriting somebody else's pardon.
  const lifted = await prisma.penalty.updateMany({
    where: { id: parsed.data, waivedAt: null, days: { gt: 0 } },
    data: { waivedAt: now },
  });
  if (lifted.count === 0) {
    return { ok: false, code: "ALREADY", error: "این محرومیت همین حالا لغو شد." };
  }

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${row.userId}`);
  revalidatePath("/");
  revalidatePath("/my");
  revalidatePath("/profile");

  // The pardon lands as its own message, so the door reopens out loud.
  void notifyPlayer(row.user.eitaaId, banWaivedMessage());

  return { ok: true };
}
