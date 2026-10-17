"use server";

/**
 * The manager's decision on the **membership queue** — «تأیید» / «رد عضویت»
 * (the owner's newest round: approval is about the *account*, not the seat).
 *
 * The engine lives in `src/server/membership-core.ts` (`decideMembership`)
 * because the race harness drives it directly. This module keeps what a server
 * action must own:
 *
 *   zod id check → `requireAdmin()` (the proxy is never the auth boundary, and a
 *   player must not be able to approve themselves) → the engine → the
 *   revalidation that makes the decision visible → **fire-and-forget Eitaa
 *   message** → the mapping down to the two fields a browser gets.
 *
 * The decision costs the player nothing and is never about a seat: an approved
 * account simply becomes able to register, a rejected one keeps its single
 * waiting screen — with the one escape the owner asked for: a rejection is
 * **not final**, `/admin` lists the rejected accounts and one tap approves them.
 *
 * `checkMembership` is the player-side sibling: the waiting screen's «دوباره چک
 * کن» asks for the viewer's own fresh status, so an approval that lands while the
 * app is open shows up without closing the messenger.
 */

import "server-only";

import { revalidatePath } from "next/cache";

import { z } from "zod";

import { getCurrentUser, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { eitaaAppLink } from "@/lib/eitaa";
import {
  membershipApprovedMessage,
  membershipRejectedMessage,
  notifyPlayer,
} from "@/lib/eitaa-notify";
import {
  decideMembership,
  MEMBER_NOT_FOUND,
  type MembershipEngineResult,
} from "@/server/membership-core";

import type { MembershipCheckOutcome, MembershipOutcome } from "./results";

/** User ids are cuids; anything longer did not come from this app. */
const UserIdSchema = z.string().min(1).max(64);

/** Said for a bad id and for a missing admin session alike — one refusal either way. */
const ADMIN_REQUIRED = "دسترسی مدیر لازمه.";

/** The gate's retry cannot fix a dead cookie; reopening the app can. */
const SESSION_MISSING = "حسابت رو پیدا نکردیم — سانس‌یار رو ببند و از ایتا دوباره باز کن.";

/**
 * The shared shell of both decisions: validate, authorize, decide, revalidate,
 * notify. Split from the two exported actions only so the two callers cannot
 * drift — the *difference* between them is one word.
 */
async function decide(
  rawUserId: string,
  decision: "APPROVED" | "REJECTED",
): Promise<MembershipOutcome> {
  const parsed = UserIdSchema.safeParse(rawUserId);
  if (!parsed.success) {
    return { ok: false, code: "NOT_FOUND", error: MEMBER_NOT_FOUND };
  }

  // `requireAdmin` throws for a missing session *and* for a player: both answers
  // are the same refusal, because the caller is a client that must learn nothing
  // about who is an admin.
  try {
    await requireAdmin();
  } catch {
    return { ok: false, code: "AUTH", error: ADMIN_REQUIRED };
  }

  const outcome: MembershipEngineResult = await decideMembership(prisma, {
    userId: parsed.data,
    decision,
    // One clock for the request: the guard reads and the decision stamp agree.
    now: new Date(),
  });

  if (!outcome.ok) {
    // Nothing changed, so nothing is revalidated and nobody is told.
    return { ok: false, code: outcome.code, error: outcome.error };
  }

  // The write is committed; `/admin` is the queue itself — both sections (the
  // pending list and the rejected list) just changed.
  revalidatePath("/admin");

  // The message is after the commit, never part of it: `notifyPlayer` swallows
  // every refusal and logs it. An approval carries the app link — the player's
  // next move is to open سانس‌یار; a rejection carries no link at all.
  if (outcome.decision === "APPROVED") {
    void notifyPlayer(outcome.userEitaaId, membershipApprovedMessage({ link: eitaaAppLink() }));
  } else {
    void notifyPlayer(outcome.userEitaaId, membershipRejectedMessage());
  }

  // The engine's extra field (the player's Eitaa id) stays on this side of the wire.
  return { ok: true, decision: outcome.decision };
}

/**
 * «تأیید» — the account becomes a member. Works from both lists: a pending
 * request is the first word, a rejected account is the manager taking the
 * rejection back (the owner's rule — rejection must not be a dead end).
 */
export async function approveMembership(userId: string): Promise<MembershipOutcome> {
  return decide(userId, "APPROVED");
}

/**
 * «رد عضویت» — only a pending account can be rejected, and the refusal is not
 * final: the account lands in the «ردشده‌ها» list where it can be approved.
 */
export async function rejectMembership(userId: string): Promise<MembershipOutcome> {
  return decide(userId, "REJECTED");
}

/**
 * The waiting screen's «دوباره چک کن» — a fresh server read of the viewer's own
 * membership status. Deliberately answers with the status alone: the screen
 * decides what to do with it (an approval retires the gate; anything else says so
 * and waits).
 */
export async function checkMembership(): Promise<MembershipCheckOutcome> {
  const viewer = await getCurrentUser();
  if (!viewer) {
    return { ok: false, code: "AUTH", error: SESSION_MISSING };
  }

  // A direct row read, not the session's copy: the point of this action is the
  // decision that may have landed *while the app was open*.
  const row = await prisma.user.findUnique({
    where: { id: viewer.id },
    select: { membershipStatus: true },
  });
  if (!row) {
    return { ok: false, code: "AUTH", error: SESSION_MISSING };
  }

  return { ok: true, status: row.membershipStatus };
}
